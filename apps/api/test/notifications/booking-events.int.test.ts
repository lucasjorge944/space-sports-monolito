import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings, recurringBookings } from '../../src/db/schema/index.js';
import { DomainEvents } from '../../src/events/domain-events.js';
import { BookingNotifier } from '../../src/notifications/booking-notifier.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { slotWeekday } from '../recurring/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from './fakes.js';
import { bookFor, inbox, registerDevice } from './helpers.js';

useMiddayClock();

describe('notificações dos eventos de reserva (RF-NOTIF-01, RF-NOTIF-04)', () => {
  let t: NotificationsTestApp;
  let space: Space;
  let organizer: SignedUp;
  let friend: SignedUp;
  let manager: SignedUp;

  beforeAll(async () => {
    t = await createNotificationsApp();
    space = await createSpace(t.db, 'arena-notificacoes');
    organizer = await signUp(t, 'organizador@exemplo.com', 'Organizador');
    friend = await signUp(t, 'amigo@exemplo.com', 'Amigo');
    manager = await member(t, 'gestor@exemplo.com', space.id, 'ADMIN');
    await registerDevice(t, organizer, 'ExponentPushToken[organizador]');
    await registerDevice(t, friend, 'ExponentPushToken[amigo]');
  });
  afterAll(() => t.close());

  it('reserva confirmada: grava na central e envia push ao organizador', async () => {
    const booking = await bookFor(t, organizer, space, slotIn(30 * 60));
    await t.flush();

    const { items, unreadCount } = await inbox(t, organizer);
    expect(unreadCount).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'BOOKING_CONFIRMED',
      title: 'Reserva confirmada',
      readAt: null,
      data: { bookingId: booking.id, spaceId: space.id },
    });
    expect(items[0]?.body).toContain('Espaço arena-notificacoes · Quadra A');
    expect(t.push.sent).toEqual([
      expect.objectContaining({
        to: 'ExponentPushToken[organizador]',
        title: 'Reserva confirmada',
        data: expect.objectContaining({
          type: 'BOOKING_CONFIRMED',
          bookingId: booking.id,
          notificationId: items[0]?.id,
        }),
      }),
    ]);
    expect((await inbox(t, friend)).items).toHaveLength(0);
  });

  it('o horário no texto usa o fuso do espaço (America/Sao_Paulo)', async () => {
    // Quarta-feira, 22:30 em São Paulo = 01:30 UTC de quinta.
    const startsAt = new Date('2030-05-09T01:30:00Z');
    await t.app
      .get(DomainEvents)
      .publish({ type: 'booking.confirmed', bookingId: await insertBooking(startsAt) });
    const { items } = await inbox(t, organizer, '?limit=1');
    expect(items[0]?.body).toMatch(/qua\., 08\/05\/2030 às 22:30$/);
  });

  it('reserva de balcão notifica o cliente com app; cliente sem conta não gera nada', async () => {
    const before = t.queue.pushes.length;
    const desk = (body: Record<string, unknown>) =>
      t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(manager))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          durationMin: 60,
          peopleCount: 2,
          ...body,
        })
        .expect(201);

    await desk({
      startsAt: slotIn(40 * 60).toISOString(),
      guestName: 'Sem App',
      guestPhone: '+5531999990000',
    });
    expect(t.queue.pushes).toHaveLength(before);

    await desk({ startsAt: slotIn(41 * 60).toISOString(), customerUserId: friend.id });
    expect(t.queue.pushes).toHaveLength(before + 1);
    const { items } = await inbox(t, friend);
    expect(items.map((i) => i.type)).toEqual(['BOOKING_CONFIRMED']);
    await t.flush();
  });

  it('cancelamento pela gestão avisa o organizador e quem aceitou dividir a conta', async () => {
    const booking = await bookFor(t, organizer, space, slotIn(50 * 60), { peopleCount: 3 });
    const invited = await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Amigo', 'Outro'] })
      .expect(201);
    const token = invited.body.participants.find(
      (p: { inviteToken: string | null; userId: string | null }) => p.inviteToken && !p.userId,
    )?.inviteToken;
    await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(friend))
      .expect(200);
    await t.flush();
    t.push.sent.length = 0;

    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings/${booking.id}/cancel`)
      .set(...bearer(manager))
      .send({ reason: 'Quadra em manutenção' })
      .expect(200);
    await t.flush();

    for (const user of [organizer, friend]) {
      const { items } = await inbox(t, user, '?limit=1');
      expect(items[0]).toMatchObject({
        type: 'BOOKING_CANCELLED',
        data: { bookingId: booking.id },
      });
    }
    expect(t.push.sent.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[amigo]',
      'ExponentPushToken[organizador]',
    ]);
  });

  it('quem cancela a própria reserva não recebe aviso de cancelamento', async () => {
    const booking = await bookFor(t, organizer, space, slotIn(60 * 60));
    await t.flush();
    const before = (await inbox(t, organizer)).items.length;

    await t
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set(...bearer(organizer))
      .send({})
      .expect(200);
    expect(t.queue.pushes).toHaveLength(0);
    expect((await inbox(t, organizer)).items).toHaveLength(before);
  });

  it('mensalista aprovado ou recusado avisa o solicitante (ponto de integração da 1.3)', async () => {
    const request = first(
      await t.db
        .insert(recurringBookings)
        .values({
          spaceId: space.id,
          courtId: space.courtA,
          userId: friend.id,
          sportId: space.sportId,
          weekday: 1,
          startTime: '19:00',
          durationMin: 60,
          peopleCount: 4,
          startsOn: '2030-06-03',
        })
        .returning(),
    );
    const events = t.app.get(DomainEvents);

    await events.publish({ type: 'recurring.approved', recurringBookingId: request.id });
    await events.publish({ type: 'recurring.rejected', recurringBookingId: request.id });

    const { items } = await inbox(t, friend, '?limit=2');
    expect(items.map((i) => i.type)).toEqual(['RECURRING_REJECTED', 'RECURRING_APPROVED']);
    expect(items[1]).toMatchObject({
      title: 'Mensalista aprovado',
      body: 'Espaço arena-notificacoes · Quadra A · segunda-feira às 19:00',
    });
    await t.db.delete(recurringBookings).where(eq(recurringBookings.id, request.id));
    await t.flush();
  });

  it('convite direto a usuário avisa o convidado, com o token para aceitar', async () => {
    const booking = await bookFor(t, organizer, space, slotIn(70 * 60));
    await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ userIds: [friend.id] })
      .expect(201);

    const { items } = await inbox(t, friend, '?limit=1');
    expect(items[0]).toMatchObject({
      type: 'BOOKING_INVITE',
      title: 'Convite para dividir a conta',
      data: { bookingId: booking.id, inviteToken: expect.any(String) },
    });
    expect(items[0]?.body).toContain('Organizador convidou você');
  });

  it('evento de convite sem convite pendente para o usuário não notifica', async () => {
    const booking = await bookFor(t, organizer, space, slotIn(71 * 60));
    const before = (await inbox(t, friend)).items.length;
    await t.app
      .get(DomainEvents)
      .publish({ type: 'booking.invite_created', bookingId: booking.id, inviteeUserId: friend.id });
    expect((await inbox(t, friend)).items).toHaveLength(before);
  });

  it('erro em um assinante não derruba a publicação', async () => {
    const events = t.app.get(DomainEvents);
    // Reserva inexistente: o assinante não acha nada e segue sem lançar.
    await expect(
      events.publish({
        type: 'booking.confirmed',
        bookingId: '019a0000-0000-7000-8000-000000000000',
      }),
    ).resolves.toBeUndefined();
  });

  describe('mensalista aprovado ou recusado (tarefa 1.3 → RF-NOTIF-01)', () => {
    let nextSlot = 0;
    const requestSlot = async (user: SignedUp) => {
      const i = nextSlot++;
      const res = await t
        .http()
        .post('/v1/recurring-bookings')
        .set(...bearer(user))
        .send({
          spaceId: space.id,
          courtId: space.courtA,
          sportId: space.sportId,
          weekday: slotWeekday(),
          startTime: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
          durationMin: 30,
          peopleCount: 4,
        })
        .expect(201);
      return res.body.id as string;
    };
    const decide = (id: string, action: 'approve' | 'reject') =>
      t
        .http()
        .post(`/v1/manage/spaces/${space.id}/recurring-bookings/${id}/${action}`)
        .set(...bearer(manager))
        .send({});

    beforeAll(async () => {});

    it('aprovar avisa o solicitante com push e na central', async () => {
      const id = await requestSlot(friend);
      const before = (await inbox(t, friend)).items.length;
      await decide(id, 'approve').expect(200);
      await t.flush();
      const { items } = await inbox(t, friend, '?limit=1');
      expect((await inbox(t, friend)).items).toHaveLength(before + 1);
      expect(items[0]).toMatchObject({
        type: 'RECURRING_APPROVED',
        title: 'Mensalista aprovado',
        data: { recurringBookingId: id, spaceId: space.id },
      });
      expect(t.push.sent.at(-1)).toMatchObject({ to: 'ExponentPushToken[amigo]' });
    });

    it('recusar avisa o solicitante', async () => {
      const id = await requestSlot(friend);
      await decide(id, 'reject').expect(200);
      const { items } = await inbox(t, friend, '?limit=1');
      expect(items[0]).toMatchObject({
        type: 'RECURRING_REJECTED',
        title: 'Mensalista recusado',
        data: { recurringBookingId: id },
      });
      await t.flush();
    });

    it('aprovação que falha (409) não notifica ninguém', async () => {
      const id = await requestSlot(friend);
      await decide(id, 'approve').expect(200);
      const before = (await inbox(t, friend)).items.length;
      await decide(id, 'approve').expect(409); // já está ACTIVE
      expect((await inbox(t, friend)).items).toHaveLength(before);
      await t.flush();
    });

    it('mensalista cadastrado no balcão sem conta não gera notificação', async () => {
      const before = t.queue.pushes.length;
      const res = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/recurring-bookings`)
        .set(...bearer(manager))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          weekday: slotWeekday(),
          startTime: '23:00',
          durationMin: 30,
          peopleCount: 4,
          guestName: 'Sem App',
          guestPhone: '+5531999990000',
        })
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(t.queue.pushes).toHaveLength(before);
    });
  });

  /** Token do convite direto, lido da notificação do convidado (nunca da resposta do organizador). */
  async function tokenFromInbox(user: SignedUp, bookingId: string): Promise<string> {
    const { items } = await inbox(t, user);
    const item = items.find((i) => i.type === 'BOOKING_INVITE' && i.data?.bookingId === bookingId);
    const token = item?.data?.inviteToken;
    if (typeof token !== 'string') throw new Error('Notificação de convite sem inviteToken.');
    return token;
  }

  describe('convite direto a usuário (booking.invite_created)', () => {
    it('convidar por userIds notifica o convidado; só ele aceita; o link por nome não notifica', async () => {
      const booking = await bookFor(t, organizer, space, slotIn(90 * 60), { peopleCount: 4 });
      const invite = (body: object) =>
        t
          .http()
          .post(`/v1/bookings/${booking.id}/invites`)
          .set(...bearer(organizer))
          .send(body);
      const before = (await inbox(t, friend)).items.length;

      await invite({ names: ['Por Link'] }).expect(201);
      expect((await inbox(t, friend)).items).toHaveLength(before);

      const created = await invite({ userIds: [friend.id, friend.id] }).expect(201);
      const direct = created.body.participants.find((p: { name: string }) => p.name === 'Amigo');
      expect(direct).toMatchObject({ status: 'INVITED', isOrganizer: false });
      // Duplicado no corpo vira um só convite e uma só notificação.
      const { items } = await inbox(t, friend);
      expect(items).toHaveLength(before + 1);
      expect(items[0]).toMatchObject({
        type: 'BOOKING_INVITE',
        data: { bookingId: booking.id, spaceId: space.id },
      });
      // O token só chega ao convidado: a push leva o mesmo dado e a notificação de outros não.
      const token = await tokenFromInbox(friend, booking.id);
      expect(token).toBe(direct.inviteToken);
      expect(JSON.stringify((await inbox(t, organizer)).items)).not.toContain(token);
      await t.flush();
      expect(t.push.sent.at(-1)).toMatchObject({
        to: 'ExponentPushToken[amigo]',
        data: expect.objectContaining({ type: 'BOOKING_INVITE', inviteToken: token }),
      });

      // Outro usuário, mesmo com o token, não aceita nem recusa o convite do amigo.
      const intruder = await signUp(t, 'intruso@exemplo.com', 'Intruso');
      await t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(intruder))
        .expect(409);
      await t
        .http()
        .post(`/v1/invites/${token}/decline`)
        .set(...bearer(intruder))
        .expect(409);
      await t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(friend))
        .expect(200);
    });

    it('rejeita usuário inexistente, o próprio organizador, quem já participa e excesso de convites', async () => {
      const booking = await bookFor(t, organizer, space, slotIn(95 * 60), { peopleCount: 3 });
      const invite = (body: object) =>
        t
          .http()
          .post(`/v1/bookings/${booking.id}/invites`)
          .set(...bearer(organizer))
          .send(body);

      const ghost = await invite({ userIds: ['01a183ed-a943-7bd0-bf27-aea87c40cfaa'] }).expect(404);
      expect(ghost.body.error.code).toBe('INVITEE_NOT_FOUND');
      expect((await invite({ userIds: [organizer.id] }).expect(409)).body.error.code).toBe(
        'ALREADY_PARTICIPANT',
      );
      await invite({ userIds: [friend.id] }).expect(201);
      expect((await invite({ userIds: [friend.id] }).expect(409)).body.error.code).toBe(
        'ALREADY_PARTICIPANT',
      );
      // people_count 3: sobra uma vaga (organizador + amigo + 1).
      expect(
        (await invite({ names: ['A'], userIds: [manager.id] }).expect(422)).body.error.code,
      ).toBe('TOO_MANY_INVITES');
      // Nada além do amigo foi criado.
      const mine = await t
        .http()
        .get(`/v1/bookings/${booking.id}`)
        .set(...bearer(organizer))
        .expect(200);
      expect(mine.body.participants).toHaveLength(2); // organizador + amigo
    });

    it('quem recusou pode ser convidado de novo; precisa de nome ou usuário', async () => {
      const booking = await bookFor(t, organizer, space, slotIn(99 * 60), { peopleCount: 3 });
      const invite = (body: object) =>
        t
          .http()
          .post(`/v1/bookings/${booking.id}/invites`)
          .set(...bearer(organizer))
          .send(body);
      await invite({}).expect(400);
      await invite({ names: [], userIds: [] }).expect(400);

      await invite({ userIds: [friend.id] }).expect(201);
      const token = await tokenFromInbox(friend, booking.id);
      await t
        .http()
        .post(`/v1/invites/${token}/decline`)
        .set(...bearer(friend))
        .expect(200);
      const again = await invite({ userIds: [friend.id] }).expect(201);
      expect(
        again.body.participants.find((p: { name: string }) => p.name === 'Amigo'),
      ).toMatchObject({ status: 'INVITED' });
      await t.flush();
    });
  });

  describe('falha de um destinatário não interrompe os demais (RF-NOTIF-01)', () => {
    it('cancelamento: erro com o primeiro destinatário não impede o aviso ao seguinte', async () => {
      const booking = await bookFor(t, organizer, space, slotIn(110 * 60), { peopleCount: 3 });
      const invited = await t
        .http()
        .post(`/v1/bookings/${booking.id}/invites`)
        .set(...bearer(organizer))
        .send({ names: ['Amigo'] })
        .expect(201);
      const token = invited.body.participants.find(
        (p: { inviteToken: string | null; userId: string | null }) => p.inviteToken && !p.userId,
      ).inviteToken;
      await t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(friend))
        .expect(200);
      await t.flush();

      // O organizador é o primeiro da lista: a fila dele falha.
      const original = t.queue.enqueuePush.bind(t.queue);
      t.queue.enqueuePush = async (job) => {
        if (job.userId === organizer.id) throw new Error('Redis fora do ar');
        return original(job);
      };
      const friendBefore = (await inbox(t, friend)).items.length;
      try {
        await t
          .http()
          .post(`/v1/manage/spaces/${space.id}/bookings/${booking.id}/cancel`)
          .set(...bearer(manager))
          .send({ reason: 'Quadra em manutenção' })
          .expect(200);
      } finally {
        t.queue.enqueuePush = original;
      }
      const { items } = await inbox(t, friend, '?limit=1');
      expect((await inbox(t, friend)).items).toHaveLength(friendBefore + 1);
      expect(items[0]).toMatchObject({ type: 'BOOKING_CANCELLED' });
      await t.flush();
    });

    it('lembrete: erro com um jogador não impede o lembrete do outro', async () => {
      const booking = await bookFor(t, organizer, space, slotIn(120 * 60), { peopleCount: 3 });
      await t
        .http()
        .post(`/v1/bookings/${booking.id}/invites`)
        .set(...bearer(organizer))
        .send({ userIds: [friend.id] })
        .expect(201);
      const token = await tokenFromInbox(friend, booking.id);
      await t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(friend))
        .expect(200);
      await t.flush();

      const original = t.queue.enqueuePush.bind(t.queue);
      t.queue.enqueuePush = async (job) => {
        if (job.userId === organizer.id) throw new Error('Redis fora do ar');
        return original(job);
      };
      const before = (await inbox(t, friend)).items.length;
      try {
        await t.app.get(BookingNotifier).reminder(booking.id);
      } finally {
        t.queue.enqueuePush = original;
      }
      const { items } = await inbox(t, friend, '?limit=1');
      expect((await inbox(t, friend)).items).toHaveLength(before + 1);
      expect(items[0]).toMatchObject({ type: 'BOOKING_REMINDER' });
      await t.flush();
    });
  });

  async function insertBooking(startsAt: Date): Promise<string> {
    const row = first(
      await t.db
        .insert(bookings)
        .values({
          spaceId: space.id,
          courtId: space.courtB,
          organizerUserId: organizer.id,
          sportId: space.sportId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60_000),
          durationMin: 60,
          peopleCount: 2,
          pricePerHourCents: 10_000,
          priceCents: 10_000,
          status: 'CONFIRMED',
          paymentStatus: 'PENDING',
          source: 'APP',
        })
        .returning(),
    );
    return row.id;
  }
});
