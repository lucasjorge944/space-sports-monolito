import { addMinutes } from '@space-sports/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookings,
  courtOccupations,
  recurringBookingCharges,
  recurringBookings,
  spaceOpeningHours,
  spaces,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { occurrenceStart, slotWeekday } from './fixtures.js';

// RF-BOOK-05, RF-BOOK-07, RN-BOOK-08: solicitação, aprovação, conflito, pausa e encerramento.

useMiddayClock();

describe('mensalista: solicitação, aprovação e ciclo de vida', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let otherOwner: SignedUp;
  let otherSpace: Space;
  let player: SignedUp;
  let stranger: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-mensalista');
    otherSpace = await createSpace(t.db, 'arena-vizinha-mensalista');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
    otherOwner = await member(t, 'dono-vizinho@exemplo.com', otherSpace.id, 'OWNER');
    player = await signUp(t, 'jogador@exemplo.com', 'Jogador');
    stranger = await signUp(t, 'outro@exemplo.com', 'Outro Jogador');
  });
  afterAll(() => t.close());

  /**
   * Horários distintos (de 30 em 30 min) por teste, para um não ocupar a agenda do outro. Todos
   * os horários fixos dos testes têm 30 min, então 48 cabem na quadra.
   */
  let slotIndex = 0;
  const nextTime = () => {
    const i = slotIndex++;
    return `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  };

  const slot = (startTime: string, extra: Record<string, unknown> = {}) => ({
    courtId: space.courtA,
    sportId: space.sportId,
    weekday: slotWeekday(),
    startTime,
    durationMin: 30,
    peopleCount: 4,
    ...extra,
  });

  const request = (user: SignedUp, startTime: string, extra: Record<string, unknown> = {}) =>
    t
      .http()
      .post('/v1/recurring-bookings')
      .set(...bearer(user))
      .send({ spaceId: space.id, ...slot(startTime), ...extra });

  const manage = (path: string) => `/v1/manage/spaces/${space.id}/${path}`;
  const act = (user: SignedUp, id: string, action: string, body: object = {}) =>
    t
      .http()
      .post(manage(`recurring-bookings/${id}/${action}`))
      .set(...bearer(user))
      .send(body);

  const occurrences = (recurringId: string) =>
    t.db
      .select()
      .from(bookings)
      .where(eq(bookings.recurringBookingId, recurringId))
      .orderBy(asc(bookings.startsAt));

  const activeOccupations = async (recurringId: string) => {
    const rows = await occurrences(recurringId);
    if (!rows.length) return [];
    return t.db
      .select()
      .from(courtOccupations)
      .where(
        and(
          eq(courtOccupations.kind, 'BOOKING'),
          eq(courtOccupations.active, true),
          inArray(
            courtOccupations.refId,
            rows.map((b) => b.id),
          ),
        ),
      );
  };

  const deskBooking = (startsAt: Date, courtId = space.courtA) =>
    t
      .http()
      .post(manage('bookings'))
      .set(...bearer(admin))
      .send({
        courtId,
        sportId: space.sportId,
        startsAt: startsAt.toISOString(),
        durationMin: 30,
        peopleCount: 2,
        guestName: 'Avulso',
        guestPhone: '+5531988887777',
      });

  describe('solicitação pelo jogador (RF-BOOK-05)', () => {
    it('nasce PENDING_APPROVAL, ainda sem ocorrências, e o jogador acompanha o status', async () => {
      const startTime = nextTime();
      const res = await request(player, startTime).expect(201);
      expect(res.body).toMatchObject({
        status: 'PENDING_APPROVAL',
        weekday: slotWeekday(),
        startTime,
        durationMin: 30,
        peopleCount: 4,
        customer: { userId: player.id, name: 'Jogador', phone: null },
        court: { id: space.courtA },
        conflicts: [],
      });
      // Decisão 27: sem mensalidade nem valor mensal na resposta.
      expect(res.body).not.toHaveProperty('charges');
      expect(res.body).not.toHaveProperty('monthlyPriceCents');
      expect(await occurrences(res.body.id)).toHaveLength(0);

      const mine = await t
        .http()
        .get('/v1/recurring-bookings')
        .set(...bearer(player))
        .expect(200);
      expect(mine.body.map((r: { id: string }) => r.id)).toContain(res.body.id);
      await t
        .http()
        .get(`/v1/recurring-bookings/${res.body.id}`)
        .set(...bearer(player))
        .expect(200);
    });

    it('não aceita solicitação pendente duplicada do mesmo horário, nem em requisições simultâneas', async () => {
      const startTime = nextTime();
      const results = await Promise.all([
        request(player, startTime),
        request(player, startTime),
        request(player, startTime),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const refused = results.find((r) => r.status === 409);
      expect(refused?.body.error.code).toBe('RECURRING_REQUEST_DUPLICATE');
      const own = await t.db
        .select()
        .from(recurringBookings)
        .where(
          and(eq(recurringBookings.userId, player.id), eq(recurringBookings.startTime, startTime)),
        );
      expect(own).toHaveLength(1);

      // Outro jogador no mesmo horário, e o mesmo jogador em outro horário, não são duplicata.
      await request(await signUp(t, 'outra-pessoa@exemplo.com'), startTime).expect(201);
      await request(player, nextTime()).expect(201);
    });

    it('depois de recusada ou retirada, o jogador pode solicitar o mesmo horário de novo', async () => {
      const startTime = nextTime();
      const first = await request(player, startTime).expect(201);
      await act(admin, first.body.id, 'reject', { reason: 'Sem vaga' }).expect(200);
      const second = await request(player, startTime).expect(201);
      await t
        .http()
        .post(`/v1/recurring-bookings/${second.body.id}/end`)
        .set(...bearer(player))
        .send({})
        .expect(200);
      await request(player, startTime).expect(201);
    });

    it('o mensalista de um jogador não aparece para outro', async () => {
      const created = await request(player, nextTime()).expect(201);
      await t
        .http()
        .get(`/v1/recurring-bookings/${created.body.id}`)
        .set(...bearer(stranger))
        .expect(404);
      const mine = await t
        .http()
        .get('/v1/recurring-bookings')
        .set(...bearer(stranger))
        .expect(200);
      expect(mine.body).toEqual([]);
    });

    it('exige login', async () => {
      await t.http().post('/v1/recurring-bookings').send({}).expect(401);
      await t.http().get('/v1/recurring-bookings').expect(401);
    });

    it('valida horário e duração em múltiplos de 30 min (RN-BOOK-02)', async () => {
      await request(player, '19:15').expect(400);
      await request(player, '19:00', { durationMin: 45 }).expect(400);
      await request(player, '19:00', { weekday: 7 }).expect(400);
    });

    it('recusa horário fora do funcionamento', async () => {
      const closed = await createSpace(t.db, 'arena-horario-limitado');
      // Aberto só das 08:00 às 22:00.
      await t.db.delete(spaceOpeningHours).where(eq(spaceOpeningHours.spaceId, closed.id));
      await t.db.insert(spaceOpeningHours).values(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          spaceId: closed.id,
          weekday,
          opensAt: '08:00',
          closesAt: '22:00',
        })),
      );
      const body = {
        spaceId: closed.id,
        ...slot('06:00'),
        courtId: closed.courtA,
        sportId: closed.sportId,
      };
      const res = await t
        .http()
        .post('/v1/recurring-bookings')
        .set(...bearer(player))
        .send(body)
        .expect(422);
      expect(res.body.error.code).toBe('OUTSIDE_OPENING_HOURS');
      // Dentro do funcionamento, o mesmo pedido passa.
      await t
        .http()
        .post('/v1/recurring-bookings')
        .set(...bearer(player))
        .send({ ...body, startTime: '19:00' })
        .expect(201);
    });

    it('recusa quadra de outro espaço e esporte que a quadra não oferece', async () => {
      const other = await createSpace(t.db, 'arena-outra-quadra');
      const res = await request(player, nextTime(), { courtId: other.courtA }).expect(404);
      expect(res.body.error.code).toBe('COURT_NOT_FOUND');
      const sport = await request(player, nextTime(), {
        sportId: '00000000-0000-7000-8000-000000000000',
      }).expect(422);
      expect(sport.body.error.code).toBe('SPORT_NOT_OFFERED');
    });

    it('recusa mais pessoas que a capacidade da quadra e início no passado', async () => {
      const people = await request(player, nextTime(), { peopleCount: 5 }).expect(422);
      expect(people.body.error.code).toBe('PEOPLE_EXCEED_CAPACITY');
      const past = await request(player, nextTime(), { startsOn: '2020-01-01' }).expect(422);
      expect(past.body.error.code).toBe('RECURRING_START_IN_PAST');
    });

    it('não depende de valor mensal configurado (decisão 27): solicitação e aprovação passam', async () => {
      const bare = await createSpace(t.db, 'arena-sem-valor-mensal');
      const staff = await member(t, 'gestor-sem-valor@exemplo.com', bare.id, 'ADMIN');
      const created = await t
        .http()
        .post('/v1/recurring-bookings')
        .set(...bearer(player))
        .send({ spaceId: bare.id, ...slot('19:00'), courtId: bare.courtA, sportId: bare.sportId })
        .expect(201);
      const approved = await t
        .http()
        .post(`/v1/manage/spaces/${bare.id}/recurring-bookings/${created.body.id}/approve`)
        .set(...bearer(staff))
        .send({})
        .expect(200);
      expect(approved.body.status).toBe('ACTIVE');
      expect(await occurrences(created.body.id)).toHaveLength(4);
      const charges = await t.db
        .select()
        .from(recurringBookingCharges)
        .where(eq(recurringBookingCharges.recurringBookingId, created.body.id));
      expect(charges).toEqual([]);
    });
  });

  describe('aprovação (RF-BOOK-07)', () => {
    it('Dono e Admin aprovam; vira ACTIVE com 4 semanas de ocorrências sem cobrança própria', async () => {
      for (const [who, user] of [
        ['dono', owner],
        ['admin', admin],
      ] as const) {
        const startTime = nextTime();
        const created = await request(player, startTime).expect(201);
        const res = await act(user, created.body.id, 'approve').expect(200);
        expect(res.body.status, who).toBe('ACTIVE');

        const rows = await occurrences(created.body.id);
        expect(rows, who).toHaveLength(4);
        expect(rows.map((b) => b.startsAt)).toEqual(
          [0, 1, 2, 3].map((n) => occurrenceStart(n, startTime)),
        );
        for (const booking of rows) {
          expect(booking).toMatchObject({
            source: 'RECURRING',
            status: 'CONFIRMED',
            priceCents: 0,
            paymentStatus: 'PAID',
            organizerUserId: player.id,
            courtId: space.courtA,
            durationMin: 30,
          });
          expect(booking.endsAt).toEqual(addMinutes(booking.startsAt, 30));
        }
        expect(await activeOccupations(created.body.id), who).toHaveLength(4);
      }
    });

    it('as ocorrências aparecem na agenda do espaço e no app do jogador', async () => {
      const startTime = nextTime();
      const created = await request(player, startTime).expect(201);
      await act(admin, created.body.id, 'approve').expect(200);

      const agenda = await t
        .http()
        .get(manage('bookings?source=RECURRING&limit=100'))
        .set(...bearer(teacher))
        .expect(200);
      const mine = agenda.body.items.filter(
        (b: { startsAt: string }) =>
          new Date(b.startsAt).getTime() === occurrenceStart(0, startTime).getTime(),
      );
      expect(mine).toHaveLength(1);
      // Decisão 53: o Professor vê a agenda, sem valores.
      expect(mine[0]).toMatchObject({ source: 'RECURRING', priceCents: null, paidCents: null });
      const managed = await t
        .http()
        .get(manage('bookings?source=RECURRING&limit=100'))
        .set(...bearer(admin))
        .expect(200);
      expect(managed.body.items.find((b: { id: string }) => b.id === mine[0].id)).toMatchObject({
        priceCents: 0,
        paidCents: 0,
      });

      const bookingsOfPlayer = await t
        .http()
        .get('/v1/bookings?limit=100')
        .set(...bearer(player))
        .expect(200);
      expect(
        bookingsOfPlayer.body.items.some(
          (b: { startsAt: string; source: string }) =>
            b.source === 'RECURRING' &&
            new Date(b.startsAt).getTime() === occurrenceStart(0, startTime).getTime(),
        ),
      ).toBe(true);
    });

    it('não gera mensalidade (decisão 27): o mensalista só ocupa a agenda', async () => {
      const created = await request(player, nextTime()).expect(201);
      const res = await act(admin, created.body.id, 'approve').expect(200);
      expect(res.body).not.toHaveProperty('charges');
      const charges = await t.db
        .select()
        .from(recurringBookingCharges)
        .where(eq(recurringBookingCharges.recurringBookingId, created.body.id));
      expect(charges).toEqual([]);
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.entityId, created.body.id), eq(auditLogs.action, 'recurring.approve')),
        );
      expect(log?.diff).not.toHaveProperty('chargeCreated');
    });

    it('conflito de horário com outra reserva: 409 SLOT_UNAVAILABLE e nada muda', async () => {
      const startTime = nextTime();
      const created = await request(player, startTime).expect(201);
      // Reserva avulsa na 3ª semana, no mesmo horário e quadra.
      await deskBooking(occurrenceStart(2, startTime)).expect(201);

      const res = await act(admin, created.body.id, 'approve').expect(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      const [row] = await t.db
        .select()
        .from(recurringBookings)
        .where(eq(recurringBookings.id, created.body.id));
      expect(row?.status).toBe('PENDING_APPROVAL');
      expect(await occurrences(created.body.id)).toHaveLength(0);
      const charges = await t.db
        .select()
        .from(recurringBookingCharges)
        .where(eq(recurringBookingCharges.recurringBookingId, created.body.id));
      expect(charges).toHaveLength(0);
    });

    it('bloqueio pontual não impede a aprovação: a ocorrência é sinalizada para a gestão', async () => {
      const startTime = nextTime();
      const created = await request(player, startTime).expect(201);
      const start = occurrenceStart(1, startTime);
      await t
        .http()
        .post(manage('court-blocks'))
        .set(...bearer(admin))
        .send({
          courtId: space.courtA,
          startsAt: start.toISOString(),
          endsAt: addMinutes(start, 30).toISOString(),
          reason: 'Manutenção da rede',
        })
        .expect(201);

      const res = await act(admin, created.body.id, 'approve').expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(await occurrences(created.body.id)).toHaveLength(3);
      expect(res.body.conflicts).toHaveLength(1);
      expect(res.body.conflicts[0]).toMatchObject({
        conflictsWith: 'BLOCK',
        startsAt: start.toISOString(),
        recurringBookingId: created.body.id,
        customer: { name: 'Jogador' },
      });

      const list = await t
        .http()
        .get(manage('recurring-conflicts'))
        .set(...bearer(admin))
        .expect(200);
      expect(
        list.body.some(
          (c: { recurringBookingId: string }) => c.recurringBookingId === created.body.id,
        ),
      ).toBe(true);
    });

    it('só aprova solicitação pendente; recusa guarda o motivo', async () => {
      const created = await request(player, nextTime()).expect(201);
      const rejected = await act(admin, created.body.id, 'reject', {
        reason: 'Horário reservado para aulas',
      }).expect(200);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        statusReason: 'Horário reservado para aulas',
      });
      for (const action of ['approve', 'reject', 'pause', 'resume', 'end']) {
        const res = await act(admin, created.body.id, action).expect(409);
        expect(res.body.error.code).toBe('INVALID_RECURRING_STATUS');
      }

      const active = await request(player, nextTime()).expect(201);
      await act(admin, active.body.id, 'approve').expect(200);
      await act(admin, active.body.id, 'approve').expect(409);
      await act(admin, active.body.id, 'reject').expect(409);
      // Pendente não pausa nem encerra pela gestão (recusa-se).
      const pending = await request(player, nextTime()).expect(201);
      await act(admin, pending.body.id, 'pause').expect(409);
      await act(admin, pending.body.id, 'end').expect(409);
    });
  });

  describe('cadastro direto pela gestão', () => {
    const desk = (user: SignedUp, startTime: string, extra: Record<string, unknown> = {}) =>
      t
        .http()
        .post(manage('recurring-bookings'))
        .set(...bearer(user))
        .send({
          ...slot(startTime),
          guestName: 'Cliente Balcão',
          guestPhone: '+5531988887777',
          ...extra,
        });

    it('nasce ACTIVE, com ocorrências e telefone visível à gestão, sem mensalidade', async () => {
      const startTime = nextTime();
      const res = await desk(admin, startTime).expect(201);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        customer: { userId: null, name: 'Cliente Balcão', phone: '+5531988887777' },
      });
      expect(res.body).not.toHaveProperty('charges');
      const rows = await occurrences(res.body.id);
      expect(rows).toHaveLength(4);
      expect(
        rows.every((b) => b.guestName === 'Cliente Balcão' && b.organizerUserId === null),
      ).toBe(true);
    });

    it('cliente com app por id: o mensalista aparece no app dele', async () => {
      const res = await desk(admin, nextTime(), {
        guestName: undefined,
        guestPhone: undefined,
        customerUserId: player.id,
      }).expect(201);
      expect(res.body.customer).toMatchObject({ userId: player.id, name: 'Jogador' });
      const mine = await t
        .http()
        .get(`/v1/recurring-bookings/${res.body.id}`)
        .set(...bearer(player))
        .expect(200);
      // O jogador não vê o telefone de cadastro.
      expect(mine.body.customer.phone).toBeNull();
    });

    it('cliente inexistente: 404; dados de cliente incompletos: 400', async () => {
      const res = await desk(admin, nextTime(), {
        guestName: undefined,
        guestPhone: undefined,
        customerUserId: '00000000-0000-7000-8000-000000000000',
      }).expect(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
      await desk(admin, nextTime(), { guestPhone: undefined }).expect(400);
    });

    it('conflito de horário: 409 SLOT_UNAVAILABLE e nenhum mensalista é criado', async () => {
      const startTime = nextTime();
      await deskBooking(occurrenceStart(0, startTime)).expect(201);
      const before = await t.db.select().from(recurringBookings);
      const res = await desk(admin, startTime).expect(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await t.db.select().from(recurringBookings)).toHaveLength(before.length);
    });

    it('dois mensalistas no mesmo horário: o segundo recebe 409', async () => {
      const startTime = nextTime();
      await desk(admin, startTime).expect(201);
      const res = await desk(admin, startTime).expect(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      // Quadra B do mesmo horário está livre.
      await desk(admin, startTime, { courtId: space.courtB }).expect(201);
    });
  });

  describe('pausa, retomada e encerramento', () => {
    const approved = async (startTime = nextTime()) => {
      const created = await request(player, startTime).expect(201);
      await act(admin, created.body.id, 'approve').expect(200);
      return { id: created.body.id as string, startTime };
    };

    it('pausar cancela as ocorrências futuras, libera a quadra e guarda o motivo', async () => {
      const { id, startTime } = await approved();
      const res = await act(admin, id, 'pause', { reason: 'Viagem' }).expect(200);
      expect(res.body).toMatchObject({ status: 'PAUSED', statusReason: 'Viagem' });

      const rows = await occurrences(id);
      expect(rows).toHaveLength(4);
      expect(rows.every((b) => b.status === 'CANCELLED' && b.cancelledAt !== null)).toBe(true);
      expect(await activeOccupations(id)).toHaveLength(0);
      // A quadra está livre: outra pessoa reserva o horário.
      await deskBooking(occurrenceStart(1, startTime)).expect(201);
    });

    it('pausar não toca a ocorrência que já começou', async () => {
      const { id } = await approved();
      const [started] = await occurrences(id);
      if (!started) throw new Error('Sem ocorrências.');
      // A primeira ocorrência está em andamento: começou há 10 min e termina em 20 min.
      const startsAt = addMinutes(new Date(), -10);
      await t.db
        .update(bookings)
        .set({ startsAt, endsAt: addMinutes(startsAt, 30) })
        .where(eq(bookings.id, started.id));

      await act(admin, id, 'pause').expect(200);
      const rows = await occurrences(id);
      expect(rows.find((b) => b.id === started.id)?.status).toBe('CONFIRMED');
      expect(rows.filter((b) => b.status === 'CANCELLED')).toHaveLength(3);
    });

    it('retomar regenera as ocorrências canceladas pela pausa', async () => {
      const { id } = await approved();
      await act(admin, id, 'pause').expect(200);
      const res = await act(admin, id, 'resume').expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.statusReason).toBeNull();
      const rows = await occurrences(id);
      expect(rows).toHaveLength(4);
      expect(rows.every((b) => b.status === 'CONFIRMED' && b.cancelReason === null)).toBe(true);
      expect(await activeOccupations(id)).toHaveLength(4);
    });

    it('retomar não reativa a ocorrência cancelada à mão, mesmo com o texto do motivo da pausa', async () => {
      const { id } = await approved();
      const [, second] = await occurrences(id);
      if (!second) throw new Error('Sem ocorrências.');
      // A gestão cancela uma semana usando, por acaso, o mesmo texto do motivo da pausa.
      await t
        .http()
        .post(manage(`bookings/${second.id}/cancel`))
        .set(...bearer(admin))
        .send({ reason: 'Mensalista pausado' })
        .expect(200);

      await act(admin, id, 'pause').expect(200);
      const paused = await occurrences(id);
      expect(paused.filter((b) => b.cancelledByPause).map((b) => b.id)).toHaveLength(3);
      expect(paused.find((b) => b.id === second.id)?.cancelledByPause).toBe(false);

      await act(admin, id, 'resume').expect(200);
      const rows = await occurrences(id);
      expect(rows.find((b) => b.id === second.id)?.status).toBe('CANCELLED');
      expect(rows.filter((b) => b.status === 'CONFIRMED')).toHaveLength(3);
      expect(rows.some((b) => b.cancelledByPause)).toBe(false);
      expect(await activeOccupations(id)).toHaveLength(3);
    });

    it('retomar com o horário ocupado enquanto pausado: 409 SLOT_UNAVAILABLE e segue pausado', async () => {
      const { id, startTime } = await approved();
      await act(admin, id, 'pause').expect(200);
      const taken = await deskBooking(occurrenceStart(1, startTime)).expect(201);

      const res = await act(admin, id, 'resume').expect(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      const [row] = await t.db.select().from(recurringBookings).where(eq(recurringBookings.id, id));
      expect(row?.status).toBe('PAUSED');
      expect(await activeOccupations(id)).toHaveLength(0);

      // Liberado o horário, a retomada funciona.
      await t
        .http()
        .post(manage(`bookings/${taken.body.id}/cancel`))
        .set(...bearer(admin))
        .send({})
        .expect(200);
      await act(admin, id, 'resume').expect(200);
      expect(await activeOccupations(id)).toHaveLength(4);
    });

    it('encerrar é definitivo: cancela as futuras, libera a quadra e fecha a data', async () => {
      const { id, startTime } = await approved();
      const res = await act(admin, id, 'end', { reason: 'Mudou de cidade' }).expect(200);
      expect(res.body).toMatchObject({ status: 'ENDED', statusReason: 'Mudou de cidade' });
      expect(res.body.endsOn).not.toBeNull();
      expect((await occurrences(id)).every((b) => b.status === 'CANCELLED')).toBe(true);
      expect(await activeOccupations(id)).toHaveLength(0);
      await deskBooking(occurrenceStart(0, startTime)).expect(201);
      for (const action of ['approve', 'pause', 'resume', 'end']) {
        await act(admin, id, action).expect(409);
      }
    });

    it('encerrar também vale para mensalista pausado', async () => {
      const { id } = await approved();
      await act(admin, id, 'pause').expect(200);
      const res = await act(admin, id, 'end').expect(200);
      expect(res.body.status).toBe('ENDED');
    });

    it('o jogador encerra o seu mensalista; não o de outro', async () => {
      const { id } = await approved();
      await t
        .http()
        .post(`/v1/recurring-bookings/${id}/end`)
        .set(...bearer(stranger))
        .send({})
        .expect(404);

      const res = await t
        .http()
        .post(`/v1/recurring-bookings/${id}/end`)
        .set(...bearer(player))
        .send({ reason: 'Não consigo mais jogar' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'ENDED', statusReason: 'Não consigo mais jogar' });
      expect(await activeOccupations(id)).toHaveLength(0);
      const again = await t
        .http()
        .post(`/v1/recurring-bookings/${id}/end`)
        .set(...bearer(player))
        .send({})
        .expect(409);
      expect(again.body.error.code).toBe('INVALID_RECURRING_STATUS');
    });

    it('o jogador retira a solicitação ainda pendente', async () => {
      const created = await request(player, nextTime()).expect(201);
      const res = await t
        .http()
        .post(`/v1/recurring-bookings/${created.body.id}/end`)
        .set(...bearer(player))
        .send({})
        .expect(200);
      expect(res.body.status).toBe('ENDED');
      await act(admin, created.body.id, 'approve').expect(409);
    });

    it('registra a decisão na auditoria', async () => {
      const { id } = await approved();
      await act(admin, id, 'pause', { reason: 'Férias' }).expect(200);
      await act(admin, id, 'resume').expect(200);
      await act(owner, id, 'end').expect(200);
      const logs = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entity, 'recurring_booking'), eq(auditLogs.entityId, id)))
        .orderBy(asc(auditLogs.createdAt));
      expect(logs.map((l) => l.action)).toEqual([
        'recurring.approve',
        'recurring.pause',
        'recurring.resume',
        'recurring.end',
      ]);
      expect(logs.every((l) => l.spaceId === space.id && l.actorId !== null)).toBe(true);
      expect(logs[1]?.diff).toMatchObject({ from: 'ACTIVE', to: 'PAUSED', reason: 'Férias' });
    });
  });

  describe('permissões por papel e isolamento entre espaços', () => {
    it('Professor só visualiza; jogador e dono de outro espaço não gerenciam', async () => {
      const created = await request(player, nextTime()).expect(201);
      const id = created.body.id as string;

      // Leitura: Dono, Admin e Professor.
      for (const user of [owner, admin, teacher]) {
        await t
          .http()
          .get(manage('recurring-bookings'))
          .set(...bearer(user))
          .expect(200);
        await t
          .http()
          .get(manage(`recurring-bookings/${id}`))
          .set(...bearer(user))
          .expect(200);
        await t
          .http()
          .get(manage('recurring-conflicts'))
          .set(...bearer(user))
          .expect(200);
      }

      // Escrita: o Professor não aprova, recusa, pausa, encerra nem cadastra.
      for (const action of ['approve', 'reject', 'pause', 'resume', 'end']) {
        await act(teacher, id, action).expect(403);
      }
      await t
        .http()
        .post(manage('recurring-bookings'))
        .set(...bearer(teacher))
        .send({ ...slot(nextTime()), guestName: 'X', guestPhone: '+5531988887777' })
        .expect(403);

      // Jogador comum e dono de outro espaço.
      for (const user of [player, otherOwner]) {
        await t
          .http()
          .get(manage('recurring-bookings'))
          .set(...bearer(user))
          .expect(403);
        await act(user, id, 'approve').expect(403);
      }
      await t.http().get(manage('recurring-bookings')).expect(401);

      // A solicitação continua pendente.
      const [row] = await t.db.select().from(recurringBookings).where(eq(recurringBookings.id, id));
      expect(row?.status).toBe('PENDING_APPROVAL');
    });

    it('as rotas de mensalidade deixaram de existir (decisão 27): 404 para todos', async () => {
      const chargeId = '0198f3a0-0000-7000-8000-000000000001';
      for (const user of [owner, admin]) {
        await t
          .http()
          .get(manage('recurring-charges'))
          .set(...bearer(user))
          .expect(404);
        await t
          .http()
          .post(manage(`recurring-charges/${chargeId}/waive`))
          .set(...bearer(user))
          .send({})
          .expect(404);
      }
    });

    it('mensalista de outro espaço responde 404 na rota do espaço', async () => {
      const created = await request(player, nextTime()).expect(201);
      await t
        .http()
        .get(`/v1/manage/spaces/${otherSpace.id}/recurring-bookings/${created.body.id}`)
        .set(...bearer(otherOwner))
        .expect(404);
      await t
        .http()
        .post(`/v1/manage/spaces/${otherSpace.id}/recurring-bookings/${created.body.id}/approve`)
        .set(...bearer(otherOwner))
        .send({})
        .expect(404);
    });

    it('lista filtra por status e busca por nome', async () => {
      const startTime = nextTime();
      const created = await request(stranger, startTime).expect(201);
      const pending = await t
        .http()
        .get(manage('recurring-bookings?status=PENDING_APPROVAL&q=Outro Jogador&limit=100'))
        .set(...bearer(admin))
        .expect(200);
      expect(pending.body.items.map((r: { id: string }) => r.id)).toContain(created.body.id);
      expect(
        pending.body.items.every((r: { status: string }) => r.status === 'PENDING_APPROVAL'),
      ).toBe(true);

      const none = await t
        .http()
        .get(manage('recurring-bookings?status=ENDED&q=Outro Jogador'))
        .set(...bearer(admin))
        .expect(200);
      expect(none.body.items).toEqual([]);

      const page1 = await t
        .http()
        .get(manage('recurring-bookings?limit=2'))
        .set(...bearer(admin))
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).not.toBeNull();
      const page2 = await t
        .http()
        .get(manage(`recurring-bookings?limit=2&cursor=${page1.body.nextCursor}`))
        .set(...bearer(admin))
        .expect(200);
      const ids = [...page1.body.items, ...page2.body.items].map((r: { id: string }) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('espaço suspenso: só leitura (RF-SUPER-03)', () => {
    it('a gestão não escreve e o jogador não solicita nem encerra', async () => {
      const suspended = await createSpace(t.db, 'arena-mensalista-suspensa');
      const staff = await member(t, 'gestor-suspensa@exemplo.com', suspended.id, 'ADMIN');
      const body = { ...slot('19:00'), courtId: suspended.courtA, sportId: suspended.sportId };
      const created = await t
        .http()
        .post('/v1/recurring-bookings')
        .set(...bearer(player))
        .send({ spaceId: suspended.id, ...body })
        .expect(201);

      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, suspended.id));

      const url = `/v1/manage/spaces/${suspended.id}/recurring-bookings`;
      const approve = await t
        .http()
        .post(`${url}/${created.body.id}/approve`)
        .set(...bearer(staff))
        .send({})
        .expect(403);
      expect(approve.body.error.code).toBe('SPACE_READ_ONLY');
      await t
        .http()
        .get(url)
        .set(...bearer(staff))
        .expect(200);

      const request422 = await t
        .http()
        .post('/v1/recurring-bookings')
        .set(...bearer(player))
        .send({ spaceId: suspended.id, ...body })
        .expect(422);
      expect(request422.body.error.code).toBe('SPACE_NOT_BOOKABLE');
      const end = await t
        .http()
        .post(`/v1/recurring-bookings/${created.body.id}/end`)
        .set(...bearer(player))
        .send({})
        .expect(403);
      expect(end.body.error.code).toBe('SPACE_READ_ONLY');
    });
  });
});
