import { addMinutes } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings } from '../../src/db/schema/index.js';
import { BookingRemindersService } from '../../src/notifications/booking-reminders.service.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { bearer, createSpace, type Space, slotIn, useMiddayClock } from '../bookings/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from './fakes.js';
import { bookFor, inbox, registerDevice } from './helpers.js';

useMiddayClock();

const LEAD_MIN = 120;

describe('lembrete antes da reserva (RF-NOTIF-01)', () => {
  let t: NotificationsTestApp;
  let space: Space;
  let organizer: SignedUp;
  let friend: SignedUp;
  let reminders: BookingRemindersService;

  const remindersOf = async (user: SignedUp) =>
    (await inbox(t, user, '?limit=100')).items.filter((i) => i.type === 'BOOKING_REMINDER');

  beforeAll(async () => {
    t = await createNotificationsApp({ BOOKING_REMINDER_LEAD_MIN: String(LEAD_MIN) });
    reminders = t.app.get(BookingRemindersService);
    space = await createSpace(t.db, 'arena-lembretes');
    organizer = await signUp(t, 'organizador@exemplo.com', 'Organizador');
    friend = await signUp(t, 'amigo@exemplo.com', 'Amigo');
    await registerDevice(t, organizer, 'ExponentPushToken[organizador]');
  });
  afterAll(() => t.close());

  it('lembra quando a reserva entra na janela e só então', async () => {
    const startsAt = slotIn(30 * 60);
    const booking = await bookFor(t, organizer, space, startsAt);
    t.queue.pushes.length = 0;

    expect(await reminders.run(addMinutes(startsAt, -(LEAD_MIN + 5)))).toBe(0);
    expect(await remindersOf(organizer)).toHaveLength(0);

    expect(await reminders.run(addMinutes(startsAt, -(LEAD_MIN - 5)))).toBe(1);
    const [reminder] = await remindersOf(organizer);
    expect(reminder).toMatchObject({
      title: 'Hora de jogar!',
      data: { bookingId: booking.id },
    });
    await t.flush();
    expect(t.push.sent).toEqual([
      expect.objectContaining({ to: 'ExponentPushToken[organizador]', title: 'Hora de jogar!' }),
    ]);
  });

  it('é idempotente: repetir ou rodar em paralelo não lembra de novo', async () => {
    const startsAt = slotIn(31 * 60);
    await bookFor(t, organizer, space, startsAt);
    const now = addMinutes(startsAt, -60);
    const before = (await remindersOf(organizer)).length;

    const counts = await Promise.all([reminders.run(now), reminders.run(now), reminders.run(now)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await reminders.run(now)).toBe(0);
    expect(await reminders.run(addMinutes(now, 30))).toBe(0);
    expect(await remindersOf(organizer)).toHaveLength(before + 1);
  });

  it('lembra também quem aceitou dividir a conta', async () => {
    const startsAt = slotIn(32 * 60);
    const booking = await bookFor(t, organizer, space, startsAt, { peopleCount: 3 });
    const invited = await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Amigo'] })
      .expect(201);
    const token = invited.body.participants.find(
      (p: { inviteToken: string | null; userId: string | null }) => p.inviteToken && !p.userId,
    )?.inviteToken;
    await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(friend))
      .expect(200);

    await reminders.run(addMinutes(startsAt, -60));

    expect(await remindersOf(friend)).toHaveLength(1);
  });

  it('não lembra reserva cancelada, já iniciada ou feita dentro da janela do lembrete', async () => {
    const cancelledAt = slotIn(33 * 60);
    const cancelled = await bookFor(t, organizer, space, cancelledAt);
    await t
      .http()
      .post(`/v1/bookings/${cancelled.id}/cancel`)
      .set(...bearer(organizer))
      .send({})
      .expect(200);

    const lateAt = slotIn(34 * 60);
    const late = await bookFor(t, organizer, space, lateAt);
    // Reserva feita 30 min antes do jogo: o aviso de confirmação já cobre.
    await t.db
      .update(bookings)
      .set({ createdAt: addMinutes(lateAt, -30) })
      .where(eq(bookings.id, late.id));

    const before = (await remindersOf(organizer)).length;
    expect(await reminders.run(addMinutes(cancelledAt, -60))).toBe(0);
    expect(await reminders.run(addMinutes(lateAt, -20))).toBe(0);
    // Depois do início, já passou da hora.
    expect(await reminders.run(addMinutes(lateAt, 5))).toBe(0);
    expect(await remindersOf(organizer)).toHaveLength(before);
  });

  it('respeita a preferência do tipo', async () => {
    await t
      .http()
      .patch('/v1/me/notification-preferences')
      .set(...bearer(organizer))
      .send({ items: [{ type: 'BOOKING_REMINDER', push: false, inApp: false }] })
      .expect(200);
    const startsAt = slotIn(35 * 60);
    await bookFor(t, organizer, space, startsAt);
    await t.flush();
    t.push.sent.length = 0;
    const before = (await remindersOf(organizer)).length;

    expect(await reminders.run(addMinutes(startsAt, -60))).toBe(1);
    await t.flush();

    expect(await remindersOf(organizer)).toHaveLength(before);
    expect(t.push.sent).toHaveLength(0);
  });
});
