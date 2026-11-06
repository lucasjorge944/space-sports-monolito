import { addDays, zonedToUtc } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings, spaceMembers, spaces } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { TIME_ZONE, today } from '../recurring/fixtures.js';

// RN-AUTH-04: visão de equipe do app, somente leitura.

useMiddayClock();

describe('GET /v1/me/staff-spaces (RN-AUTH-04)', () => {
  let t: TestApp;
  let space: Space;
  let other: Space;
  let foreign: Space;
  let owner: SignedUp;
  let teacher: SignedUp;
  let player: SignedUp;
  let both: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-equipe-app');
    other = await createSpace(t.db, 'arena-equipe-app-2');
    foreign = await createSpace(t.db, 'arena-de-fora');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
    player = await signUp(t, 'jogador@exemplo.com', 'Jogador');
    both = await member(t, 'dupla@exemplo.com', space.id, 'TEACHER');
    await t.db
      .insert(spaceMembers)
      .values({ userId: both.id, spaceId: other.id, role: 'ADMIN', status: 'ACTIVE' });
  });
  afterAll(() => t.close());

  const at = (day: string, hour: number) => zonedToUtc(day, hour * 60, TIME_ZONE);
  const book = async (
    target: Space,
    startsAt: Date,
    extra: Partial<typeof bookings.$inferInsert> = {},
  ) => {
    const [row] = await t.db
      .insert(bookings)
      .values({
        spaceId: target.id,
        courtId: target.courtA,
        sportId: target.sportId,
        organizerUserId: player.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        peopleCount: 2,
        durationMin: 60,
        pricePerHourCents: 10_000,
        priceCents: 10_000,
        source: 'APP',
        status: 'CONFIRMED',
        ...extra,
      })
      .returning();
    if (!row) throw new Error('Reserva não criada.');
    return row;
  };
  const view = (user: SignedUp) =>
    t
      .http()
      .get('/v1/me/staff-spaces')
      .set(...bearer(user));

  it('exige login', async () => {
    await t.http().get('/v1/me/staff-spaces').expect(401);
  });

  it('quem não é da equipe recebe a lista vazia', async () => {
    expect((await view(player).expect(200)).body).toEqual({ items: [] });
  });

  it('lista o espaço com papéis e só as reservas de hoje (fuso do espaço), sem canceladas', async () => {
    const todayBooking = await book(space, at(today(), 18));
    const desk = await book(space, at(today(), 9), {
      organizerUserId: null,
      guestName: 'Cliente Balcão',
      guestPhone: '+5531988887777',
      source: 'DESK',
      status: 'COMPLETED',
    });
    await book(space, at(today(), 20), { status: 'CANCELLED' });
    await book(space, at(addDays(today(), 1), 10));
    await book(space, at(addDays(today(), -1), 10));
    // 23:30 em São Paulo já é o dia seguinte em UTC, mas ainda é hoje para o espaço.
    const lateNight = await book(space, at(today(), 23.5));
    await book(foreign, at(today(), 10));

    const res = await view(owner).expect(200);
    expect(res.body.items).toHaveLength(1);
    const [item] = res.body.items;
    expect(item).toMatchObject({
      space: { id: space.id, slug: 'arena-equipe-app', timeZone: TIME_ZONE },
      roles: ['OWNER'],
      today: { date: today() },
    });
    expect(item.today.bookings.map((b: { id: string }) => b.id)).toEqual([
      desk.id,
      todayBooking.id,
      lateNight.id,
    ]);
    expect(item.today.bookings[0]).toMatchObject({
      court: { id: space.courtA, name: 'Quadra A' },
      sportName: 'Futevôlei',
      status: 'COMPLETED',
      source: 'DESK',
      customerName: 'Cliente Balcão',
      startsAt: desk.startsAt.toISOString(),
    });
    expect(item.today.bookings[1].customerName).toBe('Jogador');
  });

  it('não vaza valores nem telefone do cliente', async () => {
    const res = await view(teacher).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('priceCents');
    expect(text).not.toContain('+5531988887777');
    expect(text).not.toContain('paidCents');
  });

  describe('Professor (matriz: "Ver agenda e reservas" 👁️)', () => {
    it('vê o espaço dele com o papel TEACHER e a agenda do dia, sem dados financeiros', async () => {
      const res = await view(teacher).expect(200);
      expect(res.body.items).toHaveLength(1);
      const [item] = res.body.items;
      expect(item).toMatchObject({ space: { id: space.id }, roles: ['TEACHER'] });
      expect(item.today.bookings.length).toBeGreaterThan(0);
      for (const booking of item.today.bookings) {
        expect(Object.keys(booking).sort()).toEqual(
          [
            'court',
            'customerName',
            'endsAt',
            'id',
            'peopleCount',
            'source',
            'sportName',
            'startsAt',
            'status',
          ].sort(),
        );
      }
    });

    it('a visão é a mesma da agenda do painel, mas o Professor não escreve nada', async () => {
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(teacher))
        .expect(200);
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(teacher))
        .send({})
        .expect(403);
    });

    it('Professor de um espaço não vê a agenda de outro', async () => {
      const res = await view(teacher).expect(200);
      expect(res.body.items.some((i: { space: { id: string } }) => i.space.id === foreign.id)).toBe(
        false,
      );
    });
  });

  it('papéis diferentes por espaço e agenda só do respectivo espaço (RN-AUTH-03)', async () => {
    const res = await view(both).expect(200);
    const byId = Object.fromEntries(
      res.body.items.map((i: { space: { id: string } }) => [i.space.id, i]),
    );
    expect(byId[space.id].roles).toEqual(['TEACHER']);
    expect(byId[other.id].roles).toEqual(['ADMIN']);
    expect(byId[other.id].today.bookings).toEqual([]);
    expect(byId[space.id].today.bookings.length).toBeGreaterThan(0);
  });

  describe('espaço suspenso (RF-SUPER-03)', () => {
    let frozen: Space;
    let frozenTeacher: SignedUp;
    let frozenOwner: SignedUp;

    beforeAll(async () => {
      frozen = await createSpace(t.db, 'arena-suspensa');
      frozenOwner = await member(t, 'dono-suspenso@exemplo.com', frozen.id, 'OWNER');
      frozenTeacher = await member(t, 'professor-suspenso@exemplo.com', frozen.id, 'TEACHER');
      await book(frozen, at(today(), 15));
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, frozen.id));
    });

    it('continua na lista, com status SUSPENDED e a agenda do dia (só leitura)', async () => {
      for (const user of [frozenOwner, frozenTeacher]) {
        const res = await view(user).expect(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({
          space: { id: frozen.id, status: 'SUSPENDED' },
          today: { date: today() },
        });
        expect(res.body.items[0].today.bookings).toHaveLength(1);
      }
    });

    it('as escritas do painel seguem bloqueadas (403 SPACE_READ_ONLY) e a leitura funciona', async () => {
      await t
        .http()
        .get(`/v1/manage/spaces/${frozen.id}/bookings`)
        .set(...bearer(frozenOwner))
        .expect(200);
      const write = await t
        .http()
        .post(`/v1/manage/spaces/${frozen.id}/bookings`)
        .set(...bearer(frozenOwner))
        .send({
          courtId: frozen.courtA,
          sportId: frozen.sportId,
          startsAt: at(addDays(today(), 3), 10).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName: 'Sem App',
          guestPhone: '+5531999990000',
        })
        .expect(403);
      expect(write.body.error.code).toBe('SPACE_READ_ONLY');
    });

    it('reativado, o espaço volta a ACTIVE na visão', async () => {
      await t.db.update(spaces).set({ status: 'ACTIVE' }).where(eq(spaces.id, frozen.id));
      const res = await view(frozenTeacher).expect(200);
      expect(res.body.items[0].space.status).toBe('ACTIVE');
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, frozen.id));
    });

    it('papéis em outro espaço suspenso e vínculo removido: removido some, suspenso continua', async () => {
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, other.id));
      const suspended = await view(both).expect(200);
      expect(
        suspended.body.items.find((i: { space: { id: string } }) => i.space.id === other.id).space
          .status,
      ).toBe('SUSPENDED');

      await t.db
        .update(spaceMembers)
        .set({ status: 'REMOVED' })
        .where(eq(spaceMembers.userId, both.id));
      expect((await view(both).expect(200)).body).toEqual({ items: [] });
    });
  });

  it('é só leitura: nenhuma escrita na rota', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await t
        .http()
        [method]('/v1/me/staff-spaces')
        .set(...bearer(owner));
      expect(res.status).toBe(404);
    }
  });
});
