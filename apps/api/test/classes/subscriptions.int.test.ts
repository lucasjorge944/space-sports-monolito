import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SubscriptionChargesService } from '../../src/classes/subscription-charges.service.js';
import {
  auditLogs,
  enrollments,
  plans,
  spaceSettings,
  spaces,
  subscriptionCharges,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { moveToManaus, teacherMemberId } from './fixtures.js';
import {
  at,
  chargesOf,
  insertGroup,
  insertPlan,
  notificationsOf,
  otherSport,
  subscriptionRow,
  travel,
  useFixedClock,
} from './subscription-fixtures.js';

// Tarefa 2.2: assinaturas, matrículas e mensalidades (RF-CLASS-04..06, RF-CLASS-11;
// RN-CLASS-01/02/06; decisões 12, 24 e 25) e as permissões da matriz de docs/02. Cancelamento
// (RN-CLASS-08) em subscription-cancel.int.test.ts.

const TODAY = '2026-11-05';
useFixedClock(TODAY);

type Sub = {
  id: string;
  status: string;
  priceCents: number;
  startsOn: string | null;
  endsOn: string | null;
  cancelAtPeriodEnd: boolean;
  rejected: boolean;
  enrollments: { id: string; status: string; classGroup: { id: string } }[];
  nextCharge: { chargeId: string | null; dueDate: string; status: string } | null;
  charges: {
    id: string;
    status: string;
    dueDate: string;
    amountCents: number;
    paidCents: number;
  }[];
};

describe('assinaturas e mensalidades das aulas', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let teacherId: string;
  let studentN = 0;
  let nextSlot = 0;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-assinaturas');
    owner = await member(t, 'dono-ass@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin-ass@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'prof-ass@exemplo.com', space.id, 'TEACHER');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
  });
  afterAll(() => t.close());

  const student = () => signUp(t, `aluno-ass-${studentN++}@exemplo.com`);
  const manage = (path: string) => `/v1/manage/spaces/${space.id}${path}`;
  const req = (
    method: 'get' | 'post' | 'patch' | 'delete',
    user: SignedUp,
    path: string,
    body?: object,
  ) => {
    const r = t
      .http()
      [method](path)
      .set(...bearer(user));
    return body ? r.send(body) : r;
  };

  /** Turma de futevôlei de 30 min num horário novo (00:00, 00:30, …; volta depois de 23:30). */
  const group = (overrides: Partial<Parameters<typeof insertGroup>[1]> = {}) => {
    const minute = (nextSlot++ % 48) * 30;
    return insertGroup(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      teacherMemberId: teacherId,
      courtId: space.courtA,
      name: 'Turma',
      weekday: 1,
      startTime: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
      durationMin: 30,
      capacity: 5,
      ...overrides,
    });
  };
  const plan = (overrides: Partial<Parameters<typeof insertPlan>[1]> = {}) =>
    insertPlan(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      name: 'Futevôlei 2x',
      weeklyFrequency: 2,
      priceCents: 18_000,
      billingDay: 10,
      ...overrides,
    });

  async function request(user: SignedUp, planId: string, classGroupIds: string[]): Promise<Sub> {
    const res = await req('post', user, '/v1/me/subscriptions', { planId, classGroupIds }).expect(
      201,
    );
    return res.body;
  }
  async function approve(subId: string, by: SignedUp = admin): Promise<Sub> {
    return (await req('post', by, manage(`/subscriptions/${subId}/approve`), {}).expect(200)).body;
  }
  /** Aluno com uma assinatura 2x aprovada hoje. */
  async function activeSubscription(planOverrides = {}) {
    const p = await plan(planOverrides);
    const [g1, g2] = [await group(), await group({ weekday: 3 })];
    const user = await student();
    const sub = await approve((await request(user, p.id, [g1.id, g2.id])).id);
    return { user, plan: p, groups: [g1, g2], sub };
  }

  describe('pedido (RF-CLASS-04, RN-CLASS-01)', () => {
    it('Nx/semana exige exatamente N turmas do esporte do plano, sem coincidir no horário', async () => {
      const p = await plan();
      const g1 = await group();
      const g2 = await group({ weekday: 2 });
      const tennis = await group({ sportId: (await otherSport(t.db)).id });
      const sameTime = await group({ courtId: space.courtB, startTime: g1.startTime });
      const inactive = await group({ active: false });
      const user = await student();
      const post = (classGroupIds: string[]) =>
        req('post', user, '/v1/me/subscriptions', { planId: p.id, classGroupIds });

      const one = await post([g1.id]).expect(422);
      expect(one.body.error).toMatchObject({
        code: 'CLASS_GROUP_COUNT_MISMATCH',
        details: { expected: 2, received: 1 },
      });
      expect((await post([g1.id, tennis.id]).expect(422)).body.error).toMatchObject({
        code: 'CLASS_GROUP_NOT_ELIGIBLE',
        details: { classGroupId: tennis.id },
      });
      expect((await post([g1.id, inactive.id]).expect(422)).body.error.code).toBe(
        'CLASS_GROUP_NOT_ELIGIBLE',
      );
      expect((await post([g1.id, sameTime.id]).expect(422)).body.error.code).toBe(
        'CLASS_GROUPS_OVERLAP',
      );
      expect((await post([g1.id, g1.id]).expect(400)).body.error.code).toBe('VALIDATION_ERROR');

      const sub: Sub = (await post([g1.id, g2.id]).expect(201)).body;
      expect(sub).toMatchObject({
        status: 'PENDING_APPROVAL',
        priceCents: 18_000,
        startsOn: null,
        nextCharge: null,
        charges: [],
      });
      expect(sub.enrollments.map((e) => e.status)).toEqual(['PENDING', 'PENDING']);
      // Matrícula pendente não ocupa vaga.
      const groups = await req('get', admin, manage('/class-groups')).expect(200);
      const listed = groups.body.items.find((g: { id: string }) => g.id === g1.id);
      expect(listed).toMatchObject({ enrolledCount: 0, availableSpots: 5 });
    });

    it('ilimitado aceita as turmas que o aluno escolher (decisão 12)', async () => {
      const p = await plan({ name: 'Ilimitado', weeklyFrequency: null, priceCents: 25_000 });
      const groups = [await group(), await group({ weekday: 2 }), await group({ weekday: 4 })];
      const sub = await request(
        await student(),
        p.id,
        groups.map((g) => g.id),
      );
      expect(sub.enrollments).toHaveLength(3);
    });

    it('uma assinatura em aberto por plano; plano inativo não aceita pedido', async () => {
      const p = await plan({ weeklyFrequency: 1 });
      const g = await group();
      const user = await student();
      await request(user, p.id, [g.id]);
      const again = await req('post', user, '/v1/me/subscriptions', {
        planId: p.id,
        classGroupIds: [g.id],
      }).expect(409);
      expect(again.body.error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');

      const off = await plan({ weeklyFrequency: 1, active: false });
      const res = await req('post', user, '/v1/me/subscriptions', {
        planId: off.id,
        classGroupIds: [g.id],
      }).expect(409);
      expect(res.body.error.code).toBe('PLAN_INACTIVE');
    });

    it('turma lotada é avisada já no pedido', async () => {
      const p = await plan({ weeklyFrequency: 1 });
      const g = await group({ capacity: 1 });
      await approve((await request(await student(), p.id, [g.id])).id);
      const res = await req('post', await student(), '/v1/me/subscriptions', {
        planId: p.id,
        classGroupIds: [g.id],
      }).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CLASS_GROUP_FULL',
        details: { classGroupId: g.id },
      });
    });
  });

  describe('aprovação e recusa (RF-CLASS-05, RN-CLASS-02)', () => {
    it('aprova com o preço do pedido, matrículas ativas e a mensalidade do mês; avisa o aluno', async () => {
      const p = await plan();
      const [g1, g2] = [await group(), await group({ weekday: 3 })];
      const user = await student();
      const pending = await request(user, p.id, [g1.id, g2.id]);
      // Preço novo do plano não muda o contratado (snapshot).
      await t.db.update(plans).set({ priceCents: 99_900 }).where(eq(plans.id, p.id));

      const sub = await approve(pending.id);
      expect(sub).toMatchObject({
        status: 'ACTIVE',
        startsOn: TODAY,
        priceCents: 18_000,
        currentPeriodStart: TODAY,
        currentPeriodEnd: '2026-11-30',
        nextCharge: { dueDate: '2026-11-10', status: 'PENDING', amountCents: 18_000 },
      });
      expect(sub.enrollments.map((e) => e.status)).toEqual(['ACTIVE', 'ACTIVE']);
      // Sem pró-rata: aprovado até o vencimento, paga o mês cheio.
      expect(sub.charges).toMatchObject([
        {
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
          dueDate: '2026-11-10',
          amountCents: 18_000,
          status: 'PENDING',
        },
      ]);
      const inbox = await notificationsOf(t.db, user.id);
      expect(inbox).toEqual([
        expect.objectContaining({
          type: 'SUBSCRIPTION_APPROVED',
          data: expect.objectContaining({ subscriptionId: sub.id }),
        }),
      ]);
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, sub.id), eq(auditLogs.action, 'subscription.approve')));
      expect(log?.actorId).toBe(admin.id);
    });

    it('aprovado depois do vencimento começa a pagar no mês seguinte', async () => {
      const p = await plan({ billingDay: 3 });
      const sub = await approve(
        (
          await request(await student(), p.id, [
            (await group()).id,
            (await group({ weekday: 3 })).id,
          ])
        ).id,
      );
      expect(sub.charges).toEqual([]);
      expect(sub.nextCharge).toMatchObject({
        chargeId: null,
        dueDate: '2026-12-03',
        status: 'PROJECTED',
      });
    });

    it('recusa com motivo, libera o pedido e avisa; o aluno pode pedir de novo', async () => {
      const p = await plan({ weeklyFrequency: 1 });
      const g = await group();
      const user = await student();
      const pending = await request(user, p.id, [g.id]);
      const res = await req('post', admin, manage(`/subscriptions/${pending.id}/reject`), {
        reason: 'Turma reservada para o nível avançado',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        rejected: true,
        statusReason: 'Turma reservada para o nível avançado',
        enrollments: [],
      });
      expect((await notificationsOf(t.db, user.id)).map((n) => n.type)).toEqual([
        'SUBSCRIPTION_REJECTED',
      ]);
      await req('post', admin, manage(`/subscriptions/${pending.id}/approve`), {}).expect(409);
      await request(user, p.id, [g.id]);
    });

    it('a gestão pode trocar as turmas na aprovação', async () => {
      const p = await plan({ weeklyFrequency: 1 });
      const [asked, chosen] = [await group(), await group()];
      const pending = await request(await student(), p.id, [asked.id]);
      const res = await req('post', admin, manage(`/subscriptions/${pending.id}/approve`), {
        classGroupIds: [chosen.id],
      }).expect(200);
      expect(res.body.enrollments.map((e: Sub['enrollments'][0]) => e.classGroup.id)).toEqual([
        chosen.id,
      ]);
    });

    it('duas aprovações simultâneas na última vaga: só uma passa (RN-CLASS-02)', async () => {
      const p = await plan({ weeklyFrequency: 1 });
      const g = await group({ capacity: 1 });
      const a = await request(await student(), p.id, [g.id]);
      const b = await request(await student(), p.id, [g.id]);
      const results = await Promise.all(
        [a, b].map((sub) => req('post', admin, manage(`/subscriptions/${sub.id}/approve`), {})),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body.error.code).toBe('CLASS_GROUP_FULL');
      const active = await t.db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.classGroupId, g.id), eq(enrollments.status, 'ACTIVE')));
      expect(active).toHaveLength(1);
    });
  });

  describe('permissões (docs/02) e espaço suspenso', () => {
    it('Professor não vê assinaturas nem mensalidades e não dispensa', async () => {
      const { sub } = await activeSubscription();
      for (const path of ['/subscriptions', `/subscriptions/${sub.id}`, '/subscription-charges']) {
        expect((await req('get', teacher, manage(path)).expect(403)).body.error.code).toBe(
          'SPACE_FORBIDDEN',
        );
      }
      const chargeId = sub.charges[0]?.id;
      await req('post', teacher, manage(`/subscription-charges/${chargeId}/waive`), {}).expect(403);
      await req('get', admin, manage('/subscription-charges/delinquents')).expect(200);
      await req('get', owner, manage(`/subscriptions/${sub.id}`)).expect(200);
    });

    it('o aluno só vê as próprias assinaturas', async () => {
      const { sub } = await activeSubscription();
      const other = await student();
      const res = await req('get', other, `/v1/me/subscriptions/${sub.id}`).expect(404);
      expect(res.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
      await req('post', other, `/v1/me/subscriptions/${sub.id}/cancel`, {}).expect(404);
      expect((await req('get', other, '/v1/me/subscriptions').expect(200)).body.items).toEqual([]);
    });

    it('espaço suspenso: pedido e ações do aluno e da gestão ficam só leitura', async () => {
      const p = await plan({ weeklyFrequency: 1 });
      const g = await group();
      const user = await student();
      const pending = await request(user, p.id, [g.id]);
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, space.id));
      try {
        const res = await req('post', user, '/v1/me/subscriptions', {
          planId: p.id,
          classGroupIds: [g.id],
        }).expect(403);
        expect(res.body.error.code).toBe('SPACE_READ_ONLY');
        await req('post', user, `/v1/me/subscriptions/${pending.id}/cancel`, {}).expect(403);
        const approveRes = await req(
          'post',
          admin,
          manage(`/subscriptions/${pending.id}/approve`),
          {},
        ).expect(403);
        expect(approveRes.body.error.code).toBe('SPACE_READ_ONLY');
        await req('get', user, `/v1/me/subscriptions/${pending.id}`).expect(200);
        await req('get', admin, manage('/subscriptions')).expect(200);
      } finally {
        await t.db.update(spaces).set({ status: 'ACTIVE' }).where(eq(spaces.id, space.id));
      }
    });
  });

  describe('choque de horário (RN-CLASS-01, decisão 37)', () => {
    let manaus: Space;
    let manausTeacherId: string;

    beforeAll(async () => {
      manaus = await createSpace(t.db, 'arena-assinaturas-manaus');
      await moveToManaus(t.db, manaus.id);
      const manausTeacher = await member(t, 'prof-ass-manaus@exemplo.com', manaus.id, 'TEACHER');
      manausTeacherId = await teacherMemberId(t.db, manausTeacher.id, manaus.id);
    });

    /** Turma de 60 min às terças num horário fixo. */
    const at = (startTime: string, overrides: Partial<Parameters<typeof insertGroup>[1]> = {}) =>
      group({ weekday: 2, startTime, durationMin: 60, ...overrides });
    const atManaus = (startTime: string) =>
      at(startTime, {
        spaceId: manaus.id,
        courtId: manaus.courtA,
        teacherMemberId: manausTeacherId,
        name: `Manaus ${startTime}`,
      });
    const single = (overrides: Partial<Parameters<typeof insertPlan>[1]> = {}) =>
      plan({ weeklyFrequency: 1, ...overrides });
    const ask = (user: SignedUp, planId: string, classGroupIds: string[]) =>
      req('post', user, '/v1/me/subscriptions', { planId, classGroupIds });

    it('o pedido recusa turma no horário de outra assinatura, pendente, de outro esporte ou espaço', async () => {
      const user = await student();
      const tennis = (await otherSport(t.db)).id;
      const beach = await at('19:00', { sportId: tennis, name: 'Beach 19h' });
      const pending: Sub = (
        await ask(user, (await single({ sportId: tennis })).id, [beach.id]).expect(201)
      ).body;

      const clash = await at('19:30');
      const res = await ask(user, (await single()).id, [clash.id]).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CLASS_SCHEDULE_OVERLAP',
        details: {
          classGroupId: clash.id,
          conflict: {
            classGroupName: 'Beach 19h',
            spaceName: 'Espaço arena-assinaturas',
            weekday: 2,
            startTime: '19:00',
            durationMin: 60,
            timeZone: 'America/Sao_Paulo',
          },
        },
      });
      // Horário adjacente não conflita.
      const adjacent = await at('20:00', { name: 'Futevôlei 20h' });
      await ask(user, (await single()).id, [adjacent.id]).expect(201);

      // Manaus (UTC−4): 18:00 lá = 19:00 aqui; 19:00 lá = 20:00 aqui; 17:00 lá = 18:00 aqui.
      const manausPlan = () =>
        insertPlan(t.db, {
          spaceId: manaus.id,
          sportId: manaus.sportId,
          name: 'Manaus 1x',
          weeklyFrequency: 1,
          priceCents: 10_000,
          billingDay: 10,
        });
      const at18 = await ask(user, (await manausPlan()).id, [(await atManaus('18:00')).id]).expect(
        409,
      );
      expect(at18.body.error.details.conflict).toMatchObject({ classGroupName: 'Beach 19h' });
      const at19 = await ask(user, (await manausPlan()).id, [(await atManaus('19:00')).id]).expect(
        409,
      );
      expect(at19.body.error.details.conflict).toMatchObject({
        classGroupName: 'Futevôlei 20h',
        spaceName: 'Espaço arena-assinaturas',
      });
      const ok: Sub = (
        await ask(user, (await manausPlan()).id, [(await atManaus('17:00')).id]).expect(201)
      ).body;
      // Do outro lado: a turma daqui às 18:00 bate com a de Manaus, mostrando só o nome e o espaço.
      const res2 = await ask(user, (await single()).id, [(await at('18:00')).id]).expect(409);
      expect(res2.body.error.details.conflict).toEqual({
        classGroupName: 'Manaus 17:00',
        spaceName: 'Espaço arena-assinaturas-manaus',
        weekday: 2,
        startTime: '17:00',
        durationMin: 60,
        timeZone: 'America/Manaus',
      });

      // Pedido retirado libera o horário.
      await req('post', user, `/v1/me/subscriptions/${pending.id}/cancel`, {}).expect(200);
      await req('post', user, `/v1/me/subscriptions/${ok.id}/cancel`, {}).expect(200);
      await ask(user, (await single()).id, [(await at('19:00')).id]).expect(201);
    });

    it('aprovação, troca de turma e matrícula pela gestão também recusam', async () => {
      const { user, sub, groups } = await activeSubscription();
      const [g1] = groups;
      if (!g1) throw new Error('sem turma');
      const tennis = (await otherSport(t.db)).id;
      const morning = await group({
        sportId: tennis,
        weekday: 4,
        startTime: '07:00',
        durationMin: 60,
      });
      const pending: Sub = (
        await ask(user, (await single({ sportId: tennis })).id, [morning.id]).expect(201)
      ).body;

      // A gestão troca a turma na aprovação para uma no horário da assinatura ativa.
      const clash = await group({ sportId: tennis, weekday: g1.weekday, startTime: g1.startTime });
      const approveRes = await req('post', admin, manage(`/subscriptions/${pending.id}/approve`), {
        classGroupIds: [clash.id],
      }).expect(409);
      expect(approveRes.body.error).toMatchObject({
        code: 'CLASS_SCHEDULE_OVERLAP',
        details: { classGroupId: clash.id },
      });
      await approve(pending.id);

      const swap = await req('post', user, `/v1/me/subscriptions/${sub.id}/swap-class-group`, {
        fromClassGroupId: g1.id,
        toClassGroupId: (await group({ weekday: 4, startTime: '07:30' })).id,
      }).expect(409);
      expect(swap.body.error.code).toBe('CLASS_SCHEDULE_OVERLAP');

      const enrollment = sub.enrollments.find((e) => e.classGroup.id === g1.id);
      await req(
        'delete',
        admin,
        manage(`/subscriptions/${sub.id}/enrollments/${enrollment?.id}`),
      ).expect(200);
      const add = (classGroupId: string) =>
        req('post', admin, manage(`/subscriptions/${sub.id}/enrollments`), { classGroupId });
      expect(
        (
          await add((await group({ weekday: 4, startTime: '06:30', durationMin: 60 })).id).expect(
            409,
          )
        ).body.error.code,
      ).toBe('CLASS_SCHEDULE_OVERLAP');
      await add((await group({ weekday: 4, startTime: '08:00' })).id).expect(201);
    });
  });

  describe('turmas do aluno (RF-CLASS-05/06)', () => {
    it('troca de turma confere a vaga e encerra a matrícula antiga', async () => {
      const { user, sub, groups } = await activeSubscription();
      const full = await group({ weekday: 5, capacity: 1 });
      await approve(
        (await request(await student(), (await plan({ weeklyFrequency: 1 })).id, [full.id])).id,
      );
      const swap = (to: string) =>
        req('post', user, `/v1/me/subscriptions/${sub.id}/swap-class-group`, {
          fromClassGroupId: groups[0]?.id,
          toClassGroupId: to,
        });
      expect((await swap(full.id).expect(409)).body.error.code).toBe('CLASS_GROUP_FULL');
      expect((await swap(groups[1]?.id ?? '').expect(409)).body.error.code).toBe(
        'ALREADY_ENROLLED',
      );

      const free = await group({ weekday: 6 });
      const res: Sub = (await swap(free.id).expect(200)).body;
      expect(res.enrollments.map((e) => [e.classGroup.id, e.status])).toEqual(
        expect.arrayContaining([
          [free.id, 'ACTIVE'],
          [groups[1]?.id, 'ACTIVE'],
          [groups[0]?.id, 'ENDED'],
        ]),
      );
      const missing = await req('post', user, `/v1/me/subscriptions/${sub.id}/swap-class-group`, {
        fromClassGroupId: groups[0]?.id,
        toClassGroupId: (await group({ weekday: 0 })).id,
      }).expect(404);
      expect(missing.body.error.code).toBe('ENROLLMENT_NOT_FOUND');
    });

    it('a gestão matricula até N turmas no plano Nx e quantas quiser no ilimitado; desmatricula', async () => {
      const { sub } = await activeSubscription();
      const extra = await group({ weekday: 4 });
      const res = await req('post', admin, manage(`/subscriptions/${sub.id}/enrollments`), {
        classGroupId: extra.id,
      }).expect(409);
      expect(res.body.error.code).toBe('PLAN_FREQUENCY_REACHED');

      const enrollment = sub.enrollments[0];
      const ended: Sub = (
        await req(
          'delete',
          admin,
          manage(`/subscriptions/${sub.id}/enrollments/${enrollment?.id}`),
        ).expect(200)
      ).body;
      expect(ended.enrollments.filter((e) => e.status === 'ACTIVE')).toHaveLength(1);
      await req('post', admin, manage(`/subscriptions/${sub.id}/enrollments`), {
        classGroupId: extra.id,
      }).expect(201);

      const unlimited = await activeSubscription({ weeklyFrequency: null });
      await req('post', admin, manage(`/subscriptions/${unlimited.sub.id}/enrollments`), {
        classGroupId: extra.id,
      }).expect(201);
    });

    it('define a forma de pagamento preferida e lista as mensalidades', async () => {
      const { user, sub } = await activeSubscription();
      const res = await req('patch', user, `/v1/me/subscriptions/${sub.id}`, {
        intendedPaymentMethod: 'PIX',
      }).expect(200);
      expect(res.body.intendedPaymentMethod).toBe('PIX');
      const charges = await req('get', user, `/v1/me/subscriptions/${sub.id}/charges`).expect(200);
      expect(charges.body.items).toMatchObject([
        { dueDate: '2026-11-10', amountCents: 18_000, dueCents: 18_000, payments: [] },
      ]);
    });
  });

  describe('pagamento, estorno e dispensa (RF-PAY-01, RF-CLASS-11)', () => {
    const pay = (chargeId: string, amountCents: number, by: SignedUp = admin) =>
      req('post', by, manage('/payments'), {
        payableType: 'SUBSCRIPTION_CHARGE',
        payableId: chargeId,
        amountCents,
        method: 'PIX',
      });

    it('registra parcial e total, recusa acima do devido, estorna e entra no extrato como aula', async () => {
      const { user, sub } = await activeSubscription();
      const chargeId = sub.charges[0]?.id ?? '';
      await pay(chargeId, 8_000).expect(201);
      expect((await pay(chargeId, 10_001).expect(422)).body.error).toMatchObject({
        code: 'PAYMENT_EXCEEDS_DUE',
      });
      const full = await pay(chargeId, 10_000).expect(201);
      expect(full.body).toMatchObject({ payableType: 'SUBSCRIPTION_CHARGE', payerUserId: user.id });
      const paid = (await req('get', user, `/v1/me/subscriptions/${sub.id}`).expect(200)).body;
      expect(paid.charges[0]).toMatchObject({ status: 'PAID', paidCents: 18_000, dueCents: 0 });
      expect(paid.charges[0].payments).toHaveLength(2);

      await req('post', admin, manage(`/payments/${full.body.id}/reverse`), {
        reason: 'Pix não caiu',
      }).expect(200);
      await req('post', admin, manage(`/payments/${full.body.id}/reverse`), {}).expect(409);
      const [charge] = await chargesOf(t.db, sub.id);
      expect(charge?.status).toBe('PENDING');

      const statement = await req(
        'get',
        admin,
        manage(
          `/statement?from=${at('2026-11-01').toISOString()}&to=${at('2026-12-01').toISOString()}&service=CLASS`,
        ),
      ).expect(200);
      const mine = statement.body.items.filter(
        (e: { subscriptionId: string }) => e.subscriptionId === sub.id,
      );
      expect(mine).toHaveLength(2);
      expect(mine[0]).toMatchObject({
        service: 'CLASS',
        planName: 'Futevôlei 2x',
        chargePeriodStart: '2026-11-01',
        payerName: expect.any(String),
      });
      const rental = await req(
        'get',
        admin,
        manage(
          `/statement?from=${at('2026-11-01').toISOString()}&to=${at('2026-12-01').toISOString()}&service=RENTAL`,
        ),
      ).expect(200);
      expect(rental.body.items).toEqual([]);
    });

    it('dispensa só pelo Dono/Admin, só em aberto e sem pagamento', async () => {
      const { sub } = await activeSubscription();
      const chargeId = sub.charges[0]?.id ?? '';
      const payment = await pay(chargeId, 1_000).expect(201);
      expect(
        (
          await req('post', admin, manage(`/subscription-charges/${chargeId}/waive`), {}).expect(
            409,
          )
        ).body.error.code,
      ).toBe('CHARGE_HAS_PAYMENTS');
      await req('post', admin, manage(`/payments/${payment.body.id}/reverse`), {}).expect(200);

      const waived = await req('post', owner, manage(`/subscription-charges/${chargeId}/waive`), {
        reason: 'Bolsa',
      }).expect(200);
      expect(waived.body).toMatchObject({ status: 'WAIVED', dueCents: 0, waiveReason: 'Bolsa' });
      await req('post', admin, manage(`/subscription-charges/${chargeId}/waive`), {}).expect(200);
      expect((await pay(chargeId, 1_000).expect(409)).body.error.code).toBe('CHARGE_NOT_PAYABLE');

      const other = await activeSubscription();
      const otherCharge = other.sub.charges[0]?.id ?? '';
      await pay(otherCharge, 18_000).expect(201);
      expect(
        (
          await req('post', admin, manage(`/subscription-charges/${otherCharge}/waive`), {}).expect(
            409,
          )
        ).body.error.code,
      ).toBe('CHARGE_NOT_WAIVABLE');
    });

    it('atraso de mais de X dias leva a PAST_DUE; pagar volta a ACTIVE (RN-CLASS-06)', async () => {
      const { user, sub } = await activeSubscription();
      const charges = t.app.get(SubscriptionChargesService);
      await charges.processBilling(at('2026-11-17'));
      expect(await subscriptionRow(t.db, sub.id)).toMatchObject({ status: 'ACTIVE' });
      expect((await chargesOf(t.db, sub.id))[0]?.status).toBe('OVERDUE');
      await charges.processBilling(at('2026-11-18'));
      expect((await subscriptionRow(t.db, sub.id)).status).toBe('PAST_DUE');

      travel('2026-11-18');
      try {
        const list = await req(
          'get',
          admin,
          manage(`/subscription-charges?overdue=true&userId=${user.id}`),
        ).expect(200);
        expect(list.body.items.map((c: { id: string }) => c.id)).toContain(sub.charges[0]?.id);
        const delinquents = await req(
          'get',
          admin,
          manage('/subscription-charges/delinquents'),
        ).expect(200);
        expect(delinquents.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              subscriptionId: sub.id,
              subscriptionStatus: 'PAST_DUE',
              overdueCents: 18_000,
              oldestDueDate: '2026-11-10',
              daysOverdue: 8,
            }),
          ]),
        );
        await pay(sub.charges[0]?.id ?? '', 18_000).expect(201);
        expect(await subscriptionRow(t.db, sub.id)).toMatchObject({ status: 'ACTIVE' });
      } finally {
        travel(TODAY);
      }
    });

    it('regra de atraso desligada: a assinatura segue ACTIVE', async () => {
      const { sub } = await activeSubscription();
      await t.db
        .update(spaceSettings)
        .set({ pastDueBlockEnabled: false })
        .where(eq(spaceSettings.spaceId, space.id));
      try {
        await t.app.get(SubscriptionChargesService).processBilling(at('2026-11-25'));
        expect((await subscriptionRow(t.db, sub.id)).status).toBe('ACTIVE');
      } finally {
        await t.db
          .update(spaceSettings)
          .set({ pastDueBlockEnabled: true })
          .where(eq(spaceSettings.spaceId, space.id));
      }
      // Reestabelece o mês: as mensalidades vencidas dos testes anteriores não interessam aqui.
      await t.db
        .update(subscriptionCharges)
        .set({ status: 'PAID' })
        .where(eq(subscriptionCharges.subscriptionId, sub.id));
    });
  });
});
