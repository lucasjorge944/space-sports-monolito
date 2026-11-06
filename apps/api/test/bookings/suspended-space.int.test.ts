import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaces } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  currentSlot,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from './fixtures.js';

// RF-SUPER-03: espaço suspenso fica só leitura. Toda escrita (gestão e jogador) responde
// 403 SPACE_READ_ONLY; as leituras continuam.

useMiddayClock();

describe('espaço suspenso: só leitura (RF-SUPER-03)', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let manager: SignedUp;
  let organizer: SignedUp;
  let friend: SignedUp;
  let future: string;
  let inProgress: string;
  let paymentId: string;
  let blockId: string;
  let inviteToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-suspensa');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    manager = await member(t, 'gestor@exemplo.com', space.id, 'ADMIN');
    organizer = await signUp(t, 'organizador@exemplo.com', 'Organizador');
    friend = await signUp(t, 'amigo@exemplo.com', 'Amigo');

    // Monta o cenário com o espaço ativo.
    const created = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(organizer))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(30 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 3,
      })
      .expect(201);
    future = created.body.id;
    const invited = await t
      .http()
      .post(`/v1/bookings/${future}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Ana'] })
      .expect(201);
    inviteToken = invited.body.participants[1].inviteToken;
    inProgress = (
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(manager))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          startsAt: currentSlot().toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName: 'Cliente',
          guestPhone: '+5531911112222',
        })
        .expect(201)
    ).body.id;
    paymentId = (
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/payments`)
        .set(...bearer(manager))
        .send({ payableType: 'BOOKING', payableId: inProgress, amountCents: 1_000, method: 'PIX' })
        .expect(201)
    ).body.id;
    const start = slotIn(40 * 60);
    blockId = (
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/court-blocks`)
        .set(...bearer(owner))
        .send({
          courtId: space.courtB,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
        })
        .expect(201)
    ).body.id;

    await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, space.id));
  });
  afterAll(() => t.close());

  const readOnly = (res: { body: { error: { code: string } } }) =>
    expect(res.body.error.code).toBe('SPACE_READ_ONLY');

  it('a gestão não escreve: balcão, cancelar, concluir, no-show, bloqueios, pagamentos', async () => {
    const base = `/v1/manage/spaces/${space.id}`;
    const writes = [
      t
        .http()
        .post(`${base}/bookings`)
        .set(...bearer(manager))
        .send({
          courtId: space.courtA,
          sportId: space.sportId,
          startsAt: slotIn(50 * 60).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName: 'X',
          guestPhone: '+5531933334444',
        }),
      t
        .http()
        .post(`${base}/bookings/${future}/cancel`)
        .set(...bearer(owner))
        .send({}),
      t
        .http()
        .post(`${base}/bookings/${inProgress}/complete`)
        .set(...bearer(owner)),
      t
        .http()
        .post(`${base}/bookings/${inProgress}/no-show`)
        .set(...bearer(owner)),
      t
        .http()
        .post(`${base}/court-blocks`)
        .set(...bearer(owner))
        .send({
          courtId: space.courtA,
          startsAt: slotIn(60 * 60).toISOString(),
          endsAt: slotIn(61 * 60).toISOString(),
        }),
      t
        .http()
        .delete(`${base}/court-blocks/${blockId}`)
        .set(...bearer(owner)),
      t
        .http()
        .post(`${base}/payments`)
        .set(...bearer(manager))
        .send({ payableType: 'BOOKING', payableId: inProgress, amountCents: 500, method: 'CASH' }),
      t
        .http()
        .post(`${base}/payments/${paymentId}/reverse`)
        .set(...bearer(manager))
        .send({}),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      readOnly(res);
    }
  });

  it('o jogador também não escreve: reservar, cancelar, convidar, desfazer, aceitar, recusar', async () => {
    const reserve = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(friend))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(50 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 2,
      })
      .expect(422);
    expect(reserve.body.error.code).toBe('SPACE_NOT_BOOKABLE');

    const detail = await t
      .http()
      .get(`/v1/bookings/${future}`)
      .set(...bearer(organizer))
      .expect(200);
    const pending = detail.body.participants[1].id;
    const writes = [
      t
        .http()
        .post(`/v1/bookings/${future}/cancel`)
        .set(...bearer(organizer))
        .send({}),
      t
        .http()
        .post(`/v1/bookings/${future}/invites`)
        .set(...bearer(organizer))
        .send({ names: ['B'] }),
      t
        .http()
        .delete(`/v1/bookings/${future}/invites/${pending}`)
        .set(...bearer(organizer)),
      t
        .http()
        .post(`/v1/invites/${inviteToken}/accept`)
        .set(...bearer(friend)),
      t
        .http()
        .post(`/v1/invites/${inviteToken}/decline`)
        .set(...bearer(friend)),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      readOnly(res);
    }
  });

  it('as leituras continuam', async () => {
    const base = `/v1/manage/spaces/${space.id}`;
    await t
      .http()
      .get(`${base}/bookings`)
      .set(...bearer(manager))
      .expect(200);
    await t
      .http()
      .get(`${base}/bookings/${future}`)
      .set(...bearer(manager))
      .expect(200);
    await t
      .http()
      .get(`${base}/receivables/today`)
      .set(...bearer(manager))
      .expect(200);
    await t
      .http()
      .get(`${base}/court-blocks`)
      .query({ from: new Date().toISOString(), to: slotIn(72 * 60).toISOString() })
      .set(...bearer(owner))
      .expect(200);
    await t
      .http()
      .get('/v1/bookings')
      .set(...bearer(organizer))
      .expect(200);
    await t
      .http()
      .get(`/v1/bookings/${future}`)
      .set(...bearer(organizer))
      .expect(200);
    await t
      .http()
      .get(`/v1/invites/${inviteToken}`)
      .set(...bearer(friend))
      .expect(200);
  });

  it('nada mudou no banco e, reativado, volta a aceitar escrita', async () => {
    const detail = await t
      .http()
      .get(`/v1/manage/spaces/${space.id}/bookings/${inProgress}`)
      .set(...bearer(owner))
      .expect(200);
    expect(detail.body.status).toBe('CONFIRMED');
    expect(detail.body.payments).toHaveLength(1);
    expect(detail.body.payments[0].reversedAt).toBeNull();

    await t.db.update(spaces).set({ status: 'ACTIVE' }).where(eq(spaces.id, space.id));
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings/${inProgress}/complete`)
      .set(...bearer(owner))
      .expect(200);
  });

  it('quem não tem papel recebe SPACE_FORBIDDEN, não SPACE_READ_ONLY', async () => {
    await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, space.id));
    const res = await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/payments`)
      .set(...bearer(friend))
      .send({ payableType: 'BOOKING', payableId: inProgress, amountCents: 100, method: 'PIX' })
      .expect(403);
    expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
  });
});
