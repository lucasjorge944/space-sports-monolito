import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PartialClassJobFailure } from '../../src/classes/class-sessions.jobs.js';
import { SubscriptionChargesService } from '../../src/classes/subscription-charges.service.js';
import { runSubscriptionsJob, SUBSCRIPTIONS_JOBS } from '../../src/classes/subscriptions.jobs.js';
import {
  cities,
  paymentRecords,
  spaces,
  subscriptionCharges,
  subscriptions,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { createSpace, type Space } from '../bookings/fixtures.js';
import {
  at,
  chargesOf,
  insertPlan,
  insertSubscription,
  notificationsOf,
  subscriptionRow,
  useFixedClock,
} from './subscription-fixtures.js';

// RF-CLASS-11 e RN-CLASS-06/08: job de mensalidades (fila própria, idempotente, retry só do
// que falhou) e lembretes de vencimento. Assinaturas inseridas direto no banco; o job recebe a
// data de execução.

useFixedClock('2026-11-05');

describe('job de mensalidades das assinaturas', () => {
  let t: TestApp;
  let charges: SubscriptionChargesService;
  let space: Space;
  let studentN = 0;

  beforeAll(async () => {
    t = await createTestApp();
    charges = t.app.get(SubscriptionChargesService);
    space = await createSpace(t.db, 'arena-mensalidades');
  });
  afterAll(() => t.close());
  // O job varre todas as assinaturas: encerra as do teste anterior.
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.db.update(subscriptions).set({ status: 'CANCELLED' });
  });

  const billing = (date: string) =>
    runSubscriptionsJob(SUBSCRIPTIONS_JOBS.processBilling, { charges }, at(date, 20));
  const reminders = (date: string) =>
    runSubscriptionsJob(SUBSCRIPTIONS_JOBS.sendChargeReminders, { charges }, at(date, 9 * 60));

  /** Assinatura ACTIVE aprovada em `startsOn`, num plano com vencimento em `billingDay`. */
  async function active(
    billingDay: number,
    startsOn = '2026-11-01',
    overrides: Partial<typeof subscriptions.$inferInsert> = {},
  ): Promise<{ id: string; user: SignedUp }> {
    const plan = await insertPlan(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      name: `Plano dia ${billingDay}`,
      weeklyFrequency: 1,
      priceCents: 15_000,
      billingDay,
    });
    const user = await signUp(t, `aluno-job-${studentN++}@exemplo.com`);
    const sub = await insertSubscription(t.db, {
      userId: user.id,
      planId: plan.id,
      spaceId: space.id,
      status: 'ACTIVE',
      priceCents: 15_000,
      startsOn,
      approvedAt: at(startsOn),
      ...overrides,
    });
    return { id: sub.id, user };
  }

  it('gera a mensalidade do mês uma vez só, com o preço contratado e sem pró-rata', async () => {
    const { id } = await active(10, '2026-11-04');
    const first = await billing('2026-11-05');
    expect(first).toMatchObject({ chargesCreated: 1, failures: 0 });
    expect(await billing('2026-11-05')).toMatchObject({ chargesCreated: 0 });
    await billing('2026-11-06');
    expect(await chargesOf(t.db, id)).toMatchObject([
      {
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        dueDate: '2026-11-10',
        amountCents: 15_000,
        status: 'PENDING',
      },
    ]);
    // Dezembro só a partir de 01/12 (vencimento no dia 10).
    await billing('2026-11-30');
    expect(await chargesOf(t.db, id)).toHaveLength(1);
    await billing('2026-12-01');
    expect((await chargesOf(t.db, id)).map((c) => c.dueDate)).toEqual(['2026-11-10', '2026-12-10']);
  });

  it('aprovado depois do vencimento só paga a partir do mês seguinte; vencimento no começo do mês sai antes', async () => {
    const late = await active(3, '2026-11-04');
    await billing('2026-11-05');
    expect(await chargesOf(t.db, late.id)).toEqual([]);
    await billing('2026-11-27');
    expect(await chargesOf(t.db, late.id)).toEqual([]);
    // 03/12 − 5 dias = 28/11.
    await billing('2026-11-28');
    expect((await chargesOf(t.db, late.id)).map((c) => c.dueDate)).toEqual(['2026-12-03']);
  });

  it('vencida vira OVERDUE; depois de X dias a assinatura fica PAST_DUE e pagar resolve', async () => {
    const { id } = await active(10);
    await billing('2026-11-05');
    await billing('2026-11-10');
    expect((await chargesOf(t.db, id))[0]?.status).toBe('PENDING');
    const eleventh = await billing('2026-11-11');
    expect(eleventh).toMatchObject({ markedOverdue: 1 });
    expect((await subscriptionRow(t.db, id)).status).toBe('ACTIVE');
    // 7 dias de atraso ainda não bloqueia; o 8º sim (padrão: mais de 7).
    await billing('2026-11-17');
    expect((await subscriptionRow(t.db, id)).status).toBe('ACTIVE');
    expect(await billing('2026-11-18')).toMatchObject({ becamePastDue: 1 });
    expect((await subscriptionRow(t.db, id)).status).toBe('PAST_DUE');
    // Rodar de novo não muda nada.
    expect(await billing('2026-11-18')).toMatchObject({ becamePastDue: 0, markedOverdue: 0 });

    // Dispensada pela gestão (ou paga): a regra é reavaliada na próxima rodada também.
    await t.db
      .update(subscriptionCharges)
      .set({ status: 'WAIVED', waivedAt: new Date() })
      .where(eq(subscriptionCharges.subscriptionId, id));
    expect(await billing('2026-11-19')).toMatchObject({ restored: 1 });
    expect((await subscriptionRow(t.db, id)).status).toBe('ACTIVE');
  });

  it('cancelamento pedido: cobra o ciclo atual, encerra depois do fim e não gera o próximo', async () => {
    const { id } = await active(10, '2026-11-01', {
      cancelAtPeriodEnd: true,
      endsOn: '2026-11-30',
    });
    await billing('2026-11-05');
    expect(await chargesOf(t.db, id)).toHaveLength(1);
    expect(await billing('2026-12-01')).toMatchObject({ cancelled: 1, chargesCreated: 0 });
    expect((await subscriptionRow(t.db, id)).status).toBe('CANCELLED');
    // A do ciclo atual segue devida (e vencida).
    expect((await chargesOf(t.db, id)).map((c) => c.status)).toEqual(['OVERDUE']);
  });

  it('espaço suspenso fica fora da rodada', async () => {
    const { id } = await active(10);
    await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, space.id));
    try {
      expect(await billing('2026-11-05')).toMatchObject({ subscriptions: 0 });
      expect(await chargesOf(t.db, id)).toEqual([]);
    } finally {
      await t.db.update(spaces).set({ status: 'ACTIVE' }).where(eq(spaces.id, space.id));
    }
  });

  it('falha de uma assinatura não para as outras; o retry completa sem duplicar', async () => {
    const ok = await active(10);
    const broken = await active(10);
    const processOne = Reflect.get(charges, 'processOne') as (...args: unknown[]) => Promise<void>;
    const spy = vi
      .spyOn(charges as unknown as { processOne: typeof processOne }, 'processOne')
      .mockImplementation(async function (this: unknown, ...args: unknown[]) {
        if (args[1] === broken.id) throw new Error('falha simulada');
        return processOne.apply(charges, args);
      });
    await expect(billing('2026-11-05')).rejects.toBeInstanceOf(PartialClassJobFailure);
    expect(await chargesOf(t.db, ok.id)).toHaveLength(1);
    expect(await chargesOf(t.db, broken.id)).toEqual([]);

    spy.mockRestore();
    expect(await billing('2026-11-05')).toMatchObject({ chargesCreated: 1, failures: 0 });
    expect(await chargesOf(t.db, ok.id)).toHaveLength(1);
    expect(await chargesOf(t.db, broken.id)).toHaveLength(1);
  });

  it('avisa a mensalidade próxima do vencimento e a vencida, uma vez cada', async () => {
    const { id, user } = await active(10);
    await billing('2026-11-05');
    expect(await reminders('2026-11-06')).toEqual({ dueSoon: 0, overdue: 0 });
    expect(await reminders('2026-11-07')).toEqual({ dueSoon: 1, overdue: 0 });
    expect(await reminders('2026-11-08')).toEqual({ dueSoon: 0, overdue: 0 });

    await billing('2026-11-11');
    expect(await reminders('2026-11-11')).toEqual({ dueSoon: 0, overdue: 1 });
    expect(await reminders('2026-11-12')).toEqual({ dueSoon: 0, overdue: 0 });

    const inbox = await notificationsOf(t.db, user.id);
    expect(inbox.map((n) => n.type).sort()).toEqual([
      'SUBSCRIPTION_CHARGE_DUE_SOON',
      'SUBSCRIPTION_CHARGE_OVERDUE',
    ]);
    const dueSoon = inbox.find((n) => n.type === 'SUBSCRIPTION_CHARGE_DUE_SOON');
    expect(dueSoon).toMatchObject({
      title: 'Mensalidade vence em breve',
      data: expect.objectContaining({ subscriptionId: id }),
    });
    expect(dueSoon?.body).toContain('10/11');
  });

  it('os avisos mostram o valor em aberto, não o cheio', async () => {
    const { id, user } = await active(10);
    await billing('2026-11-05');
    const [charge] = await chargesOf(t.db, id);
    await t.db.insert(paymentRecords).values({
      spaceId: space.id,
      payableType: 'SUBSCRIPTION_CHARGE',
      payableId: charge?.id ?? '',
      payerUserId: user.id,
      amountCents: 5_000,
      method: 'PIX',
      paidAt: at('2026-11-05'),
      recordedBy: user.id,
    });
    expect(await reminders('2026-11-07')).toEqual({ dueSoon: 1, overdue: 0 });
    await billing('2026-11-11');
    expect(await reminders('2026-11-11')).toEqual({ dueSoon: 0, overdue: 1 });

    const bodies = (await notificationsOf(t.db, user.id)).map((n) => n.body);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toMatch(/R\$\s100,00/);
      expect(body).not.toMatch(/150,00/);
    }
  });

  it('roda de hora em hora e processa cada espaço depois da meia-noite do fuso dele', async () => {
    // Espaço em Manaus (UTC−4), uma hora atrás de Belo Horizonte (UTC−3).
    const [existing] = await t.db.select().from(cities).where(eq(cities.name, 'Manaus'));
    const manausCity =
      existing ??
      (
        await t.db
          .insert(cities)
          .values({ name: 'Manaus', state: 'AM', timezone: 'America/Manaus' })
          .returning()
      )[0];
    const north = await createSpace(t.db, 'arena-mensalidades-manaus');
    await t.db.update(spaces).set({ cityId: manausCity?.id }).where(eq(spaces.id, north.id));
    const plan = await insertPlan(t.db, {
      spaceId: north.id,
      sportId: north.sportId,
      name: 'Plano Manaus',
      weeklyFrequency: 1,
      priceCents: 15_000,
      billingDay: 10,
    });
    const northUser = await signUp(t, `aluno-job-${studentN++}@exemplo.com`);
    const northSub = await insertSubscription(t.db, {
      userId: northUser.id,
      planId: plan.id,
      spaceId: north.id,
      status: 'ACTIVE',
      priceCents: 15_000,
      startsOn: '2026-11-01',
      approvedAt: at('2026-11-01'),
    });
    const south = await active(10);
    await billing('2026-11-05');

    const run = (iso: string) =>
      runSubscriptionsJob(SUBSCRIPTIONS_JOBS.processBilling, { charges }, new Date(iso));
    const status = async (id: string) => (await chargesOf(t.db, id))[0]?.status;

    // 00:20 em BH = 23:20 de 10/11 em Manaus: só BH vira o dia.
    expect(await run('2026-11-11T03:20:00Z')).toMatchObject({ subscriptions: 2, markedOverdue: 1 });
    expect(await status(south.id)).toBe('OVERDUE');
    expect(await status(northSub.id)).toBe('PENDING');
    // 00:20 em Manaus: só a de Manaus é processada (a de BH já passou hoje).
    expect(await run('2026-11-11T04:20:00Z')).toMatchObject({ subscriptions: 1, markedOverdue: 1 });
    expect(await status(northSub.id)).toBe('OVERDUE');
    // As rodadas seguintes do dia não fazem nada.
    expect(await run('2026-11-11T05:20:00Z')).toMatchObject({ subscriptions: 0 });
    expect(await run('2026-11-12T02:20:00Z')).toMatchObject({ subscriptions: 0 });
    // Dia seguinte em BH.
    expect(await run('2026-11-12T03:20:00Z')).toMatchObject({ subscriptions: 1 });
  });

  it('não avisa assinatura cancelada nem mensalidade paga', async () => {
    const cancelled = await active(10);
    await billing('2026-11-05');
    await t.db
      .update(subscriptions)
      .set({ status: 'CANCELLED' })
      .where(eq(subscriptions.id, cancelled.id));
    const paid = await active(10);
    await billing('2026-11-05');
    await t.db
      .update(subscriptionCharges)
      .set({ status: 'PAID' })
      .where(eq(subscriptionCharges.subscriptionId, paid.id));
    expect(await reminders('2026-11-08')).toEqual({ dueSoon: 0, overdue: 0 });
  });
});
