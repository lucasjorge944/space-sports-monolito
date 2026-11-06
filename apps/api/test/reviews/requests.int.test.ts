import { addMinutes } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings, notifications, reviewPrompts, spaceMembers } from '../../src/db/schema/index.js';
import { ReviewRequestsService } from '../../src/notifications/review-requests.service.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { bearer, createSpace, type Space } from '../bookings/fixtures.js';
import { createNotificationsApp, type NotificationsTestApp } from '../notifications/fakes.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { addParticipant, DAY_MIN, insertBooking, insertClassUse, putReview } from './helpers.js';

// RN-REVIEW-02 (decisão 101): pedido ~2 h depois do uso, um por (pessoa, espaço) a cada 30
// dias, até 2 ignorados, respeitando a preferência; o mesmo uso nunca gera dois pedidos.

const DELAY_MIN = 120;
let n = 0;

describe('pedidos de avaliação (RN-REVIEW-02)', () => {
  let t: NotificationsTestApp;
  let job: ReviewRequestsService;
  let space: Space;

  const newUser = () => signUp(t, `pedido${n++}@exemplo.com`, 'Jogador Pedido');
  /** Reserva de 60 min que terminou `minAgo` minutos antes de `now`. */
  const bookingEndedAt = (user: SignedUp, now: Date, minAgo: number, target = space) => {
    const endsAt = addMinutes(now, -minAgo);
    return insertBooking(t.db, target, user, 0, { startsAt: addMinutes(endsAt, -60), endsAt });
  };
  const promptsOf = (user: SignedUp) =>
    t.db.select().from(reviewPrompts).where(eq(reviewPrompts.userId, user.id));
  const requestsOf = (user: SignedUp) =>
    t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.type, 'REVIEW_REQUEST')));

  beforeAll(async () => {
    t = await createNotificationsApp({ REVIEW_REQUEST_DELAY_MIN: String(DELAY_MIN) });
    job = t.app.get(ReviewRequestsService);
    space = await createSpace(t.db, 'arena-pedidos');
  });
  afterAll(() => t.close());

  it('pede ~2 h depois do fim, com os dados para abrir a tela de avaliar', async () => {
    const user = await newUser();
    const now = new Date();
    const booking = await bookingEndedAt(user, now, DELAY_MIN - 10);
    await job.run(now);
    expect(await promptsOf(user)).toHaveLength(0);

    const later = addMinutes(now, 15);
    await job.run(later);
    const [prompt] = await promptsOf(user);
    expect(prompt).toMatchObject({
      spaceId: space.id,
      sourceType: 'BOOKING',
      sourceId: booking.id,
      sentAt: later,
    });
    const [item] = await requestsOf(user);
    expect(item).toMatchObject({
      title: 'Como foi no Espaço arena-pedidos?',
      body: 'Dê sua nota em poucos segundos.',
      data: {
        spaceId: space.id,
        slug: 'arena-pedidos',
        source: 'BOOKING',
        sourceId: booking.id,
        promptId: prompt?.id,
      },
    });
    expect(prompt?.notificationId).toBe(item?.id);
    expect(t.queue.pushes.at(-1)).toMatchObject({
      userId: user.id,
      data: { type: 'REVIEW_REQUEST', slug: 'arena-pedidos' },
    });
  });

  it('não volta mais de 24 h', async () => {
    const user = await newUser();
    const now = new Date();
    await bookingEndedAt(user, now, DAY_MIN + 5);
    await job.run(now);
    expect(await promptsOf(user)).toHaveLength(0);
  });

  it('idempotente: repetir ou rodar em paralelo não pede duas vezes', async () => {
    const user = await newUser();
    const now = new Date();
    await bookingEndedAt(user, now, DELAY_MIN + 5);
    await Promise.all([job.run(now), job.run(now), job.run(now)]);
    await job.run(addMinutes(now, 5));
    expect(await promptsOf(user)).toHaveLength(1);
    expect(await requestsOf(user)).toHaveLength(1);
  });

  it('um pedido por (pessoa, espaço): o uso mais recente; organizador e participante aceito', async () => {
    const [organizer, friend, invited] = [await newUser(), await newUser(), await newUser()];
    const now = new Date();
    await bookingEndedAt(organizer, now, DELAY_MIN + 200);
    const latest = await bookingEndedAt(organizer, now, DELAY_MIN + 10);
    await addParticipant(t.db, latest.id, friend, 'ACCEPTED');
    await addParticipant(t.db, latest.id, invited, 'INVITED');
    await job.run(now);
    expect((await promptsOf(organizer)).map((p) => p.sourceId)).toEqual([latest.id]);
    expect(await promptsOf(friend)).toHaveLength(1);
    expect(await promptsOf(invited)).toHaveLength(0);
  });

  it('aula com presença também pede (source CLASS_SESSION)', async () => {
    const student = await newUser();
    const session = await insertClassUse(t, space, student, DELAY_MIN + 10, 'CONFIRMED');
    await job.run(new Date());
    expect(await promptsOf(student)).toEqual([
      expect.objectContaining({ sourceType: 'CLASS_SESSION', sourceId: session.id }),
    ]);
  });

  it('no máximo um pedido do espaço a cada 30 dias; para depois de 2 ignorados', async () => {
    const user = await newUser();
    const t0 = new Date();
    await bookingEndedAt(user, t0, DELAY_MIN + 5);
    await job.run(t0);

    const t10 = addMinutes(t0, 10 * DAY_MIN);
    await bookingEndedAt(user, t10, DELAY_MIN + 5);
    await job.run(t10);
    expect(await promptsOf(user)).toHaveLength(1); // 30 dias

    const t31 = addMinutes(t0, 31 * DAY_MIN);
    await bookingEndedAt(user, t31, DELAY_MIN + 5);
    await job.run(t31);
    expect(await promptsOf(user)).toHaveLength(2); // 1º ignorado, segue

    const t62 = addMinutes(t0, 62 * DAY_MIN);
    await bookingEndedAt(user, t62, DELAY_MIN + 5);
    await job.run(t62);
    expect(await promptsOf(user)).toHaveLength(2); // 2 ignorados: para

    // Outro espaço não é afetado.
    const other = await createSpace(t.db, 'arena-pedidos-2');
    await bookingEndedAt(user, t62, DELAY_MIN + 5, other);
    await job.run(t62);
    expect((await promptsOf(user)).filter((p) => p.spaceId === other.id)).toHaveLength(1);
  });

  it('BUG-AV5-2: avaliar até 7 dias depois do pedido grava answered_at, que fica ao editar e excluir', async () => {
    const [quick, late] = [await newUser(), await newUser()];
    const other = await createSpace(t.db, 'arena-pedidos-resp');
    const now = new Date();
    const prompt = async (user: SignedUp, daysAgo: number, target = space) =>
      (
        await t.db
          .insert(reviewPrompts)
          .values({
            userId: user.id,
            spaceId: target.id,
            sourceType: 'BOOKING',
            sourceId: crypto.randomUUID(),
            sentAt: addMinutes(now, -daysAgo * DAY_MIN),
          })
          .returning()
      )[0];
    const answeredAt = async (id: string | undefined) =>
      (
        await t.db
          .select()
          .from(reviewPrompts)
          .where(eq(reviewPrompts.id, id ?? ''))
      )[0]?.answeredAt;
    const inTime = await prompt(quick, 6);
    const otherSpace = await prompt(quick, 1, other);
    const tooLate = await prompt(late, 8);
    for (const user of [quick, late]) await insertBooking(t.db, space, user, 3 * DAY_MIN);

    const created = await putReview(t, quick, space.id, { rating: 5 }).expect(200);
    await putReview(t, late, space.id, { rating: 5 }).expect(200);
    const marked = await answeredAt(inTime?.id);
    expect(marked?.toISOString()).toBe(created.body.createdAt);
    expect(await answeredAt(otherSpace?.id)).toBeNull();
    expect(await answeredAt(tooLate?.id)).toBeNull();

    // Editar não mexe na marca; excluir também não (o pedido continua respondido).
    await putReview(t, quick, space.id, { rating: 3 }).expect(200);
    await t
      .http()
      .delete(`/v1/spaces/${space.id}/reviews/me`)
      .set(...bearer(quick))
      .expect(204);
    expect(await answeredAt(inTime?.id)).toEqual(marked);
  });

  it('quem já avaliou não recebe pedido', async () => {
    const user = await newUser();
    await insertBooking(t.db, space, user, 3 * DAY_MIN);
    await putReview(t, user, space.id, { rating: 5 }).expect(200);
    const now = new Date();
    await bookingEndedAt(user, now, DELAY_MIN + 5);
    await job.run(now);
    expect(await promptsOf(user)).toHaveLength(0);
  });

  it('preferência: os dois canais desligados não pedem; só o push desligado pede na central', async () => {
    const [off, inAppOnly] = [await newUser(), await newUser()];
    for (const [user, prefs] of [
      [off, { push: false, inApp: false }],
      [inAppOnly, { push: false }],
    ] as const) {
      await t
        .http()
        .patch('/v1/me/notification-preferences')
        .set(...bearer(user))
        .send({ items: [{ type: 'REVIEW_REQUEST', ...prefs }] })
        .expect(200);
    }
    const now = new Date();
    await bookingEndedAt(off, now, DELAY_MIN + 5);
    await bookingEndedAt(inAppOnly, now, DELAY_MIN + 5);
    const pushesBefore = t.queue.pushes.length;
    await job.run(now);
    expect(await promptsOf(off)).toHaveLength(0);
    expect(await promptsOf(inAppOnly)).toHaveLength(1);
    expect(await requestsOf(inAppOnly)).toHaveLength(1);
    expect(t.queue.pushes.slice(pushesBefore).map((p) => p.userId)).not.toContain(inAppOnly.id);
  });

  it('equipe, conta bloqueada, uso cancelado e espaço fora da vitrine não recebem', async () => {
    const now = new Date();
    const staff = await newUser();
    await t.db
      .insert(spaceMembers)
      .values({ userId: staff.id, spaceId: space.id, role: 'ADMIN', status: 'ACTIVE' });
    await bookingEndedAt(staff, now, DELAY_MIN + 5);

    const blocked = await newUser();
    await bookingEndedAt(blocked, now, DELAY_MIN + 5);
    const platform = await superUser(t, `super-pedidos${n++}@exemplo.com`);
    await t
      .http()
      .post(`/v1/super/users/${blocked.id}/block`)
      .set(...bearer(platform))
      .send({})
      .expect(200);

    const cancelled = await newUser();
    const booking = await bookingEndedAt(cancelled, now, DELAY_MIN + 5);
    await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));

    const closed = await createSpace(t.db, 'arena-pedidos-fechada');
    const visitor = await newUser();
    await bookingEndedAt(visitor, now, DELAY_MIN + 5, closed);
    await setSpaceStatus(t.db, closed.id, 'SUSPENDED');

    await job.run(now);
    for (const user of [staff, blocked, cancelled, visitor]) {
      expect(await promptsOf(user)).toHaveLength(0);
    }
  });
});
