import { CANCELLATION_WAIVE_REASON } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SubscriptionChargesService } from '../../src/classes/subscription-charges.service.js';
import {
  attendances,
  auditLogs,
  classGroups,
  classSessions,
  classSessionTeachers,
  enrollments,
  paymentRecords,
  sessions,
  subscriptionCharges,
  subscriptions,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { teacherMemberId } from './fixtures.js';
import {
  at,
  chargesOf,
  insertGroup,
  insertPlan,
  insertSubscription,
  notificationsOf,
  subscriptionRow,
} from './subscription-fixtures.js';

// RN-CLASS-08 (decisão 45): o cancelamento mantém o acesso até o fim do último mês pago ou
// dispensado; sem ele, o acesso termina no ato. Assinaturas e mensalidades inseridas direto no
// banco, com o relógio em cada data do caso.

type Sub = {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  endsOn: string | null;
  accessUntil: string | null;
  accessUntilIfCancelled: string | null;
  statusReason: string | null;
  nextCharge: { dueDate: string; status: string } | null;
  overdueCents: number;
  enrollments: { status: string; endedOn: string | null }[];
  charges: { status: string; periodStart: string; waiveNotice: string | null }[];
};

type ChargeStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'WAIVED';

describe('cancelamento da assinatura (RN-CLASS-08, decisão 45)', () => {
  let t: TestApp;
  let charges: SubscriptionChargesService;
  let space: Space;
  let admin: SignedUp;
  let teacher: SignedUp;
  let teacherId: string;
  let seq = 0;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at('2026-11-15') });
    t = await createTestApp();
    charges = t.app.get(SubscriptionChargesService);
    space = await createSpace(t.db, 'arena-cancelamento');
    admin = await member(t, 'admin-cancel@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'prof-cancel@exemplo.com', space.id, 'TEACHER');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
  });
  afterEach(async () => {
    // O job varre todas as assinaturas: as do teste anterior ficam fora da rodada.
    await t.db.update(subscriptions).set({ status: 'CANCELLED' });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await t.close();
  });

  /** A sessão de login vence em 30 dias: o relógio dos casos anda bem mais do que isso. */
  async function clock(date: Date) {
    vi.setSystemTime(date);
    await t.db.update(sessions).set({ expiresAt: new Date(date.getTime() + 86_400_000) });
  }

  const manage = (path: string) => `/v1/manage/spaces/${space.id}${path}`;
  const mine = (id: string, action: string) => `/v1/me/subscriptions/${id}/${action}`;
  const post = (user: SignedUp, path: string, body: object = {}) =>
    t
      .http()
      .post(path)
      .set(...bearer(user))
      .send(body);
  const get = (user: SignedUp, path: string) =>
    t
      .http()
      .get(path)
      .set(...bearer(user));

  async function cancel(user: SignedUp, id: string, reason?: string): Promise<Sub> {
    return (await post(user, mine(id, 'cancel'), reason ? { reason } : {}).expect(200)).body;
  }

  /** Aluno com assinatura ativa aprovada em `startsOn` numa turma com `capacity` vagas. */
  async function subscribed(
    billingDay = 10,
    { startsOn = '2026-10-01', capacity = 5, priceCents = 18_000 } = {},
  ) {
    const plan = await insertPlan(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      name: `Plano ${++seq}`,
      weeklyFrequency: 1,
      priceCents,
      billingDay,
    });
    const group = await insertGroup(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      teacherMemberId: teacherId,
      courtId: space.courtA,
      name: `Turma ${seq}`,
      weekday: 1,
      startTime: `${String(seq % 24).padStart(2, '0')}:00`,
      durationMin: 60,
      capacity,
    });
    const user = await signUp(t, `aluno-cancel-${seq}@exemplo.com`);
    const sub = await insertSubscription(t.db, {
      userId: user.id,
      planId: plan.id,
      spaceId: space.id,
      status: 'ACTIVE',
      priceCents,
      startsOn,
    });
    await t.db
      .insert(enrollments)
      .values({ subscriptionId: sub.id, classGroupId: group.id, startedOn: startsOn });
    return { user, sub, group, plan };
  }

  /** Turma de destino de uma troca, em horário livre. */
  const freeGroup = () =>
    insertGroup(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      teacherMemberId: teacherId,
      courtId: space.courtB,
      name: `Destino ${++seq}`,
      weekday: 5,
      startTime: `${String(seq % 24).padStart(2, '0')}:30`,
      durationMin: 30,
      capacity: 5,
    });

  /** Mensalidade do mês `YYYY-MM`, no status pedido. */
  async function charge(
    subscriptionId: string,
    month: string,
    status: ChargeStatus,
    { dueDay = 10, amountCents = 18_000 } = {},
  ) {
    const lastDay = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    ).getUTCDate();
    return first(
      await t.db
        .insert(subscriptionCharges)
        .values({
          subscriptionId,
          periodStart: `${month}-01`,
          periodEnd: `${month}-${lastDay}`,
          dueDate: `${month}-${String(dueDay).padStart(2, '0')}`,
          amountCents,
          status,
          waivedAt: status === 'WAIVED' ? new Date() : null,
        })
        .returning(),
    );
  }

  const session = async (
    group: typeof classGroups.$inferSelect,
    startsAt: Date,
    { capacity = group.capacity, status = 'OPEN' as 'OPEN' | 'CLOSED' } = {},
  ) =>
    t.db.transaction(async (tx) => {
      const row = first(
        await tx
          .insert(classSessions)
          .values({
            classGroupId: group.id,
            spaceId: group.spaceId,
            courtId: group.courtId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3_600_000),
            capacity,
            status,
          })
          .returning(),
      );
      await tx
        .insert(classSessionTeachers)
        .values({ classSessionId: row.id, spaceId: row.spaceId, teacherMemberId: teacherId });
      return row;
    });

  const list = (sessionId: string, userId: string, status: 'CONFIRMED' | 'WAITLIST') =>
    t.db.insert(attendances).values({
      sessionId,
      userId,
      status,
      waitlistPosition: status === 'WAITLIST' ? 1 : null,
    });

  const attendance = async (sessionId: string, userId: string) => {
    const [row] = await t.db
      .select()
      .from(attendances)
      .where(and(eq(attendances.sessionId, sessionId), eq(attendances.userId, userId)));
    return row;
  };

  const auditOf = async (id: string, action: string) => {
    const [log] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, action)));
    return log;
  };

  const enrolledCount = async (groupId: string) => {
    const res = await get(admin, manage('/class-groups')).expect(200);
    return res.body.items.find((g: { id: string }) => g.id === groupId).enrolledCount as number;
  };

  describe('com o mês corrente coberto: acesso até o fim do mês', () => {
    it('mês pago: segue ativa, com cancelAtPeriodEnd, e nada novo depois de ends_on', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-10', 'PAID');
      await charge(sub.id, '2026-11', 'PAID');

      const before: Sub = (await get(user, `/v1/me/subscriptions/${sub.id}`).expect(200)).body;
      expect(before).toMatchObject({ accessUntil: null, accessUntilIfCancelled: '2026-11-30' });

      const res = await cancel(user, sub.id, 'Mudei de bairro');
      expect(res).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        endsOn: '2026-11-30',
        accessUntil: '2026-11-30',
        accessUntilIfCancelled: null,
        statusReason: 'Mudei de bairro',
        nextCharge: null,
      });
      expect(res.enrollments.map((e) => e.status)).toEqual(['ACTIVE']);

      await clock(at('2026-11-28'));
      await charges.processBilling(at('2026-11-28'));
      expect((await chargesOf(t.db, sub.id)).map((c) => c.periodStart)).toEqual([
        '2026-10-01',
        '2026-11-01',
      ]);
      expect(await auditOf(sub.id, 'subscription.cancel')).toMatchObject({
        actorId: user.id,
        diff: { by: 'STUDENT', endsOn: '2026-11-30', immediate: false, waived: [] },
      });
    });

    it('mês dispensado também cobre (dispensa pela gestão)', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      const waived = await charge(sub.id, '2026-11', 'PENDING');
      await post(admin, manage(`/subscription-charges/${waived.id}/waive`), {
        reason: 'Bolsa',
      }).expect(200);

      const res = await cancel(user, sub.id);
      expect(res).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        endsOn: '2026-11-30',
      });
      expect(res.charges).toMatchObject([{ status: 'WAIVED', waiveNotice: null }]);
    });

    it('plano gratuito: a mensalidade nasce paga e o acesso vai até o fim do mês', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed(10, { priceCents: 0 });
      await charges.processBilling(at('2026-11-15'));
      expect(await cancel(user, sub.id)).toMatchObject({ endsOn: '2026-11-30' });
    });

    it('mês pago adiantado: vale o último mês coberto e a seguinte em aberto sai', async () => {
      // Vencimento no dia 3: a mensalidade de dezembro é gerada a partir de 28/11.
      await clock(at('2026-11-29'));
      const paidAhead = await subscribed(3);
      await charge(paidAhead.sub.id, '2026-11', 'PAID', { dueDay: 3 });
      await charge(paidAhead.sub.id, '2026-12', 'PAID', { dueDay: 3 });
      expect(await cancel(paidAhead.user, paidAhead.sub.id)).toMatchObject({
        status: 'ACTIVE',
        endsOn: '2026-12-31',
        accessUntil: '2026-12-31',
      });

      const unpaidAhead = await subscribed(3);
      await charge(unpaidAhead.sub.id, '2026-11', 'PAID', { dueDay: 3 });
      await charge(unpaidAhead.sub.id, '2026-12', 'PENDING', { dueDay: 3 });
      expect(await cancel(unpaidAhead.user, unpaidAhead.sub.id)).toMatchObject({
        status: 'ACTIVE',
        endsOn: '2026-11-30',
      });
      expect((await chargesOf(t.db, unpaidAhead.sub.id)).map((c) => c.periodStart)).toEqual([
        '2026-11-01',
      ]);
    });

    it('mês futuro pago com o corrente vencido: acesso até o futuro e a vencida segue devida', async () => {
      await clock(at('2026-11-29'));
      const { user, sub } = await subscribed(3);
      await charge(sub.id, '2026-11', 'OVERDUE', { dueDay: 3 });
      await charge(sub.id, '2026-12', 'PAID', { dueDay: 3 });
      expect(await cancel(user, sub.id)).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        endsOn: '2026-12-31',
        overdueCents: 18_000,
      });
    });

    it('último dia do mês: ends_on é hoje e o job só encerra no dia seguinte', async () => {
      await clock(at('2026-11-30'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      expect(await cancel(user, sub.id)).toMatchObject({ status: 'ACTIVE', endsOn: '2026-11-30' });

      await charges.processBilling(at('2026-11-30'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('ACTIVE');
      await charges.processBilling(at('2026-12-01'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('CANCELLED');
    });

    it('em atraso (PAST_DUE) com o mês corrente pago: cancela até o fim do mês', async () => {
      await clock(at('2026-11-20'));
      const { user, sub } = await subscribed();
      await t.db
        .update(subscriptions)
        .set({ status: 'PAST_DUE' })
        .where(eq(subscriptions.id, sub.id));
      await charge(sub.id, '2026-10', 'OVERDUE');
      await charge(sub.id, '2026-11', 'PAID');
      expect(await cancel(user, sub.id)).toMatchObject({
        status: 'PAST_DUE',
        cancelAtPeriodEnd: true,
        endsOn: '2026-11-30',
      });
    });

    it('repetir o cancelamento não muda nada nem avisa de novo', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id, 'Primeiro motivo');
      expect(await cancel(user, sub.id, 'Outro motivo')).toMatchObject({
        statusReason: 'Primeiro motivo',
        endsOn: '2026-11-30',
      });
      expect(await notificationsOf(t.db, user.id)).toHaveLength(1);
    });
  });

  describe('sem o mês corrente coberto: o acesso termina no ato', () => {
    it('mensalidade corrente não vencida vira WAIVED com o motivo; tudo encerra hoje', async () => {
      await clock(at('2026-11-05'));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-10', 'PAID');
      await charge(sub.id, '2026-11', 'PENDING');
      expect(await enrolledCount(group.id)).toBe(1);

      const before: Sub = (await get(user, `/v1/me/subscriptions/${sub.id}`).expect(200)).body;
      expect(before.accessUntilIfCancelled).toBeNull();

      const res = await cancel(user, sub.id, 'Sem tempo');
      expect(res).toMatchObject({
        status: 'CANCELLED',
        cancelAtPeriodEnd: false,
        endsOn: '2026-11-05',
        accessUntil: '2026-11-05',
        statusReason: 'Sem tempo',
        overdueCents: 0,
      });
      expect(res.enrollments).toMatchObject([{ status: 'ENDED', endedOn: '2026-11-05' }]);
      expect(res.charges).toMatchObject([
        { periodStart: '2026-11-01', status: 'WAIVED', waiveNotice: CANCELLATION_WAIVE_REASON },
        { periodStart: '2026-10-01', status: 'PAID' },
      ]);
      expect(await enrolledCount(group.id)).toBe(0);
      const [, november] = await chargesOf(t.db, sub.id);
      expect(november).toMatchObject({ waivedBy: user.id, status: 'WAIVED' });
      expect((await subscriptionRow(t.db, sub.id)).cancelledAt).toEqual(new Date());
      expect(await auditOf(sub.id, 'subscription.cancel')).toMatchObject({
        diff: { immediate: true, waived: ['2026-11-01'], endsOn: '2026-11-05' },
      });
      // Encerrada de vez: nem desistência nem novo cancelamento.
      await post(user, mine(sub.id, 'resume-cancel')).expect(409);
      await post(user, mine(sub.id, 'cancel')).expect(409);
    });

    it('dia de vencimento: vencida só depois do dia, mesmo antes do job marcar', async () => {
      // No próprio dia 10 ainda não venceu.
      await clock(at('2026-11-10'));
      const onDueDay = await subscribed();
      await charge(onDueDay.sub.id, '2026-11', 'PENDING');
      const waived = await cancel(onDueDay.user, onDueDay.sub.id);
      expect(waived.charges).toMatchObject([{ status: 'WAIVED' }]);

      // No dia 11 já venceu, com o job ainda sem rodar (`PENDING`): segue devida e entra no atraso.
      await clock(at('2026-11-11'));
      const afterDue = await subscribed();
      await charge(afterDue.sub.id, '2026-11', 'PENDING');
      const res = await cancel(afterDue.user, afterDue.sub.id);
      expect(res).toMatchObject({
        status: 'CANCELLED',
        endsOn: '2026-11-11',
        overdueCents: 18_000,
      });
      expect(res.charges).toMatchObject([{ status: 'OVERDUE', waiveNotice: null }]);
    });

    it('vencida segue devida e aparece para a gestão, que pode receber depois', async () => {
      await clock(at('2026-11-20'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'OVERDUE');
      const res = await cancel(user, sub.id);
      expect(res).toMatchObject({ status: 'CANCELLED', endsOn: '2026-11-20' });

      const delinquents = await get(admin, manage('/subscription-charges/delinquents')).expect(200);
      expect(delinquents.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subscriptionId: sub.id,
            subscriptionStatus: 'CANCELLED',
            overdueCents: 18_000,
          }),
        ]),
      );
      const overdue = await get(
        admin,
        manage(`/subscription-charges?overdue=true&subscriptionId=${sub.id}`),
      ).expect(200);
      expect(overdue.body.totalDueCents).toBe(18_000);

      await post(admin, manage('/payments'), {
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: overdue.body.items[0].id,
        amountCents: 18_000,
        method: 'PIX',
      }).expect(201);
      expect((await chargesOf(t.db, sub.id))[0]?.status).toBe('PAID');
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('CANCELLED');
    });

    it('último mês pago no passado não dá acesso: vencida fica, a do mês seguinte sai', async () => {
      // Outubro pago, novembro vencido e dezembro já gerado (vencimento no dia 3).
      await clock(at('2026-11-30'));
      const { user, sub } = await subscribed(3);
      await charge(sub.id, '2026-10', 'PAID', { dueDay: 3 });
      await charge(sub.id, '2026-11', 'OVERDUE', { dueDay: 3 });
      await charge(sub.id, '2026-12', 'PENDING', { dueDay: 3 });
      const res = await cancel(user, sub.id);
      expect(res).toMatchObject({ status: 'CANCELLED', endsOn: '2026-11-30' });
      expect((await chargesOf(t.db, sub.id)).map((c) => [c.periodStart, c.status])).toEqual([
        ['2026-10-01', 'PAID'],
        ['2026-11-01', 'OVERDUE'],
      ]);
    });

    it('pagamento parcial: não dispensa, como na dispensa da gestão, e fica em aberto', async () => {
      await clock(at('2026-11-05'));
      const { user, sub } = await subscribed();
      const november = await charge(sub.id, '2026-11', 'PENDING');
      await t.db.insert(paymentRecords).values({
        spaceId: space.id,
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: november.id,
        payerUserId: user.id,
        amountCents: 5_000,
        method: 'PIX',
        paidAt: new Date(),
        recordedBy: admin.id,
      });
      const res = await cancel(user, sub.id);
      expect(res).toMatchObject({ status: 'CANCELLED', endsOn: '2026-11-05' });
      expect(res.charges).toMatchObject([{ status: 'PENDING', waiveNotice: null }]);
    });

    it('pagamento estornado não impede a dispensa', async () => {
      await clock(at('2026-11-05'));
      const { user, sub } = await subscribed();
      const november = await charge(sub.id, '2026-11', 'PENDING');
      await t.db.insert(paymentRecords).values({
        spaceId: space.id,
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: november.id,
        payerUserId: user.id,
        amountCents: 18_000,
        method: 'PIX',
        paidAt: new Date(),
        recordedBy: admin.id,
        reversedAt: new Date(),
        reversedBy: admin.id,
      });
      const res = await cancel(user, sub.id);
      expect(res.charges).toMatchObject([{ status: 'WAIVED' }]);
    });

    it('aprovado depois do vencimento, sem mensalidade no mês: termina no ato e não deve nada', async () => {
      await clock(at('2026-11-20'));
      const { user, sub } = await subscribed(10, { startsOn: '2026-11-15' });
      const res = await cancel(user, sub.id);
      expect(res).toMatchObject({ status: 'CANCELLED', endsOn: '2026-11-20', charges: [] });
    });
  });

  describe('virada do mês e fuso de São Paulo', () => {
    it('23:30 de 30/11 ainda é novembro; 00:30 de 01/12 já não é (03:30 UTC)', async () => {
      const beforeMidnight = await subscribed();
      await charge(beforeMidnight.sub.id, '2026-11', 'PAID');
      const afterMidnight = await subscribed();
      await charge(afterMidnight.sub.id, '2026-11', 'PAID');

      // 02:30 UTC de 01/12: em UTC já é dezembro, em São Paulo ainda não.
      await clock(new Date('2026-12-01T02:30:00Z'));
      expect(await cancel(beforeMidnight.user, beforeMidnight.sub.id)).toMatchObject({
        status: 'ACTIVE',
        endsOn: '2026-11-30',
      });

      await clock(new Date('2026-12-01T03:30:00Z'));
      expect(await cancel(afterMidnight.user, afterMidnight.sub.id)).toMatchObject({
        status: 'CANCELLED',
        endsOn: '2026-12-01',
      });
    });

    it('virada do mês antes do job gerar a mensalidade: termina no ato, sem dever o mês novo', async () => {
      await clock(at('2026-12-01', 10));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      const res = await cancel(user, sub.id);
      expect(res).toMatchObject({ status: 'CANCELLED', endsOn: '2026-12-01' });
      expect(res.charges).toMatchObject([{ periodStart: '2026-11-01', status: 'PAID' }]);
    });

    it('o job encerra pelo dia no fuso do espaço, não pelo dia em UTC', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);

      // 02:20 UTC de 01/12 = 23:20 de 30/11 em São Paulo.
      await charges.processBilling(new Date('2026-12-01T02:20:00Z'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('ACTIVE');
      // 03:20 UTC de 01/12 = 00:20 de 01/12 em São Paulo.
      await charges.processBilling(new Date('2026-12-01T03:20:00Z'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('CANCELLED');
    });
  });

  describe('aulas depois do fim do acesso', () => {
    it('sai das aulas depois de ends_on, com promoção da espera, e fica nas anteriores', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed(10, { capacity: 1 });
      await charge(sub.id, '2026-11', 'PAID');
      const waiter = await signUp(t, `espera-cancel-${++seq}@exemplo.com`);

      // Último dia de acesso, à noite: em UTC já é 01/12.
      const lastNight = await session(group, at('2026-11-30', 22 * 60));
      // Primeira aula sem acesso, na madrugada de 01/12 em São Paulo.
      const after = await session(group, at('2026-12-01', 30));
      await list(lastNight.id, user.id, 'CONFIRMED');
      await list(after.id, user.id, 'CONFIRMED');
      await list(after.id, waiter.id, 'WAITLIST');

      await cancel(user, sub.id);

      expect((await attendance(lastNight.id, user.id))?.status).toBe('CONFIRMED');
      expect(await attendance(after.id, user.id)).toMatchObject({
        status: 'CANCELLED',
        waitlistPosition: null,
      });
      expect(await attendance(after.id, waiter.id)).toMatchObject({
        status: 'CONFIRMED',
        waitlistPosition: null,
      });
      expect((await notificationsOf(t.db, waiter.id)).map((n) => n.type)).toEqual([
        'CLASS_WAITLIST_PROMOTED',
      ]);
      expect(await auditOf(sub.id, 'subscription.cancel')).toMatchObject({
        diff: { attendancesReleased: 1 },
      });
    });

    it('quem estava na espera depois de ends_on sai e as posições são refeitas', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed(10, { capacity: 1 });
      await charge(sub.id, '2026-11', 'PAID');
      const [holder, behind] = [
        await signUp(t, `vaga-cancel-${++seq}@exemplo.com`),
        await signUp(t, `atras-cancel-${++seq}@exemplo.com`),
      ];
      const after = await session(group, at('2026-12-02', 19 * 60));
      await list(after.id, holder.id, 'CONFIRMED');
      await list(after.id, user.id, 'WAITLIST');
      await t.db.insert(attendances).values({
        sessionId: after.id,
        userId: behind.id,
        status: 'WAITLIST',
        waitlistPosition: 2,
      });

      await cancel(user, sub.id);

      expect((await attendance(after.id, user.id))?.status).toBe('CANCELLED');
      expect((await attendance(after.id, holder.id))?.status).toBe('CONFIRMED');
      expect(await attendance(after.id, behind.id)).toMatchObject({
        status: 'WAITLIST',
        waitlistPosition: 1,
      });
    });

    it('cancelamento imediato tira das aulas que ainda não começaram, inclusive hoje', async () => {
      await clock(at('2026-11-05', 12 * 60));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PENDING');
      const earlier = await session(group, at('2026-11-05', 8 * 60), { status: 'CLOSED' });
      const tonight = await session(group, at('2026-11-05', 20 * 60));
      await list(earlier.id, user.id, 'CONFIRMED');
      await list(tonight.id, user.id, 'CONFIRMED');

      await cancel(user, sub.id);

      expect((await attendance(earlier.id, user.id))?.status).toBe('CONFIRMED');
      expect((await attendance(tonight.id, user.id))?.status).toBe('CANCELLED');
      await post(user, `/v1/me/class-sessions/${tonight.id}/attendance`).expect(
        403,
        /NOT_ENROLLED_IN_CLASS/,
      );
    });

    it('a vaga da turma segue ocupada até o job encerrar depois de ends_on', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed(10, { capacity: 1 });
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      expect(await enrolledCount(group.id)).toBe(1);

      await charges.processBilling(at('2026-11-30'));
      expect(await enrolledCount(group.id)).toBe(1);
      await charges.processBilling(at('2026-12-01'));
      await clock(at('2026-12-01'));
      expect(await enrolledCount(group.id)).toBe(0);
      expect(
        await t.db.select().from(enrollments).where(eq(enrollments.subscriptionId, sub.id)),
      ).toMatchObject([{ status: 'ENDED', endedOn: '2026-11-30' }]);
    });

    it('não confirma depois de ends_on, antes e depois do job', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      const inside = await session(group, at('2026-11-30', 20 * 60));
      const outside = await session(group, at('2026-12-01', 8 * 60));

      await post(user, `/v1/me/class-sessions/${inside.id}/attendance`).expect(200);
      const res = await get(user, `/v1/me/class-sessions/${outside.id}`).expect(200);
      expect(res.body).toMatchObject({
        canConfirm: false,
        blockedReason: 'SUBSCRIPTION_ACCESS_ENDED',
      });
      await post(user, `/v1/me/class-sessions/${outside.id}/attendance`).expect(
        403,
        /SUBSCRIPTION_ACCESS_ENDED/,
      );
    });
  });

  describe('aluno que trocou de turma', () => {
    /** Assinatura paga em novembro, com presença numa aula de dezembro da turma de origem. */
    async function swapped(month: ChargeStatus = 'PAID') {
      const { user, sub, group } = await subscribed(10, { capacity: 1 });
      await charge(sub.id, '2026-11', month);
      const waiter = await signUp(t, `espera-troca-${++seq}@exemplo.com`);
      const old = await session(group, at('2026-12-02', 19 * 60));
      await list(old.id, user.id, 'CONFIRMED');
      await list(old.id, waiter.id, 'WAITLIST');
      const target = await freeGroup();
      await post(user, mine(sub.id, 'swap-class-group'), {
        fromClassGroupId: group.id,
        toClassGroupId: target.id,
      }).expect(200);
      return { user, sub, waiter, old };
    }

    it('sai também das aulas da turma antiga depois de ends_on, com promoção da espera', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, waiter, old } = await swapped();
      expect(await cancel(user, sub.id)).toMatchObject({ status: 'ACTIVE', endsOn: '2026-11-30' });
      expect((await attendance(old.id, user.id))?.status).toBe('CANCELLED');
      expect((await attendance(old.id, waiter.id))?.status).toBe('CONFIRMED');
      expect((await notificationsOf(t.db, waiter.id)).map((n) => n.type)).toEqual([
        'CLASS_WAITLIST_PROMOTED',
      ]);
    });

    it('no cancelamento imediato também', async () => {
      await clock(at('2026-11-05'));
      const { user, sub, old } = await swapped('PENDING');
      expect(await cancel(user, sub.id)).toMatchObject({ status: 'CANCELLED' });
      expect((await attendance(old.id, user.id))?.status).toBe('CANCELLED');
    });

    it('o job que encerra também olha a turma antiga', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      // A gestão troca depois do pedido; a presença na turma de origem fica para o job.
      const old = await session(group, at('2026-12-02', 19 * 60));
      await list(old.id, user.id, 'CONFIRMED');
      await post(admin, manage(`/subscriptions/${sub.id}/swap-class-group`), {
        fromClassGroupId: group.id,
        toClassGroupId: (await freeGroup()).id,
      }).expect(200);

      await clock(at('2026-12-01'));
      await charges.processBilling(at('2026-12-01'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('CANCELLED');
      expect((await attendance(old.id, user.id))?.status).toBe('CANCELLED');
    });

    it('fica na aula da turma em que tem matrícula ativa por outra assinatura', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group, plan } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await t.db
        .update(enrollments)
        .set({ status: 'ENDED', endedOn: '2026-11-01' })
        .where(eq(enrollments.subscriptionId, sub.id));
      const otherPlan = await insertPlan(t.db, {
        spaceId: space.id,
        sportId: plan.sportId,
        name: `Outro plano ${++seq}`,
        weeklyFrequency: 1,
        priceCents: 18_000,
        billingDay: 10,
      });
      const other = await insertSubscription(t.db, {
        userId: user.id,
        planId: otherPlan.id,
        spaceId: space.id,
        status: 'ACTIVE',
        priceCents: 18_000,
        startsOn: '2026-11-01',
      });
      await t.db
        .insert(enrollments)
        .values({ subscriptionId: other.id, classGroupId: group.id, startedOn: '2026-11-01' });
      const later = await session(group, at('2026-12-02', 19 * 60));
      await list(later.id, user.id, 'CONFIRMED');

      await cancel(user, sub.id);
      expect((await attendance(later.id, user.id))?.status).toBe('CONFIRMED');
    });
  });

  describe('motivo da dispensa', () => {
    it('só a gestão vê o motivo; o aluno vê nulo na dispensa avulsa', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      const november = await charge(sub.id, '2026-11', 'PENDING');
      const waived = await post(admin, manage(`/subscription-charges/${november.id}/waive`), {
        reason: 'Bolsa da família do dono',
      }).expect(200);
      expect(waived.body).toMatchObject({
        waiveReason: 'Bolsa da família do dono',
        waiveNotice: null,
      });

      const detail = await get(admin, manage(`/subscriptions/${sub.id}`)).expect(200);
      expect(detail.body.charges).toMatchObject([{ waiveReason: 'Bolsa da família do dono' }]);
      const page = await get(
        admin,
        manage(`/subscription-charges?subscriptionId=${sub.id}`),
      ).expect(200);
      expect(page.body.items).toMatchObject([{ waiveReason: 'Bolsa da família do dono' }]);

      const mineDetail = await get(user, `/v1/me/subscriptions/${sub.id}`).expect(200);
      const mineCharges = await get(user, `/v1/me/subscriptions/${sub.id}/charges`).expect(200);
      for (const item of [mineDetail.body.charges[0], mineCharges.body.items[0]]) {
        expect(item).toMatchObject({ status: 'WAIVED', waiveNotice: null });
        expect(item).not.toHaveProperty('waiveReason');
      }
    });

    it('na dispensa pelo cancelamento, o aluno vê o texto fixo e a gestão, o motivo', async () => {
      await clock(at('2026-11-05'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PENDING');
      const res: Sub = await cancel(user, sub.id, 'Motivo pessoal do aluno');
      expect(res.charges).toMatchObject([{ waiveNotice: CANCELLATION_WAIVE_REASON }]);
      expect(res.charges[0]).not.toHaveProperty('waiveReason');

      const detail = await get(admin, manage(`/subscriptions/${sub.id}`)).expect(200);
      expect(detail.body.charges).toMatchObject([
        { waiveReason: CANCELLATION_WAIVE_REASON, waiveNotice: CANCELLATION_WAIVE_REASON },
      ]);
    });
  });

  it('confirmar e cancelar ao mesmo tempo não deixam presença depois de ends_on', async () => {
    await clock(at('2026-11-15'));
    for (let round = 0; round < 5; round++) {
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      const after = await session(group, at('2026-12-02', 19 * 60));
      await Promise.all([
        post(user, `/v1/me/class-sessions/${after.id}/attendance`),
        post(user, mine(sub.id, 'cancel')),
      ]);
      expect(await subscriptionRow(t.db, sub.id)).toMatchObject({ endsOn: '2026-11-30' });
      expect((await attendance(after.id, user.id))?.status ?? 'CANCELLED').toBe('CANCELLED');
    }
  });

  describe('job que encerra', () => {
    it('fecha a vencida uma vez só, promove a espera e repetir não muda nada', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed(10, { capacity: 1 });
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      // Pedido feito antes desta regra: a confirmação depois do fim ainda está na lista.
      const waiter = await signUp(t, `espera-job-${++seq}@exemplo.com`);
      const leftover = await session(group, at('2026-12-03', 19 * 60));
      await list(leftover.id, user.id, 'CONFIRMED');
      await list(leftover.id, waiter.id, 'WAITLIST');

      await clock(at('2026-12-01'));
      expect(await charges.processBilling(at('2026-12-01'))).toMatchObject({ cancelled: 1 });
      expect(await subscriptionRow(t.db, sub.id)).toMatchObject({
        status: 'CANCELLED',
        endsOn: '2026-11-30',
        cancelledAt: at('2026-12-01'),
      });
      expect((await attendance(leftover.id, user.id))?.status).toBe('CANCELLED');
      expect((await attendance(leftover.id, waiter.id))?.status).toBe('CONFIRMED');
      expect((await notificationsOf(t.db, waiter.id)).map((n) => n.type)).toEqual([
        'CLASS_WAITLIST_PROMOTED',
      ]);

      expect(await charges.processBilling(at('2026-12-01'))).toMatchObject({ cancelled: 0 });
      expect(await charges.processBilling(at('2026-12-02'))).toMatchObject({ cancelled: 0 });
      expect((await subscriptionRow(t.db, sub.id)).cancelledAt).toEqual(at('2026-12-01'));
      expect(await chargesOf(t.db, sub.id)).toHaveLength(1);
    });

    it('a inclusão feita pela gestão depois do pedido fica na lista', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      const later = await session(group, at('2026-12-03', 19 * 60));
      await post(admin, manage(`/class-sessions/${later.id}/attendances`), {
        userId: user.id,
      }).expect(201);
      expect((await attendance(later.id, user.id))?.addedByStaff).toBe(true);

      await charges.processBilling(at('2026-12-01'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('CANCELLED');
      expect((await attendance(later.id, user.id))?.status).toBe('CONFIRMED');
    });
  });

  describe('aviso ao aluno', () => {
    it('avisa com a data em dd/mm/aaaa, nos dois casos e também pela gestão', async () => {
      await clock(at('2026-11-15'));
      const kept = await subscribed();
      await charge(kept.sub.id, '2026-11', 'PAID');
      await post(admin, manage(`/subscriptions/${kept.sub.id}/cancel`), {
        reason: 'Pedido no balcão',
      }).expect(200);
      expect(await notificationsOf(t.db, kept.user.id)).toMatchObject([
        {
          type: 'SUBSCRIPTION_CANCELLED',
          title: 'Plano cancelado',
          body: expect.stringContaining('Seu plano fica ativo até 30/11/2026.'),
          data: { subscriptionId: kept.sub.id, accessUntil: '2026-11-30' },
        },
      ]);

      const ended = await subscribed();
      await cancel(ended.user, ended.sub.id);
      expect(await notificationsOf(t.db, ended.user.id)).toMatchObject([
        {
          type: 'SUBSCRIPTION_CANCELLED',
          body: expect.stringContaining('Seu acesso terminou em 15/11/2026.'),
          data: { accessUntil: '2026-11-15' },
        },
      ]);
    });

    it('pedido pendente é retirado na hora, sem aviso de acesso', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await t.db
        .update(subscriptions)
        .set({ status: 'PENDING_APPROVAL', startsOn: null })
        .where(eq(subscriptions.id, sub.id));
      await t.db
        .update(enrollments)
        .set({ status: 'PENDING' })
        .where(eq(enrollments.subscriptionId, sub.id));

      expect(await cancel(user, sub.id)).toMatchObject({
        status: 'CANCELLED',
        endsOn: null,
        accessUntil: null,
        rejected: false,
        enrollments: [],
      });
      expect(await notificationsOf(t.db, user.id)).toEqual([]);
    });
  });

  describe('troca de turma e desistência', () => {
    it('com o cancelamento pedido o aluno não troca de turma; desistindo, troca', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      const target = await freeGroup();
      const body = { fromClassGroupId: group.id, toClassGroupId: target.id };
      await cancel(user, sub.id);
      const refused = await post(user, mine(sub.id, 'swap-class-group'), body).expect(409);
      expect(refused.body.error).toMatchObject({
        code: 'SUBSCRIPTION_CANCEL_REQUESTED',
        details: { endsOn: '2026-11-30' },
      });

      await post(user, mine(sub.id, 'resume-cancel')).expect(200);
      await post(user, mine(sub.id, 'swap-class-group'), body).expect(200);
    });

    it('desistir volta ao ciclo normal: a mensalidade seguinte volta a ser gerada', async () => {
      await clock(at('2026-11-29'));
      const { user, sub } = await subscribed(3);
      await charge(sub.id, '2026-11', 'PAID', { dueDay: 3 });
      await charge(sub.id, '2026-12', 'PENDING', { dueDay: 3 });
      await cancel(user, sub.id, 'Viagem');
      expect((await chargesOf(t.db, sub.id)).map((c) => c.periodStart)).toEqual(['2026-11-01']);

      const res: Sub = (await post(user, mine(sub.id, 'resume-cancel')).expect(200)).body;
      expect(res).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        endsOn: null,
        accessUntil: null,
        accessUntilIfCancelled: '2026-11-30',
        statusReason: null,
        nextCharge: { dueDate: '2026-12-03', status: 'PENDING' },
      });
      expect((await chargesOf(t.db, sub.id)).map((c) => c.periodStart)).toEqual([
        '2026-11-01',
        '2026-12-01',
      ]);
      expect(await subscriptionRow(t.db, sub.id)).toMatchObject({
        cancelRequestedAt: null,
        cancelledBy: null,
      });
      expect(await auditOf(sub.id, 'subscription.resume_cancel')).toMatchObject({
        actorId: user.id,
        diff: { by: 'STUDENT', endsOn: '2026-11-30', chargesCreated: 1 },
      });

      await charges.processBilling(at('2026-12-01'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('ACTIVE');
    });

    it('a gestão também desiste; a saída das aulas não é desfeita', async () => {
      await clock(at('2026-11-15'));
      const { user, sub, group } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      const after = await session(group, at('2026-12-02', 19 * 60));
      await list(after.id, user.id, 'CONFIRMED');
      await cancel(user, sub.id);

      const res = await post(admin, manage(`/subscriptions/${sub.id}/resume-cancel`)).expect(200);
      expect(res.body).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: false, endsOn: null });
      expect(await auditOf(sub.id, 'subscription.resume_cancel')).toMatchObject({
        actorId: admin.id,
        diff: { by: 'STAFF' },
      });
      const resumed = (await notificationsOf(t.db, user.id)).filter(
        (n) => n.type === 'SUBSCRIPTION_CANCEL_RESUMED',
      );
      expect(resumed).toMatchObject([
        {
          title: 'Cancelamento desfeito',
          body: expect.stringContaining('Seu plano segue ativo.'),
          data: { subscriptionId: sub.id, spaceId: space.id },
        },
      ]);
      expect((await attendance(after.id, user.id))?.status).toBe('CANCELLED');
      // Sem fim marcado, volta a confirmar.
      await post(user, `/v1/me/class-sessions/${after.id}/attendance`).expect(200);
    });

    it('quem desiste pelo app não recebe o aviso de cancelamento desfeito', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      await post(user, mine(sub.id, 'resume-cancel')).expect(200);
      expect((await notificationsOf(t.db, user.id)).map((n) => n.type)).toEqual([
        'SUBSCRIPTION_CANCELLED',
      ]);
    });

    it('admin de outro espaço e professor não desfazem o cancelamento pela gestão', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await cancel(user, sub.id);
      const otherSpace = await createSpace(t.db, 'arena-cancelamento-outra');
      const outsider = await member(t, 'admin-outro-cancel@exemplo.com', otherSpace.id, 'ADMIN');
      const path = `/subscriptions/${sub.id}/resume-cancel`;

      const forbidden = await post(outsider, manage(path)).expect(403);
      expect(forbidden.body.error.code).toBe('SPACE_FORBIDDEN');
      const otherTenant = await post(outsider, `/v1/manage/spaces/${otherSpace.id}${path}`).expect(
        404,
      );
      expect(otherTenant.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
      const byTeacher = await post(teacher, manage(path)).expect(403);
      expect(byTeacher.body.error.code).toBe('SPACE_FORBIDDEN');

      expect(await subscriptionRow(t.db, sub.id)).toMatchObject({
        cancelAtPeriodEnd: true,
        endsOn: '2026-11-30',
      });
      expect(await auditOf(sub.id, 'subscription.resume_cancel')).toBeUndefined();
      expect((await notificationsOf(t.db, user.id)).map((n) => n.type)).toEqual([
        'SUBSCRIPTION_CANCELLED',
      ]);
    });

    it('desiste até o último dia; depois de ends_on, mesmo antes do job, não', async () => {
      await clock(at('2026-11-15'));
      const lastDay = await subscribed();
      await charge(lastDay.sub.id, '2026-11', 'PAID');
      await cancel(lastDay.user, lastDay.sub.id);
      const tooLate = await subscribed();
      await charge(tooLate.sub.id, '2026-11', 'PAID');
      await cancel(tooLate.user, tooLate.sub.id);

      await clock(at('2026-11-30', 23 * 60));
      await post(lastDay.user, mine(lastDay.sub.id, 'resume-cancel')).expect(200);

      await clock(at('2026-12-01', 5));
      await post(tooLate.user, mine(tooLate.sub.id, 'resume-cancel')).expect(
        409,
        /INVALID_SUBSCRIPTION_STATUS/,
      );
    });

    it('sem cancelamento pedido: desistir é recusado; de outro aluno, 404', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await charge(sub.id, '2026-11', 'PAID');
      await post(user, mine(sub.id, 'resume-cancel')).expect(409, /INVALID_SUBSCRIPTION_STATUS/);
      const other = await signUp(t, `outro-cancel-${++seq}@exemplo.com`);
      await post(other, mine(sub.id, 'resume-cancel')).expect(404);
    });

    it('os endpoints da pausa não existem mais', async () => {
      await clock(at('2026-11-15'));
      const { user, sub } = await subscribed();
      await post(user, mine(sub.id, 'pause'), { startMonth: '2026-12', months: 1 }).expect(404);
      await post(user, mine(sub.id, 'resume')).expect(404);
      await post(admin, manage(`/subscriptions/${sub.id}/pause`), {
        startMonth: '2026-12',
        months: 1,
      }).expect(404);
      await post(admin, manage(`/subscriptions/${sub.id}/resume`)).expect(404);
    });
  });
});
