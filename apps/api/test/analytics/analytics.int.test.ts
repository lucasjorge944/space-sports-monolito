import { addDays, utcToZoned } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  recurringBookings,
  spaces,
  subscriptionCharges,
  subscriptions,
  users,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { enroll, teacherMemberId } from '../classes/fixtures.js';
import { otherSport } from '../classes/subscription-fixtures.js';
import { first } from '../db/helpers.js';
import { superUser } from '../super/fixtures.js';
import {
  insertBlock,
  insertBooking,
  insertGroup,
  insertPayment,
  insertSession,
  local,
  openEightToMidnight,
  TZ,
} from './fixtures.js';

// Camada de métricas (decisão 124; RF-MCP-08; RN-MCP-09; docs/14-mcp.md 8.4). Semana de
// segunda 02/03/2026 a domingo 08/03/2026, com dados controlados e os valores calculados à mão.

type Row = Record<string, unknown> & { key: string; label: string };
const WEEK = { from: '2026-03-02', to: '2026-03-08' };

describe('camada de métricas', () => {
  let t: TestApp;
  let arena: Space;
  let other: Space;
  let empty: Space;
  let owner: SignedUp;
  let teacher1: SignedUp;
  let teacher2: SignedUp;
  let otherOwner: SignedUp;
  let emptyOwner: SignedUp;
  let player1: SignedUp;
  let player2: SignedUp;
  let admin: SignedUp;
  let t1: string;
  let t2: string;
  let groupMorning: string;
  let groupNight: string;
  let neighborGroup: string;
  let neighborSport: string;

  const get = (path: string, user: SignedUp, query: Record<string, unknown> = WEEK) =>
    t
      .http()
      .get(`/v1/${path}`)
      .query(query)
      .set(...bearer(user));
  const manage = (
    metric: string,
    user: SignedUp,
    query: Record<string, unknown> = WEEK,
    spaceId = arena.id,
  ) => get(`manage/spaces/${spaceId}/analytics/${metric}`, user, query);
  const rowOf = (body: { rows: Row[] }, key: string) => {
    const row = body.rows.find((r) => r.key === key);
    if (!row) throw new Error(`Linha ${key} ausente: ${body.rows.map((r) => r.key).join(', ')}`);
    return row;
  };

  beforeAll(async () => {
    t = await createTestApp();
    arena = await createSpace(t.db, 'arena-metricas');
    other = await createSpace(t.db, 'arena-vizinha-metricas');
    empty = await createSpace(t.db, 'arena-vazia-metricas');
    await openEightToMidnight(t.db, arena.id);

    owner = await member(t, 'dono@metricas.com', arena.id, 'OWNER');
    admin = await member(t, 'admin@metricas.com', arena.id, 'ADMIN');
    teacher1 = await member(t, 'prof1@metricas.com', arena.id, 'TEACHER');
    teacher2 = await member(t, 'prof2@metricas.com', arena.id, 'TEACHER');
    await t.db.update(users).set({ name: 'Professora Um' }).where(eq(users.id, teacher1.id));
    await t.db.update(users).set({ name: 'Professor Dois' }).where(eq(users.id, teacher2.id));
    otherOwner = await member(t, 'dono-vizinho@metricas.com', other.id, 'OWNER');
    emptyOwner = await member(t, 'dono-vazio@metricas.com', empty.id, 'OWNER');
    player1 = await signUp(t, 'ana@metricas.com', 'Ana Jogadora', '+5531911110001');
    player2 = await signUp(t, 'bruno@metricas.com', 'Bruno Jogador', '+5531911110002');
    const player3 = await signUp(t, 'caio@metricas.com', 'Caio Jogador', '+5531911110003');
    const students = await Promise.all(
      ['a', 'b', 'c', 'd'].map((s) =>
        signUp(t, `aluno-${s}@metricas.com`, `Aluno ${s.toUpperCase()}`, '+5531911119999'),
      ),
    );
    const [studentA, studentB, studentC, studentD] = students as [
      SignedUp,
      SignedUp,
      SignedUp,
      SignedUp,
    ];
    t1 = await teacherMemberId(t.db, teacher1.id, arena.id);
    t2 = await teacherMemberId(t.db, teacher2.id, arena.id);

    // --- Reservas da arena ---------------------------------------------------------------
    const recurring = first(
      await t.db
        .insert(recurringBookings)
        .values({
          spaceId: arena.id,
          courtId: arena.courtA,
          userId: player1.id,
          sportId: arena.sportId,
          weekday: 5,
          startTime: '18:00',
          durationMin: 120,
          peopleCount: 2,
          startsOn: '2026-03-06',
          status: 'ACTIVE',
        })
        .returning(),
    );
    // b1: seg 18:00–19:30, quadra A, paga.
    const b1 = await insertBooking(t.db, arena, {
      courtId: arena.courtA,
      startsAt: local('2026-03-02', '18:00'),
      durationMin: 90,
      organizerUserId: player1.id,
      paymentStatus: 'PAID',
    });
    // b2: seg 23:30–00:30 (02:30Z de terça), quadra B, balcão, paga em parte (fuso).
    const b2 = await insertBooking(t.db, arena, {
      courtId: arena.courtB,
      startsAt: local('2026-03-02', '23:30'),
      durationMin: 60,
      status: 'COMPLETED',
      source: 'DESK',
      guestName: 'Cliente Balcão',
      guestPhone: '+5531977776666',
      paymentStatus: 'PARTIALLY_PAID',
    });
    // b3: ter 19:00, quadra A, no-show, criada pelo assistente de IA.
    const b3 = await insertBooking(t.db, arena, {
      courtId: arena.courtA,
      startsAt: local('2026-03-03', '19:00'),
      durationMin: 60,
      status: 'NO_SHOW',
      organizerUserId: player2.id,
      channel: 'MCP',
    });
    // b4: cancelada; b5: venceu sem pagamento online; b6: aguardando pagamento.
    await insertBooking(t.db, arena, {
      courtId: arena.courtA,
      startsAt: local('2026-03-04', '10:00'),
      durationMin: 60,
      status: 'CANCELLED',
      organizerUserId: player1.id,
    });
    await insertBooking(t.db, arena, {
      courtId: arena.courtB,
      startsAt: local('2026-03-04', '12:00'),
      durationMin: 60,
      status: 'CANCELLED',
      cancelReason: 'PAYMENT_EXPIRED',
      organizerUserId: player2.id,
    });
    await insertBooking(t.db, arena, {
      courtId: arena.courtB,
      startsAt: local('2026-03-05', '20:00'),
      durationMin: 60,
      status: 'PENDING_PAYMENT',
      organizerUserId: player2.id,
    });
    // b7: sex 18:00–20:00, ocorrência do mensalista (preço 0).
    await insertBooking(t.db, arena, {
      courtId: arena.courtA,
      startsAt: local('2026-03-06', '18:00'),
      durationMin: 120,
      source: 'RECURRING',
      recurringBookingId: recurring.id,
      organizerUserId: player1.id,
      priceCents: 0,
    });
    // Fora da semana: antes (inclusive dom 23:00 local = 02:00Z de segunda) e depois.
    await insertBooking(t.db, arena, {
      courtId: arena.courtA,
      startsAt: local('2026-02-20', '18:00'),
      durationMin: 60,
      organizerUserId: player2.id,
    });
    await insertBooking(t.db, arena, {
      courtId: arena.courtB,
      startsAt: local('2026-03-01', '23:00'),
      durationMin: 60,
      organizerUserId: player3.id,
    });
    await insertBooking(t.db, arena, {
      courtId: arena.courtA,
      startsAt: local('2026-03-09', '00:00'),
      durationMin: 60,
      organizerUserId: player1.id,
    });
    // Bloqueio de 4 h no sábado, quadra A.
    await insertBlock(
      t.db,
      arena.courtA,
      local('2026-03-07', '08:00'),
      local('2026-03-07', '12:00'),
    );

    // --- Aulas -------------------------------------------------------------------------------
    const morning = await insertGroup(t.db, arena, {
      name: 'Turma Manhã',
      courtId: arena.courtB,
      teacherMemberIds: [t1],
    });
    const night = await insertGroup(t.db, arena, {
      name: 'Turma Noite',
      courtId: arena.courtA,
      teacherMemberIds: [t2],
    });
    groupMorning = morning.id;
    groupNight = night.id;
    await insertSession(t.db, morning, {
      startsAt: local('2026-03-03', '08:00'),
      status: 'DONE',
      teacherMemberIds: [t1],
      marks: [
        [studentA.id, 'PRESENT'],
        [studentB.id, 'ABSENT'],
        [studentC.id, 'CONFIRMED'],
      ],
    });
    await insertSession(t.db, morning, {
      startsAt: local('2026-03-05', '08:00'),
      status: 'DONE',
      teacherMemberIds: [t1],
      marks: [
        [studentA.id, 'PRESENT'],
        [studentB.id, 'PRESENT'],
      ],
    });
    await insertSession(t.db, night, {
      startsAt: local('2026-03-04', '19:00'),
      status: 'DONE',
      teacherMemberIds: [t2],
      marks: [[studentC.id, 'PRESENT']],
    });
    await insertSession(t.db, night, {
      startsAt: local('2026-03-06', '20:30'),
      status: 'CANCELLED',
      teacherMemberIds: [t2],
    });
    await insertSession(t.db, morning, {
      startsAt: local('2026-03-10', '08:00'),
      status: 'DONE',
      teacherMemberIds: [t1],
      marks: [[studentA.id, 'PRESENT']],
    });
    const subA = await enroll(t.db, {
      userId: studentA.id,
      spaceId: arena.id,
      sportId: arena.sportId,
      classGroupId: morning.id,
    });
    const subB = await enroll(t.db, {
      userId: studentB.id,
      spaceId: arena.id,
      sportId: arena.sportId,
      classGroupId: morning.id,
    });
    await enroll(t.db, {
      userId: studentC.id,
      spaceId: arena.id,
      sportId: arena.sportId,
      classGroupId: night.id,
    });
    const subD = await enroll(t.db, {
      userId: studentD.id,
      spaceId: arena.id,
      sportId: arena.sportId,
      classGroupId: night.id,
    });
    await t.db
      .update(subscriptions)
      .set({ status: 'CANCELLED' })
      .where(eq(subscriptions.id, subD.id));

    // --- Pagamentos e mensalidades -------------------------------------------------------------
    const charge = (subscriptionId: string, dueDate: string, extra = {}) =>
      t.db
        .insert(subscriptionCharges)
        .values({
          subscriptionId,
          periodStart: dueDate,
          periodEnd: addDays(dueDate, 30),
          dueDate,
          amountCents: 15_000,
          ...extra,
        })
        .returning()
        .then(first);
    const paidCharge = await charge(subA.id, '2026-03-05', { status: 'PAID' });
    await charge(subB.id, '2026-03-06');
    await charge(subB.id, '2026-03-07', {
      status: 'WAIVED',
      waivedAt: new Date(),
      waivedBy: owner.id,
    });
    const pay = { spaceId: arena.id, recordedBy: owner.id };
    await insertPayment(t.db, {
      ...pay,
      payableType: 'BOOKING',
      payableId: b1.id,
      amountCents: 15_000,
      method: 'PIX',
      paidAt: local('2026-03-02', '20:00'),
    });
    // 23:45 de segunda em São Paulo = 02:45Z de terça: conta na segunda.
    await insertPayment(t.db, {
      ...pay,
      payableType: 'BOOKING',
      payableId: b2.id,
      amountCents: 4_000,
      method: 'CASH',
      paidAt: local('2026-03-02', '23:45'),
    });
    await insertPayment(t.db, {
      ...pay,
      payableType: 'BOOKING',
      payableId: b3.id,
      amountCents: 5_000,
      method: 'CARD',
      paidAt: local('2026-03-03', '20:00'),
      reversed: true,
    });
    await insertPayment(t.db, {
      ...pay,
      payableType: 'SUBSCRIPTION_CHARGE',
      payableId: paidCharge.id,
      amountCents: 15_000,
      method: 'PIX',
      paidAt: local('2026-03-05', '09:00'),
    });

    // --- Espaço vizinho: uma reserva paga e uma aula dada na mesma semana, num esporte que a arena
    // não usa (para os filtros com ids de outro espaço) ---------------------------------------
    neighborSport = (await otherSport(t.db)).id;
    const neighbor = await insertBooking(t.db, other, {
      courtId: other.courtA,
      sportId: neighborSport,
      startsAt: local('2026-03-04', '10:00'),
      durationMin: 60,
      organizerUserId: player2.id,
      paymentStatus: 'PAID',
    });
    const neighborProf = await member(t, 'prof-vizinho@metricas.com', other.id, 'TEACHER');
    const neighborTeacher = await teacherMemberId(t.db, neighborProf.id, other.id);
    const neighborClass = await insertGroup(t.db, other, {
      name: 'Turma Vizinha',
      courtId: other.courtB,
      sportId: neighborSport,
      teacherMemberIds: [neighborTeacher],
    });
    neighborGroup = neighborClass.id;
    await insertSession(t.db, neighborClass, {
      startsAt: local('2026-03-04', '08:00'),
      status: 'DONE',
      teacherMemberIds: [neighborTeacher],
      marks: [[player2.id, 'PRESENT']],
    });
    await insertPayment(t.db, {
      spaceId: other.id,
      recordedBy: otherOwner.id,
      payableType: 'BOOKING',
      payableId: neighbor.id,
      amountCents: 10_000,
      method: 'PIX',
      paidAt: local('2026-03-04', '11:00'),
    });

    // Cadastros na semana (Super): um usuário e a arena.
    await t.db
      .update(users)
      .set({ createdAt: local('2026-03-03', '10:00') })
      .where(eq(users.id, player1.id));
    await t.db
      .update(spaces)
      .set({ createdAt: local('2026-03-02', '09:00') })
      .where(eq(spaces.id, arena.id));
  });

  afterAll(() => t.close());

  describe('reservas', () => {
    it('conta reservas, horas, no-show e canceladas por dia, com o fuso de São Paulo', async () => {
      const res = await manage('bookings', owner).expect(200);
      expect(res.body.period).toEqual(WEEK);
      expect(res.body.groupBy).toBe('day');
      expect(res.body.timezone).toBe(TZ);
      expect(res.body.columns.map((c: { key: string; unit: string }) => [c.key, c.unit])).toEqual([
        ['bookings', 'COUNT'],
        ['hours', 'HOURS'],
        ['noShows', 'COUNT'],
        ['cancelled', 'COUNT'],
        ['cancellationRate', 'RATIO'],
      ]);
      // Série contínua: os 7 dias, com zero onde não há reserva.
      expect(res.body.rows.map((r: Row) => r.key)).toEqual([
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
        '2026-03-07',
        '2026-03-08',
      ]);
      // A das 23:30 de segunda (02:30Z de terça) cai na segunda.
      expect(rowOf(res.body, '2026-03-02')).toMatchObject({
        label: '02/03/2026',
        bookings: 2,
        hours: 2.5,
        noShows: 0,
        cancelled: 0,
      });
      expect(rowOf(res.body, '2026-03-03')).toMatchObject({ bookings: 1, hours: 1, noShows: 1 });
      expect(rowOf(res.body, '2026-03-04')).toMatchObject({
        bookings: 0,
        cancelled: 1,
        cancellationRate: 1,
      });
      // Aguardando pagamento não conta.
      expect(rowOf(res.body, '2026-03-05')).toMatchObject({ bookings: 0, cancellationRate: null });
      expect(res.body.totals).toEqual({
        bookings: 4,
        hours: 5.5,
        noShows: 1,
        cancelled: 1,
        cancellationRate: 0.2,
      });
    });

    it('agrupa por hora de início, status, canal e quadra; filtra por quadra', async () => {
      const byHour = await manage('bookings', owner, { ...WEEK, groupBy: 'hour' }).expect(200);
      expect(byHour.body.rows).toHaveLength(24);
      expect(rowOf(byHour.body, '23')).toMatchObject({ label: '23h', bookings: 1 });
      expect(rowOf(byHour.body, '18')).toMatchObject({ bookings: 2, hours: 3.5 });

      const byStatus = await manage('bookings', owner, { ...WEEK, groupBy: 'status' }).expect(200);
      expect(byStatus.body.rows.map((r: Row) => [r.key, r.bookings, r.cancelled])).toEqual([
        ['CONFIRMED', 2, 0],
        ['COMPLETED', 1, 0],
        ['NO_SHOW', 1, 0],
        ['CANCELLED', 0, 1],
      ]);

      const byChannel = await manage('bookings', owner, { ...WEEK, groupBy: 'channel' }).expect(
        200,
      );
      expect(rowOf(byChannel.body, 'MCP')).toMatchObject({
        label: 'Assistente de IA',
        bookings: 1,
      });
      expect(rowOf(byChannel.body, 'DIRECT')).toMatchObject({ bookings: 3, cancelled: 1 });

      const byCourt = await manage('bookings', owner, { ...WEEK, groupBy: 'court' }).expect(200);
      expect(byCourt.body.rows).toEqual([
        expect.objectContaining({ key: arena.courtA, label: 'Quadra A', bookings: 3, hours: 4.5 }),
        expect.objectContaining({ key: arena.courtB, label: 'Quadra B', bookings: 1, hours: 1 }),
      ]);

      const courtB = await manage('bookings', owner, { ...WEEK, courtId: arena.courtB }).expect(
        200,
      );
      expect(courtB.body.totals).toMatchObject({ bookings: 1, hours: 1, cancelled: 0 });
    });

    it('o Professor lê as reservas (sem valores no contrato)', async () => {
      const res = await manage('bookings', teacher1).expect(200);
      expect(res.body.totals.bookings).toBe(4);
      expect(JSON.stringify(res.body)).not.toMatch(/Cents/);
    });
  });

  describe('ocupação', () => {
    it('horas reservadas ÷ disponíveis (funcionamento − bloqueios), por quadra', async () => {
      const res = await manage('occupancy', owner).expect(200);
      expect(res.body.groupBy).toBe('court');
      // 7 dias × 16 h; A tem 4 h bloqueadas. A reserva das 23:30–00:30 só conta até a meia-noite.
      expect(rowOf(res.body, arena.courtA)).toMatchObject({
        label: 'Quadra A',
        openHours: 112,
        blockedHours: 4,
        availableHours: 108,
        bookedHours: 4.5,
        classHours: 1,
        occupancyRate: 0.0417,
        utilizationRate: 0.0509,
      });
      expect(rowOf(res.body, arena.courtB)).toMatchObject({
        openHours: 112,
        blockedHours: 0,
        availableHours: 112,
        bookedHours: 0.5,
        classHours: 2,
        occupancyRate: 0.0045,
        utilizationRate: 0.0223,
      });
      expect(res.body.totals).toEqual({
        openHours: 224,
        blockedHours: 4,
        availableHours: 220,
        bookedHours: 5,
        classHours: 3,
        occupancyRate: 0.0227,
        utilizationRate: 0.0364,
      });
    });

    it('terças das 18h às 23h e a faixa das 23h', async () => {
      const tuesday = await manage('occupancy', owner, {
        ...WEEK,
        groupBy: 'weekday',
        weekday: 2,
        hourFrom: 18,
        hourTo: 23,
      }).expect(200);
      expect(tuesday.body.rows).toEqual([
        expect.objectContaining({
          key: '2',
          label: 'terça-feira',
          openHours: 10,
          bookedHours: 1,
          occupancyRate: 0.1,
        }),
      ]);

      const late = await manage('occupancy', owner, {
        ...WEEK,
        groupBy: 'hour',
        hourFrom: 23,
        hourTo: 24,
      }).expect(200);
      expect(late.body.rows).toEqual([
        expect.objectContaining({
          key: '23',
          openHours: 14,
          bookedHours: 0.5,
          occupancyRate: 0.0357,
        }),
      ]);
    });

    it('por dia, o sábado com o bloqueio', async () => {
      const res = await manage('occupancy', owner, { ...WEEK, groupBy: 'day' }).expect(200);
      expect(res.body.rows).toHaveLength(7);
      expect(rowOf(res.body, '2026-03-07')).toMatchObject({
        openHours: 32,
        blockedHours: 4,
        availableHours: 28,
        bookedHours: 0,
      });
    });
  });

  describe('aulas', () => {
    it('Dono: aulas, presença e alunos ativos por turma', async () => {
      const res = await manage('classes', owner).expect(200);
      expect(res.body.groupBy).toBe('classGroup');
      expect(res.body.rows).toEqual([
        {
          key: groupMorning,
          label: 'Turma Manhã',
          sessionsDone: 2,
          sessionsCancelled: 0,
          present: 3,
          absent: 1,
          unmarked: 1,
          attendanceRate: 0.75,
          activeStudents: 2,
        },
        {
          key: groupNight,
          label: 'Turma Noite',
          sessionsDone: 1,
          sessionsCancelled: 1,
          present: 1,
          absent: 0,
          unmarked: 0,
          attendanceRate: 1,
          // O aluno D tem a assinatura cancelada.
          activeStudents: 1,
        },
      ]);
      expect(res.body.totals).toEqual({
        sessionsDone: 3,
        sessionsCancelled: 1,
        present: 4,
        absent: 1,
        unmarked: 1,
        attendanceRate: 0.8,
        activeStudents: 3,
      });
    });

    it('por professor e por data (alunos ativos nulos nas linhas por data)', async () => {
      const byTeacher = await manage('classes', owner, { ...WEEK, groupBy: 'teacher' }).expect(200);
      expect(rowOf(byTeacher.body, t1)).toMatchObject({
        label: 'Professora Um',
        sessionsDone: 2,
        present: 3,
        activeStudents: 2,
      });
      expect(rowOf(byTeacher.body, t2)).toMatchObject({
        label: 'Professor Dois',
        sessionsDone: 1,
        sessionsCancelled: 1,
        activeStudents: 1,
      });

      const byDay = await manage('classes', owner, { ...WEEK, groupBy: 'day' }).expect(200);
      expect(rowOf(byDay.body, '2026-03-03')).toMatchObject({
        sessionsDone: 1,
        present: 1,
        absent: 1,
        activeStudents: null,
      });
      expect(byDay.body.totals.activeStudents).toBe(3);
    });

    it('Professor: só as aulas e turmas dele, como no painel', async () => {
      const res = await manage('classes', teacher1).expect(200);
      expect(res.body.rows.map((r: Row) => r.key)).toEqual([groupMorning]);
      expect(res.body.totals).toEqual({
        sessionsDone: 2,
        sessionsCancelled: 0,
        present: 3,
        absent: 1,
        unmarked: 1,
        attendanceRate: 0.75,
        activeStudents: 2,
      });
      const byTeacher = await manage('classes', teacher1, { ...WEEK, groupBy: 'teacher' }).expect(
        200,
      );
      expect(byTeacher.body.rows.map((r: Row) => r.key)).toEqual([t1]);
      // A turma do outro professor, pedida pelo filtro, volta vazia.
      const foreign = await manage('classes', teacher1, {
        ...WEEK,
        classGroupId: groupNight,
      }).expect(200);
      expect(foreign.body.rows).toEqual([]);
      expect(foreign.body.totals).toMatchObject({ sessionsDone: 0, present: 0, activeStudents: 0 });
    });
  });

  describe('clientes', () => {
    it('quem mais reserva, novos × recorrentes e mensalistas, sem contato', async () => {
      const res = await manage('customers', owner).expect(200);
      expect(res.body.groupBy).toBe('customer');
      expect(res.body.rows).toEqual([
        {
          key: player1.id,
          label: 'Ana Jogadora',
          customers: 1,
          newCustomers: 1,
          returningCustomers: 0,
          recurringCustomers: 1,
          bookings: 2,
          hours: 3.5,
        },
        // Empate em reservas e horas: pelo nome.
        {
          key: player2.id,
          label: 'Bruno Jogador',
          customers: 1,
          newCustomers: 0,
          returningCustomers: 1,
          recurringCustomers: 0,
          bookings: 1,
          hours: 1,
        },
        {
          key: 'guest-1',
          label: 'Cliente Balcão',
          customers: 1,
          newCustomers: 1,
          returningCustomers: 0,
          recurringCustomers: 0,
          bookings: 1,
          hours: 1,
        },
      ]);
      expect(res.body.totals).toEqual({
        customers: 3,
        newCustomers: 2,
        returningCustomers: 1,
        recurringCustomers: 1,
        bookings: 4,
        hours: 5.5,
      });
      // Decisão 122: nada de telefone, e-mail ou hash do contato.
      const json = JSON.stringify(res.body);
      expect(json).not.toMatch(/\+55|9777|9111|@|g:/);

      const top = await manage('customers', owner, { ...WEEK, limit: 1 }).expect(200);
      expect(top.body.rows.map((r: Row) => r.key)).toEqual([player1.id]);
      expect(top.body.totals.customers).toBe(3);
    });

    it('só Dono e Admin (contact.view, como a lista de clientes do painel)', async () => {
      await manage('customers', admin).expect(200);
      const res = await manage('customers', teacher1).expect(403);
      expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
    });

    it('conta sem nome (cadastro pelo telefone): o nome do balcão ou "Cliente sem nome"', async () => {
      // Outro espaço e outra semana, para não mexer nos números da arena e do Super.
      const space = await createSpace(t.db, 'arena-sem-nome-metricas');
      const spaceOwner = await member(t, 'dono-sem-nome@metricas.com', space.id, 'OWNER');
      const named = await signUp(t, 'sem-nome-1@metricas.com', 'Temporário', '+5531911110011');
      const blank = await signUp(t, 'sem-nome-2@metricas.com', 'Temporário', '+5531911110012');
      for (const user of [named, blank]) {
        await t.db.update(users).set({ name: '' }).where(eq(users.id, user.id));
      }
      const april = { from: '2026-04-06', to: '2026-04-12' };
      // Conta sem nome em reserva de balcão: vale o nome que a gestão digitou.
      await insertBooking(t.db, space, {
        courtId: space.courtA,
        startsAt: local('2026-04-06', '10:00'),
        durationMin: 120,
        organizerUserId: named.id,
        guestName: 'Fulano do Balcão',
        source: 'DESK',
      });
      // Conta sem nome e sem nome do balcão; cliente de balcão com nome em branco.
      await insertBooking(t.db, space, {
        courtId: space.courtA,
        startsAt: local('2026-04-07', '10:00'),
        durationMin: 60,
        organizerUserId: blank.id,
      });
      await insertBooking(t.db, space, {
        courtId: space.courtB,
        startsAt: local('2026-04-08', '10:00'),
        durationMin: 60,
        guestName: '   ',
        source: 'DESK',
      });
      const res = await manage('customers', spaceOwner, april, space.id).expect(200);
      expect(res.body.rows.map((r: Row) => [r.key, r.label])).toEqual([
        [named.id, 'Fulano do Balcão'],
        [blank.id, 'Cliente sem nome'],
        ['guest-1', 'Cliente sem nome'],
      ]);
    });

    it('por dia: novo só no dia da primeira reserva', async () => {
      const res = await manage('customers', owner, { ...WEEK, groupBy: 'day' }).expect(200);
      expect(res.body.rows).toHaveLength(7);
      expect(rowOf(res.body, '2026-03-02')).toMatchObject({ customers: 2, newCustomers: 2 });
      expect(rowOf(res.body, '2026-03-03')).toMatchObject({
        customers: 1,
        newCustomers: 0,
        returningCustomers: 1,
      });
      expect(rowOf(res.body, '2026-03-06')).toMatchObject({
        customers: 1,
        newCustomers: 0,
        recurringCustomers: 1,
      });
      expect(res.body.totals).toMatchObject({ customers: 3, newCustomers: 2 });
    });
  });

  describe('receita', () => {
    it('recebido pela data do pagamento e a receber pela data da reserva ou do vencimento', async () => {
      const res = await manage('revenue', owner).expect(200);
      // O Pix das 20h e o dinheiro das 23:45 (02:45Z de terça) caem na segunda.
      expect(rowOf(res.body, '2026-03-02')).toMatchObject({
        receivedCents: 19_000,
        paymentsCount: 2,
        reversedCents: 0,
        receivableCents: 6_000,
      });
      expect(rowOf(res.body, '2026-03-03')).toMatchObject({
        receivedCents: 0,
        reversedCents: 5_000,
        receivableCents: 10_000,
      });
      expect(rowOf(res.body, '2026-03-05')).toMatchObject({
        receivedCents: 15_000,
        receivableCents: 0,
      });
      // Mensalidade pendente vence na sexta; a dispensada (sábado) não entra.
      expect(rowOf(res.body, '2026-03-06')).toMatchObject({ receivableCents: 15_000 });
      expect(rowOf(res.body, '2026-03-07')).toMatchObject({ receivableCents: 0 });
      expect(res.body.totals).toEqual({
        receivedCents: 34_000,
        paymentsCount: 3,
        reversedCents: 5_000,
        receivableCents: 31_000,
      });
      expect(res.body.columns.find((c: { key: string }) => c.key === 'receivedCents').unit).toBe(
        'BRL_CENTS',
      );
    });

    it('por origem, forma (sem a receber nas linhas) e quadra; filtro por quadra', async () => {
      const byOrigin = await manage('revenue', owner, { ...WEEK, groupBy: 'origin' }).expect(200);
      expect(byOrigin.body.rows).toEqual([
        expect.objectContaining({
          key: 'RENTAL',
          receivedCents: 19_000,
          reversedCents: 5_000,
          receivableCents: 16_000,
        }),
        expect.objectContaining({ key: 'RECURRING', receivedCents: 0, receivableCents: 0 }),
        expect.objectContaining({
          key: 'CLASS',
          label: 'Mensalidades de aula',
          receivedCents: 15_000,
          receivableCents: 15_000,
        }),
      ]);

      const byMethod = await manage('revenue', owner, { ...WEEK, groupBy: 'method' }).expect(200);
      expect(rowOf(byMethod.body, 'PIX')).toMatchObject({
        receivedCents: 30_000,
        paymentsCount: 2,
        receivableCents: null,
      });
      expect(rowOf(byMethod.body, 'CARD')).toMatchObject({
        receivedCents: 0,
        reversedCents: 5_000,
      });
      expect(byMethod.body.totals.receivableCents).toBe(31_000);

      const byCourt = await manage('revenue', owner, { ...WEEK, groupBy: 'court' }).expect(200);
      expect(rowOf(byCourt.body, arena.courtA)).toMatchObject({
        receivedCents: 15_000,
        reversedCents: 5_000,
        receivableCents: 10_000,
      });
      expect(rowOf(byCourt.body, arena.courtB)).toMatchObject({
        receivedCents: 4_000,
        receivableCents: 6_000,
      });
      expect(rowOf(byCourt.body, 'none')).toMatchObject({
        receivedCents: 15_000,
        receivableCents: 15_000,
      });

      const courtA = await manage('revenue', owner, { ...WEEK, courtId: arena.courtA }).expect(200);
      expect(courtA.body.totals).toEqual({
        receivedCents: 15_000,
        paymentsCount: 1,
        reversedCents: 5_000,
        receivableCents: 10_000,
      });
    });

    it('só Dono e Admin (decisão 53): o Professor recebe 403', async () => {
      await manage('revenue', admin).expect(200);
      const res = await manage('revenue', teacher1).expect(403);
      expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
    });
  });

  describe('autorização e isolamento entre espaços', () => {
    it('papel em outro espaço não vale; cada espaço só vê os próprios dados', async () => {
      for (const metric of ['bookings', 'occupancy', 'classes', 'customers', 'revenue']) {
        const res = await manage(metric, otherOwner).expect(403);
        expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
      }
      await manage('bookings', player1).expect(403);
      await t.http().get(`/v1/manage/spaces/${arena.id}/analytics/bookings`).expect(401);

      const neighbor = await manage('bookings', otherOwner, WEEK, other.id).expect(200);
      expect(neighbor.body.totals).toMatchObject({ bookings: 1, hours: 1 });
      const neighborRevenue = await manage('revenue', otherOwner, WEEK, other.id).expect(200);
      expect(neighborRevenue.body.totals).toMatchObject({
        receivedCents: 10_000,
        receivableCents: 0,
      });
      const neighborCustomers = await manage('customers', otherOwner, WEEK, other.id).expect(200);
      expect(neighborCustomers.body.rows.map((r: Row) => r.label)).toEqual(['Bruno Jogador']);
    });

    it('filtros com ids de outro espaço (IDOR): zeros e nenhuma linha do outro espaço', async () => {
      // O espaço vizinho tem, na mesma semana, uma reserva paga na quadra dele e uma aula dada na
      // turma dele, no esporte dele: nada disso pode aparecer pela rota da arena.
      const zeroBookings = { bookings: 0, hours: 0, noShows: 0, cancelled: 0 };
      for (const query of [{ courtId: other.courtA }, { sportId: neighborSport }]) {
        const bookings = await manage('bookings', owner, { ...WEEK, ...query }).expect(200);
        expect(bookings.body.totals).toMatchObject(zeroBookings);
        expect(bookings.body.rows.every((r: Row) => r.bookings === 0 && r.cancelled === 0)).toBe(
          true,
        );
        const customers = await manage('customers', owner, { ...WEEK, ...query }).expect(200);
        expect(customers.body.rows).toEqual([]);
        expect(customers.body.totals).toMatchObject({ customers: 0, bookings: 0 });
        const revenue = await manage('revenue', owner, { ...WEEK, ...query }).expect(200);
        expect(revenue.body.totals).toMatchObject({ receivedCents: 0, paymentsCount: 0 });
        if ('courtId' in query) expect(revenue.body.totals.receivableCents).toBe(0);
      }
      const byCourt = await manage('bookings', owner, {
        ...WEEK,
        courtId: other.courtA,
        groupBy: 'court',
      }).expect(200);
      expect(byCourt.body.rows).toEqual([]);
      const revenueByCourt = await manage('revenue', owner, {
        ...WEEK,
        courtId: other.courtA,
        groupBy: 'court',
      }).expect(200);
      expect(revenueByCourt.body.rows).toEqual([]);
      const occupancy = await manage('occupancy', owner, { ...WEEK, courtId: other.courtA }).expect(
        200,
      );
      expect(occupancy.body.rows).toEqual([]);
      expect(occupancy.body.totals).toMatchObject({ openHours: 0, bookedHours: 0, classHours: 0 });
      for (const query of [{ classGroupId: neighborGroup }, { sportId: neighborSport }]) {
        for (const groupBy of ['classGroup', 'teacher']) {
          const classes = await manage('classes', owner, { ...WEEK, ...query, groupBy }).expect(
            200,
          );
          expect(classes.body.rows).toEqual([]);
          expect(classes.body.totals).toMatchObject({
            sessionsDone: 0,
            present: 0,
            activeStudents: 0,
          });
        }
      }
      // O dado existe: o Dono do vizinho vê a aula pela rota do próprio espaço.
      const neighborClasses = await manage('classes', otherOwner, WEEK, other.id).expect(200);
      expect(neighborClasses.body.rows.map((r: Row) => [r.key, r.present])).toEqual([
        [neighborGroup, 1],
      ]);
    });

    it('espaço sem dados: zeros, razões nulas e as linhas do calendário', async () => {
      const bookings = await manage('bookings', emptyOwner, WEEK, empty.id).expect(200);
      expect(bookings.body.rows).toHaveLength(7);
      expect(bookings.body.totals).toEqual({
        bookings: 0,
        hours: 0,
        noShows: 0,
        cancelled: 0,
        cancellationRate: null,
      });
      const occupancy = await manage('occupancy', emptyOwner, WEEK, empty.id).expect(200);
      // Aberto 24 h: 7 × 24 × 2 quadras.
      expect(occupancy.body.totals).toMatchObject({
        openHours: 336,
        bookedHours: 0,
        occupancyRate: 0,
      });
      const classes = await manage('classes', emptyOwner, WEEK, empty.id).expect(200);
      expect(classes.body.rows).toEqual([]);
      expect(classes.body.totals).toMatchObject({ sessionsDone: 0, attendanceRate: null });
      const customers = await manage('customers', emptyOwner, WEEK, empty.id).expect(200);
      expect(customers.body.rows).toEqual([]);
      expect(customers.body.totals.customers).toBe(0);
      const revenue = await manage('revenue', emptyOwner, WEEK, empty.id).expect(200);
      expect(revenue.body.totals).toEqual({
        receivedCents: 0,
        paymentsCount: 0,
        reversedCents: 0,
        receivableCents: 0,
      });
    });
  });

  describe('período', () => {
    it('padrão: os últimos 30 dias até hoje (fuso do espaço)', async () => {
      const res = await manage('bookings', owner, {}).expect(200);
      const today = utcToZoned(new Date(), TZ).date;
      expect(res.body.period).toEqual({ from: addDays(today, -29), to: today });
      expect(res.body.rows).toHaveLength(30);
    });

    it('até 366 dias; mais, período invertido ou agrupamento desconhecido são recusados', async () => {
      await manage('bookings', owner, { from: '2025-03-01', to: '2026-03-01' }).expect(200);
      const long = await manage('bookings', owner, { from: '2025-02-28', to: '2026-03-01' }).expect(
        422,
      );
      expect(long.body.error.code).toBe('ANALYTICS_PERIOD_TOO_LONG');
      const sinceLongAgo = await manage('revenue', owner, { from: '2020-01-01' }).expect(422);
      expect(sinceLongAgo.body.error.code).toBe('ANALYTICS_PERIOD_TOO_LONG');
      const future = await manage('bookings', owner, { from: '2099-01-01' }).expect(422);
      expect(future.body.error.code).toBe('ANALYTICS_PERIOD_INVALID');
      const inverted = await manage('bookings', owner, { from: '2026-03-08', to: '2026-03-02' });
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe('VALIDATION_ERROR');
      await manage('bookings', owner, { ...WEEK, groupBy: 'revenue' }).expect(400);
      await manage('occupancy', owner, { ...WEEK, hourFrom: 20, hourTo: 18 }).expect(400);
      await manage('customers', owner, { ...WEEK, limit: 101 }).expect(400);
    });

    it('semana e mês: grupos que começam antes do período contam só os dias dele', async () => {
      const byWeek = await manage('bookings', owner, {
        from: '2026-03-04',
        to: '2026-03-10',
        groupBy: 'week',
      }).expect(200);
      expect(byWeek.body.rows.map((r: Row) => [r.key, r.label, r.bookings])).toEqual([
        ['2026-03-02', 'semana de 02/03/2026', 1],
        ['2026-03-09', 'semana de 09/03/2026', 1],
      ]);
      const byMonth = await manage('bookings', owner, {
        from: '2026-02-01',
        to: '2026-03-31',
        groupBy: 'month',
      }).expect(200);
      expect(byMonth.body.rows.map((r: Row) => [r.key, r.label, r.bookings])).toEqual([
        ['2026-02', 'fev/2026', 1],
        ['2026-03', 'mar/2026', 6],
      ]);
    });
  });

  describe('Super', () => {
    let superAdmin: SignedUp;
    beforeAll(async () => {
      superAdmin = await superUser(t, 'super@metricas.com');
    });

    it('plataforma por semana: reservas, cadastros e espaços com movimento', async () => {
      const res = await get('super/analytics/platform', superAdmin).expect(200);
      expect(res.body.groupBy).toBe('week');
      expect(res.body.rows).toEqual([
        {
          key: '2026-03-02',
          label: 'semana de 02/03/2026',
          bookings: 5,
          bookedHours: 6.5,
          newUsers: 1,
          newSpaces: 1,
          activeSpaces: 2,
          onlinePayments: 0,
          onlineVolumeCents: 0,
          platformRevenueCents: 0,
        },
      ]);
      const byDay = await get('super/analytics/platform', superAdmin, {
        ...WEEK,
        groupBy: 'day',
      }).expect(200);
      expect(byDay.body.rows).toHaveLength(7);
      expect(byDay.body.totals.activeSpaces).toBe(2);
      expect(byDay.body.rows.find((r: Row) => r.key === '2026-03-04').activeSpaces).toBe(2);
    });

    it('espaços com o período anterior e a variação', async () => {
      const res = await get('super/analytics/spaces', superAdmin).expect(200);
      expect(res.body.previousPeriod).toEqual({ from: '2026-02-23', to: '2026-03-01' });
      // A reserva de domingo 01/03 às 23:00 (02:00Z de segunda) é do período anterior.
      expect(rowOf(res.body, arena.id)).toEqual({
        key: arena.id,
        label: 'Espaço arena-metricas',
        bookings: 4,
        previousBookings: 1,
        bookingsDelta: 3,
        presences: 4,
        previousPresences: 0,
        presencesDelta: 4,
        receivedCents: 34_000,
        previousReceivedCents: 0,
        receivedDeltaCents: 34_000,
        activeRecurring: 1,
        activeStudents: 3,
      });
      expect(rowOf(res.body, other.id)).toMatchObject({ bookings: 1, receivedCents: 10_000 });
      expect(rowOf(res.body, empty.id)).toMatchObject({ bookings: 0, bookingsDelta: 0 });
      expect(res.body.totals).toMatchObject({ bookings: 5, receivedCents: 44_000 });
    });

    it('ordena pela variação (padrão: quem mais caiu em reservas primeiro) e limita', async () => {
      const mine = [arena.id, other.id, empty.id];
      const order = (rows: Row[]) => rows.map((r) => r.key).filter((key) => mine.includes(key));
      // Variação de reservas: arena +3, vizinho +1, vazio 0.
      const asc = await get('super/analytics/spaces', superAdmin).expect(200);
      expect(order(asc.body.rows)).toEqual([empty.id, other.id, arena.id]);
      expect(asc.body.spacesCount).toBe(asc.body.rows.length);
      const desc = await get('super/analytics/spaces', superAdmin, {
        ...WEEK,
        order: 'desc',
        limit: 1,
      }).expect(200);
      expect(desc.body.rows.map((r: Row) => r.key)).toEqual([arena.id]);
      // O corte não muda os totais nem a contagem de espaços.
      expect(desc.body.spacesCount).toBe(asc.body.spacesCount);
      expect(desc.body.totals).toEqual(asc.body.totals);
      const byReceived = await get('super/analytics/spaces', superAdmin, {
        ...WEEK,
        sort: 'receivedDeltaCents',
        order: 'desc',
      }).expect(200);
      expect(order(byReceived.body.rows)).toEqual([arena.id, other.id, empty.id]);
      const byName = await get('super/analytics/spaces', superAdmin, { ...WEEK, sort: 'name' });
      const labels = byName.body.rows.map((r: Row) => r.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'pt-BR')));
      await get('super/analytics/spaces', superAdmin, { ...WEEK, sort: 'sql' }).expect(400);
      await get('super/analytics/spaces', superAdmin, { ...WEEK, limit: 201 }).expect(400);
    });

    it('só o Super', async () => {
      for (const path of ['platform', 'spaces']) {
        const res = await get(`super/analytics/${path}`, owner).expect(403);
        expect(res.body.error.code).toBe('SUPER_REQUIRED');
      }
      const long = await get('super/analytics/platform', superAdmin, {
        from: '2025-01-01',
        to: '2026-03-01',
      }).expect(422);
      expect(long.body.error.code).toBe('ANALYTICS_PERIOD_TOO_LONG');
    });
  });
});
