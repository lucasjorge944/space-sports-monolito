import { utcToZoned } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { courtOccupations, spaceSettings } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  PRICE_PER_HOUR,
  type Space,
  slotIn,
  useMiddayClock,
} from './fixtures.js';

const TZ = 'America/Sao_Paulo';

useMiddayClock();

describe('reservas avulsas', () => {
  let t: TestApp;
  let space: Space;
  let player: SignedUp;
  let other: SignedUp;
  let owner: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-reservas');
    player = await signUp(t, 'jogador@exemplo.com', 'Jogador Um');
    other = await signUp(t, 'outro@exemplo.com', 'Jogador Dois');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
  });
  afterAll(() => t.close());

  const book = (user: SignedUp, body: Record<string, unknown>) =>
    t
      .http()
      .post('/v1/bookings')
      .set(...bearer(user))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        durationMin: 60,
        peopleCount: 2,
        ...body,
      });

  describe('disponibilidade (RF-BOOK-02)', () => {
    it('é pública e lista slots de 30 em 30 min por quadra, com o preço proporcional', async () => {
      const startsAt = slotIn(26 * 60);
      const date = utcToZoned(startsAt, TZ).date;
      const res = await t
        .http()
        .get(`/v1/spaces/${space.id}/availability`)
        .query({ date, durationMin: 90, sportId: space.sportId })
        .expect(200);
      expect(res.body).toMatchObject({ date, timeZone: TZ, durationMin: 90, priceCents: 15_000 });
      expect(res.body.courts.map((c: { name: string }) => c.name)).toEqual([
        'Quadra A',
        'Quadra B',
      ]);
      const slots = res.body.courts[0].slots as { startsAt: string; available: boolean }[];
      // Aberto 24h: 48 inícios de 30 em 30 min no dia local.
      expect(slots).toHaveLength(48);
      const gaps = slots
        .slice(1)
        .map((s, i) => Date.parse(s.startsAt) - Date.parse(slots[i]?.startsAt ?? ''));
      expect(new Set(gaps)).toEqual(new Set([30 * 60_000]));
    });

    it('a reserva ocupa o slot só na quadra reservada, e o que vem antes da antecedência fica indisponível', async () => {
      const startsAt = slotIn(27 * 60);
      await book(player, { startsAt: startsAt.toISOString(), courtId: space.courtB }).expect(201);
      const date = utcToZoned(startsAt, TZ).date;
      const res = await t
        .http()
        .get(`/v1/spaces/${space.id}/availability`)
        .query({ date, durationMin: 60, sportId: space.sportId })
        .expect(200);
      const slotOf = (courtIndex: number, iso: string) =>
        res.body.courts[courtIndex].slots.find((s: { startsAt: string }) => s.startsAt === iso);
      expect(slotOf(1, startsAt.toISOString()).available).toBe(false);
      expect(slotOf(0, startsAt.toISOString()).available).toBe(true);
      // 30 min antes também conflita (60 min de duração).
      const before = new Date(startsAt.getTime() - 30 * 60_000).toISOString();
      expect(slotOf(1, before).available).toBe(false);

      const today = utcToZoned(new Date(), TZ).date;
      const now = await t
        .http()
        .get(`/v1/spaces/${space.id}/availability`)
        .query({ date: today, durationMin: 60, sportId: space.sportId })
        .expect(200);
      const soon = now.body.courts[0].slots.filter(
        (s: { startsAt: string }) => Date.parse(s.startsAt) < Date.now() + 60 * 60_000,
      );
      expect(soon.every((s: { available: boolean }) => !s.available)).toBe(true);
    });

    it('recusa duração fora dos limites do espaço', async () => {
      const res = await t
        .http()
        .get(`/v1/spaces/${space.id}/availability`)
        .query({ date: utcToZoned(new Date(), TZ).date, durationMin: 240, sportId: space.sportId })
        .expect(422);
      expect(res.body.error.code).toBe('DURATION_OUT_OF_RANGE');
    });
  });

  describe('criação (RF-BOOK-01, RN-BOOK-01..07)', () => {
    it('nasce CONFIRMED com o preço proporcional e ocupa a quadra', async () => {
      const startsAt = slotIn(28 * 60);
      const res = await book(player, {
        startsAt: startsAt.toISOString(),
        durationMin: 90,
        intendedPaymentMethod: 'PIX',
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
        source: 'APP',
        priceCents: (PRICE_PER_HOUR * 90) / 60,
        pricePerHourCents: PRICE_PER_HOUR,
        paidCents: 0,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
        intendedPaymentMethod: 'PIX',
        organizer: { userId: player.id, name: 'Jogador Um', phone: null },
        participants: [],
      });
      const occupations = await t.db
        .select()
        .from(courtOccupations)
        .where(and(eq(courtOccupations.kind, 'BOOKING'), eq(courtOccupations.refId, res.body.id)));
      expect(occupations).toHaveLength(1);
      expect(occupations[0]?.active).toBe(true);
    });

    it.each([
      [{ peopleCount: 5 }, 'PEOPLE_EXCEED_CAPACITY'],
      [{ durationMin: 30 }, 'DURATION_OUT_OF_RANGE'],
      [{ durationMin: 45 }, 'VALIDATION_ERROR'],
      [{ startsAt: () => new Date(slotIn(40 * 60).getTime() + 15 * 60_000) }, 'MISALIGNED_START'],
      [{ startsAt: () => slotIn(0) }, 'BOOKING_TOO_SOON'],
      [{ startsAt: () => slotIn(32 * 24 * 60) }, 'BOOKING_BEYOND_WINDOW'],
    ])('recusa %o com %s', async (override, code) => {
      const { startsAt, ...rest } = override as { startsAt?: () => Date };
      const res = await book(player, {
        startsAt: (startsAt?.() ?? slotIn(40 * 60)).toISOString(),
        ...rest,
      });
      expect(res.status).toBe(code === 'VALIDATION_ERROR' ? 400 : 422);
      expect(res.body.error.code).toBe(code);
    });

    it('quadra de outro espaço', async () => {
      const otherSpace = await createSpace(t.db, 'outro-espaco');
      const res = await book(player, {
        startsAt: slotIn(40 * 60).toISOString(),
        courtId: otherSpace.courtA,
      }).expect(404);
      expect(res.body.error.code).toBe('COURT_NOT_FOUND');
    });

    it('espaço sem preço/hora não aceita reserva', async () => {
      const unpriced = await createSpace(t.db, 'sem-preco');
      await t.db
        .update(spaceSettings)
        .set({ pricePerHourCents: null })
        .where(eq(spaceSettings.spaceId, unpriced.id));
      const res = await book(player, {
        spaceId: unpriced.id,
        courtId: unpriced.courtA,
        startsAt: slotIn(40 * 60).toISOString(),
      }).expect(422);
      expect(res.body.error.code).toBe('SPACE_NOT_BOOKABLE');
    });

    it('sem sessão responde 401', async () => {
      await t.http().post('/v1/bookings').send({}).expect(401);
    });
  });

  describe('concorrência (RN-BOOK-03)', () => {
    it('dois usuários no mesmo slot ao mesmo tempo: só um confirma, o outro recebe 409', async () => {
      const startsAt = slotIn(50 * 60).toISOString();
      const responses = await Promise.all([
        book(player, { startsAt, durationMin: 60 }),
        book(other, { startsAt, durationMin: 60 }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = responses.find((r) => r.status === 409);
      expect(loser?.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('rajada de reservas sobrepostas na mesma quadra: exatamente uma vence', async () => {
      const base = slotIn(55 * 60);
      // Períodos diferentes, mas todos se sobrepõem a base+30..base+60.
      const starts = [0, 30, 0, 30, 0, 30, 0, 30].map((m) =>
        new Date(base.getTime() + m * 60_000).toISOString(),
      );
      const responses = await Promise.all(
        starts.map((startsAt, i) => book(i % 2 ? other : player, { startsAt, durationMin: 60 })),
      );
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(starts.length - 1);
      const active = await t.db
        .select()
        .from(courtOccupations)
        .where(and(eq(courtOccupations.courtId, space.courtA), eq(courtOccupations.active, true)));
      const overlapping = active.filter(
        (o) => o.period.start < new Date(base.getTime() + 90 * 60_000) && o.period.end > base,
      );
      expect(overlapping).toHaveLength(1);
    });

    it('horários adjacentes não conflitam', async () => {
      const start = slotIn(60 * 60);
      const next = new Date(start.getTime() + 60 * 60_000);
      await book(player, { startsAt: start.toISOString() }).expect(201);
      await book(other, { startsAt: next.toISOString() }).expect(201);
    });
  });

  describe('cancelamento (RN-BOOK-05)', () => {
    it('o organizador cancela dentro do prazo e a quadra é liberada', async () => {
      const startsAt = slotIn(70 * 60).toISOString();
      const created = await book(player, { startsAt }).expect(201);
      expect(Date.parse(created.body.cancellableUntil)).toBe(Date.parse(startsAt) - 60 * 60_000);

      const res = await t
        .http()
        .post(`/v1/bookings/${created.body.id}/cancel`)
        .set(...bearer(player))
        .send({ reason: 'Choveu' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Choveu' });
      expect(res.body.cancelledAt).toBeTruthy();
      const [occupation] = await t.db
        .select()
        .from(courtOccupations)
        .where(eq(courtOccupations.refId, created.body.id));
      expect(occupation?.active).toBe(false);

      // O mesmo slot volta a ficar reservável.
      await book(other, { startsAt }).expect(201);

      // Cancelar de novo: status inválido.
      const again = await t
        .http()
        .post(`/v1/bookings/${created.body.id}/cancel`)
        .set(...bearer(player))
        .send({})
        .expect(409);
      expect(again.body.error.code).toBe('INVALID_BOOKING_STATUS');
    });

    it('depois do prazo o jogador não cancela ("fale com o espaço"); a gestão cancela', async () => {
      // Prazo de 3h e reserva daqui a ~2h: já passou do prazo.
      await t.db
        .update(spaceSettings)
        .set({ cancellationDeadlineMin: 180 })
        .where(eq(spaceSettings.spaceId, space.id));
      try {
        const created = await book(player, { startsAt: slotIn(120).toISOString() }).expect(201);
        const res = await t
          .http()
          .post(`/v1/bookings/${created.body.id}/cancel`)
          .set(...bearer(player))
          .send({})
          .expect(422);
        expect(res.body.error.code).toBe('CANCELLATION_DEADLINE_PASSED');
        expect(res.body.error.details.cancellableUntil).toBe(created.body.cancellableUntil);

        const staff = await t
          .http()
          .post(`/v1/manage/spaces/${space.id}/bookings/${created.body.id}/cancel`)
          .set(...bearer(owner))
          .send({ reason: 'Pedido por WhatsApp' })
          .expect(200);
        expect(staff.body.status).toBe('CANCELLED');
      } finally {
        await t.db
          .update(spaceSettings)
          .set({ cancellationDeadlineMin: 60 })
          .where(eq(spaceSettings.spaceId, space.id));
      }
    });

    it('só o organizador cancela pelo app (outro usuário recebe 404)', async () => {
      const created = await book(player, { startsAt: slotIn(75 * 60).toISOString() }).expect(201);
      const res = await t
        .http()
        .post(`/v1/bookings/${created.body.id}/cancel`)
        .set(...bearer(other))
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    });
  });

  describe('minhas reservas (RF-BOOK-03)', () => {
    it('próximas em ordem crescente, paginadas por cursor; canceladas vão para passadas', async () => {
      const fresh = await signUp(t, 'lista@exemplo.com');
      const starts = [80, 82, 84].map((h) => slotIn(h * 60).toISOString());
      const ids: string[] = [];
      for (const startsAt of starts) {
        ids.push((await book(fresh, { startsAt, courtId: space.courtB }).expect(201)).body.id);
      }
      await t
        .http()
        .post(`/v1/bookings/${ids[2]}/cancel`)
        .set(...bearer(fresh))
        .send({})
        .expect(200);

      const page1 = await t
        .http()
        .get('/v1/bookings')
        .query({ when: 'upcoming', limit: 1 })
        .set(...bearer(fresh))
        .expect(200);
      expect(page1.body.items.map((b: { id: string }) => b.id)).toEqual([ids[0]]);
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await t
        .http()
        .get('/v1/bookings')
        .query({ when: 'upcoming', limit: 1, cursor: page1.body.nextCursor })
        .set(...bearer(fresh))
        .expect(200);
      expect(page2.body.items.map((b: { id: string }) => b.id)).toEqual([ids[1]]);
      expect(page2.body.nextCursor).toBeNull();

      const past = await t
        .http()
        .get('/v1/bookings')
        .query({ when: 'past' })
        .set(...bearer(fresh))
        .expect(200);
      expect(past.body.items.map((b: { id: string }) => b.id)).toEqual([ids[2]]);

      await t
        .http()
        .get('/v1/bookings')
        .query({ cursor: 'lixo' })
        .set(...bearer(fresh))
        .expect(400);
    });

    it('detalhe: só quem participa vê', async () => {
      const created = await book(player, { startsAt: slotIn(90 * 60).toISOString() }).expect(201);
      await t
        .http()
        .get(`/v1/bookings/${created.body.id}`)
        .set(...bearer(player))
        .expect(200);
      await t
        .http()
        .get(`/v1/bookings/${created.body.id}`)
        .set(...bearer(other))
        .expect(404);
    });
  });
});
