import { Inject, Injectable } from '@nestjs/common';
import {
  type AddEnrollmentInput,
  type ApproveSubscriptionInput,
  cancellationAccessUntil,
  chargePeriod,
  type MySubscriptionsQuery,
  type RequestSubscriptionInput,
  type StaffSubscriptionDetail,
  type Subscription,
  type SubscriptionDetail,
  type SubscriptionPage,
  type SubscriptionReasonInput,
  type SubscriptionsQuery,
  type SwapClassGroupInput,
  type UpdateMySubscriptionInput,
  weeklySlotsOverlap,
} from '@space-sports/shared';
import { and, asc, desc, eq, gt, gte, inArray, type SQL, sql } from 'drizzle-orm';
import {
  assertSpaceWritable,
  audit,
  decodeCursor,
  encodeCursor,
  isUniqueViolation,
  type Tx,
} from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  classGroups,
  classSessions,
  enrollments,
  plans,
  subscriptionCharges,
  subscriptions,
} from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { releaseUpcomingAttendances } from './attendance-core.js';
import { planNotFound } from './classes.errors.js';
import { assertNoScheduleOverlap, lockStudentSchedule } from './schedule-overlap.js';
import {
  accessEndsAt,
  dropUnbilledCharges,
  endEnrollments,
  ensureCharges,
  loadBillingContext,
  lockSubscription,
  markOverdue,
  refreshStanding,
  type SubscriptionRow,
  subscriptionSessions,
  waiveCurrentCharge,
} from './subscription-billing.js';
import { chargeRows, staffChargeRows, subscriptionRows } from './subscription-views.js';
import {
  alreadyEnrolled,
  classGroupCountMismatch,
  classGroupFull,
  classGroupNotEligible,
  classGroupsOverlap,
  enrollmentNotFound,
  invalidSubscriptionStatus,
  planFrequencyReached,
  planInactive,
  subscriptionAlreadyExists,
  subscriptionCancelRequested,
  subscriptionNotFound,
} from './subscriptions.errors.js';

type PlanRow = typeof plans.$inferSelect;
type GroupRow = typeof classGroups.$inferSelect;

/** Quem age: o aluno (no app) ou a gestão do espaço (no painel). */
type Actor = { kind: 'STUDENT'; userId: string } | { kind: 'STAFF'; userId: string };

/** Matrícula pode mudar (troca, nova turma, desmatricular) enquanto a assinatura vale. */
const ENROLLABLE = ['ACTIVE', 'PAST_DUE'] as const;
/** O cancelamento pedido vale para a assinatura em curso. */
const CANCELLABLE = ['ACTIVE', 'PAST_DUE'] as const;

const includes = (list: readonly string[], value: string) => list.includes(value);

/** O que publicar depois do commit de um cancelamento. */
type CancelOutcome = {
  /** O aluno é avisado da data em que o acesso acaba. */
  notify: boolean;
  promoted: { sessionId: string; userId: string }[];
};

/**
 * Assinaturas de planos de aula (RF-CLASS-04..06; RN-CLASS-01/02/08; decisões 12, 24, 25 e 45).
 * O aluno pede o plano escolhendo as turmas (matrículas `PENDING`, que não ocupam vaga); a
 * gestão aprova (as matrículas viram `ACTIVE` com a vaga conferida sob trava das turmas) ou
 * recusa. Cancelamento, desistência dele e troca de turma valem para o aluno e a gestão. As
 * mensalidades são geradas por `ensureCharges` (aqui na aprovação e na desistência; no dia a dia,
 * pelo job). Travas sempre na ordem assinatura → agenda do aluno → turmas ou sessões (por id) →
 * mensalidades.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Aluno

  /** RF-CLASS-04: pedido de assinatura (nasce `PENDING_APPROVAL`, preço em snapshot). */
  async request(userId: string, input: RequestSubscriptionInput): Promise<SubscriptionDetail> {
    const id = await this.db.transaction(async (tx) => {
      await lockStudentSchedule(tx, userId);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
      if (!plan) throw planNotFound();
      await assertSpaceWritable(tx, plan.spaceId);
      if (!plan.active) throw planInactive();
      const groups = await eligibleGroups(tx, plan, input.classGroupIds, false);
      // Decisão 37: nem com turma de outra assinatura (de qualquer espaço), pedido pendente inclusive.
      await assertNoScheduleOverlap(tx, userId, groups);
      // Aviso antecipado; a vaga só é garantida (com trava) na aprovação.
      for (const group of groups) await assertSpot(tx, group);
      const ctx = await loadBillingContext(tx, plan.spaceId);

      let sub: SubscriptionRow | undefined;
      try {
        // Savepoint: a violação do unique não aborta a transação externa.
        [sub] = await tx.transaction((sp) =>
          sp
            .insert(subscriptions)
            .values({
              userId,
              planId: plan.id,
              spaceId: plan.spaceId,
              status: 'PENDING_APPROVAL',
              priceCents: plan.priceCents,
              intendedPaymentMethod: input.intendedPaymentMethod ?? null,
            })
            .returning(),
        );
      } catch (err) {
        if (isUniqueViolation(err, 'subscriptions_open_user_plan_unique')) {
          throw subscriptionAlreadyExists();
        }
        throw err;
      }
      if (!sub) throw new Error('Insert de assinatura sem retorno.');
      await tx.insert(enrollments).values(
        groups.map((group) => ({
          subscriptionId: sub.id,
          classGroupId: group.id,
          status: 'PENDING' as const,
          startedOn: ctx.today,
        })),
      );
      await audit(tx, {
        actorId: userId,
        spaceId: plan.spaceId,
        action: 'subscription.request',
        entity: 'subscription',
        entityId: sub.id,
        diff: { planId: plan.id, classGroupIds: input.classGroupIds, priceCents: plan.priceCents },
      });
      return sub.id;
    });
    return this.detail(eq(subscriptions.id, id), chargeRows);
  }

  listMine(userId: string, query: MySubscriptionsQuery): Promise<Subscription[]> {
    return subscriptionRows(
      this.db,
      and(
        eq(subscriptions.userId, userId),
        query.status?.length ? inArray(subscriptions.status, query.status) : undefined,
      ),
    );
  }

  getMine(userId: string, id: string): Promise<SubscriptionDetail> {
    return this.detail(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)), chargeRows);
  }

  /** RF-CLASS-06: forma de pagamento preferida (informativa, RF-PAY-02). */
  async updateMine(
    userId: string,
    id: string,
    input: UpdateMySubscriptionInput,
  ): Promise<SubscriptionDetail> {
    await this.db.transaction(async (tx) => {
      const sub = await this.lockMine(tx, userId, id);
      if (sub.status === 'CANCELLED') throw invalidSubscriptionStatus(sub.status);
      await tx
        .update(subscriptions)
        .set({ intendedPaymentMethod: input.intendedPaymentMethod })
        .where(eq(subscriptions.id, sub.id));
    });
    return this.getMine(userId, id);
  }

  async cancelMine(userId: string, id: string, input: SubscriptionReasonInput) {
    const outcome = await this.db.transaction(async (tx) =>
      this.cancel(tx, await this.lockMine(tx, userId, id), { kind: 'STUDENT', userId }, input),
    );
    await this.publishCancel(id, outcome);
    return this.getMine(userId, id);
  }

  resumeCancelMine(userId: string, id: string) {
    return this.mutateMine(userId, id, (tx, sub) =>
      this.resumeCancel(tx, sub, { kind: 'STUDENT', userId }),
    );
  }

  swapMine(userId: string, id: string, input: SwapClassGroupInput) {
    return this.mutateMine(userId, id, (tx, sub) =>
      this.swap(tx, sub, { kind: 'STUDENT', userId }, input),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Gestão

  async listForSpace(spaceId: string, query: SubscriptionsQuery): Promise<SubscriptionPage> {
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const items = await subscriptionRows(
      this.db,
      and(
        eq(subscriptions.spaceId, spaceId),
        query.status?.length ? inArray(subscriptions.status, query.status) : undefined,
        query.planId ? eq(subscriptions.planId, query.planId) : undefined,
        query.userId ? eq(subscriptions.userId, query.userId) : undefined,
        query.classGroupId
          ? sql`EXISTS (SELECT 1 FROM ${enrollments} WHERE ${enrollments.subscriptionId} = ${subscriptions.id} AND ${enrollments.classGroupId} = ${query.classGroupId} AND ${enrollments.status} IN ('PENDING', 'ACTIVE'))`
          : undefined,
        after
          ? sql`(${subscriptions.createdAt}, ${subscriptions.id}) < (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
      { limit: query.limit + 1 },
    );
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        hasMore && last ? encodeCursor({ startsAt: new Date(last.createdAt), id: last.id }) : null,
    };
  }

  getForSpace(spaceId: string, id: string): Promise<StaffSubscriptionDetail> {
    return this.detail(
      and(eq(subscriptions.id, id), eq(subscriptions.spaceId, spaceId)),
      staffChargeRows,
    );
  }

  /**
   * RF-CLASS-05: aprova o pedido. `classGroupIds` substitui as turmas pedidas. Trava as turmas e
   * confere a vaga de cada uma (RN-CLASS-02): duas aprovações na última vaga não passam juntas.
   */
  async approve(
    spaceId: string,
    actorId: string,
    id: string,
    input: ApproveSubscriptionInput,
  ): Promise<StaffSubscriptionDetail> {
    await this.db.transaction(async (tx) => {
      const sub = await this.lockInSpace(tx, spaceId, id);
      if (sub.status !== 'PENDING_APPROVAL') throw invalidSubscriptionStatus(sub.status);
      await lockStudentSchedule(tx, sub.userId);
      const plan = await loadPlan(tx, sub.planId);
      const requested =
        input.classGroupIds ??
        (
          await tx
            .select({ id: enrollments.classGroupId })
            .from(enrollments)
            .where(and(eq(enrollments.subscriptionId, sub.id), eq(enrollments.status, 'PENDING')))
        ).map((row) => row.id);
      const groups = await eligibleGroups(tx, plan, requested, true);
      await assertNoScheduleOverlap(tx, sub.userId, groups, sub.id);
      for (const group of groups) await assertSpot(tx, group);
      const ctx = await loadBillingContext(tx, spaceId);

      await tx
        .delete(enrollments)
        .where(and(eq(enrollments.subscriptionId, sub.id), eq(enrollments.status, 'PENDING')));
      await tx.insert(enrollments).values(
        groups.map((group) => ({
          subscriptionId: sub.id,
          classGroupId: group.id,
          status: 'ACTIVE' as const,
          startedOn: ctx.today,
        })),
      );
      const period = chargePeriod(ctx.today, plan.billingDay);
      const [approved] = await tx
        .update(subscriptions)
        .set({
          status: 'ACTIVE',
          startsOn: ctx.today,
          currentPeriodStart: ctx.today,
          currentPeriodEnd: period.periodEnd,
          approvedAt: new Date(),
          approvedBy: actorId,
        })
        .where(eq(subscriptions.id, sub.id))
        .returning();
      if (!approved) throw subscriptionNotFound();
      const charges = await ensureCharges(tx, approved, plan.billingDay, ctx);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'subscription.approve',
        entity: 'subscription',
        entityId: sub.id,
        diff: { classGroupIds: groups.map((group) => group.id), chargesCreated: charges },
      });
    });
    await this.events.publish({ type: 'subscription.approved', subscriptionId: id });
    return this.getForSpace(spaceId, id);
  }

  /** RF-CLASS-05: recusa o pedido (`CANCELLED` com `rejected`); as turmas pedidas são liberadas. */
  async reject(
    spaceId: string,
    actorId: string,
    id: string,
    input: SubscriptionReasonInput,
  ): Promise<StaffSubscriptionDetail> {
    await this.db.transaction(async (tx) => {
      const sub = await this.lockInSpace(tx, spaceId, id);
      if (sub.status !== 'PENDING_APPROVAL') throw invalidSubscriptionStatus(sub.status);
      await tx
        .delete(enrollments)
        .where(and(eq(enrollments.subscriptionId, sub.id), eq(enrollments.status, 'PENDING')));
      const now = new Date();
      await tx
        .update(subscriptions)
        .set({
          status: 'CANCELLED',
          rejectedAt: now,
          cancelledAt: now,
          cancelledBy: actorId,
          statusReason: input.reason ?? null,
        })
        .where(eq(subscriptions.id, sub.id));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'subscription.reject',
        entity: 'subscription',
        entityId: sub.id,
        diff: { reason: input.reason ?? null },
      });
    });
    await this.events.publish({ type: 'subscription.rejected', subscriptionId: id });
    return this.getForSpace(spaceId, id);
  }

  async cancelForSpace(
    spaceId: string,
    actorId: string,
    id: string,
    input: SubscriptionReasonInput,
  ) {
    const outcome = await this.db.transaction(async (tx) =>
      this.cancel(
        tx,
        await this.lockInSpace(tx, spaceId, id),
        { kind: 'STAFF', userId: actorId },
        input,
      ),
    );
    await this.publishCancel(id, outcome);
    return this.getForSpace(spaceId, id);
  }

  async resumeCancelForSpace(spaceId: string, actorId: string, id: string) {
    const detail = await this.mutateInSpace(spaceId, id, (tx, sub) =>
      this.resumeCancel(tx, sub, { kind: 'STAFF', userId: actorId }),
    );
    await this.events.publish({ type: 'subscription.cancel_resumed', subscriptionId: id });
    return detail;
  }

  swapForSpace(spaceId: string, actorId: string, id: string, input: SwapClassGroupInput) {
    return this.mutateInSpace(spaceId, id, (tx, sub) =>
      this.swap(tx, sub, { kind: 'STAFF', userId: actorId }, input),
    );
  }

  /** RF-CLASS-05: matricula em mais uma turma (plano Nx/semana: até N turmas, RN-CLASS-01). */
  addEnrollment(spaceId: string, actorId: string, id: string, input: AddEnrollmentInput) {
    return this.mutateInSpace(spaceId, id, async (tx, sub) => {
      if (!includes(ENROLLABLE, sub.status)) throw invalidSubscriptionStatus(sub.status);
      await lockStudentSchedule(tx, sub.userId);
      const plan = await loadPlan(tx, sub.planId);
      const active = await activeEnrollments(tx, sub.id);
      if (plan.weeklyFrequency !== null && active.length >= plan.weeklyFrequency) {
        throw planFrequencyReached(plan.weeklyFrequency);
      }
      if (active.some((e) => e.classGroupId === input.classGroupId)) {
        throw alreadyEnrolled(input.classGroupId);
      }
      const [group] = await eligibleGroups(tx, plan, [input.classGroupId], true, false);
      if (!group) throw classGroupNotEligible(input.classGroupId);
      assertNoOverlap([
        ...(await groupsById(
          tx,
          active.map((e) => e.classGroupId),
        )),
        group,
      ]);
      await assertNoScheduleOverlap(tx, sub.userId, [group], sub.id);
      await assertSpot(tx, group);
      const ctx = await loadBillingContext(tx, sub.spaceId);
      await tx.insert(enrollments).values({
        subscriptionId: sub.id,
        classGroupId: group.id,
        status: 'ACTIVE',
        startedOn: ctx.today,
      });
      await audit(tx, {
        actorId,
        spaceId,
        action: 'enrollment.create',
        entity: 'subscription',
        entityId: sub.id,
        diff: { classGroupId: group.id },
      });
    });
  }

  /** RF-CLASS-05: desmatricula da turma (a assinatura continua; a vaga é liberada). */
  endEnrollment(spaceId: string, actorId: string, id: string, enrollmentId: string) {
    return this.mutateInSpace(spaceId, id, async (tx, sub) => {
      const [enrollment] = await tx
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.id, enrollmentId),
            eq(enrollments.subscriptionId, sub.id),
            eq(enrollments.status, 'ACTIVE'),
          ),
        )
        .for('update');
      if (!enrollment) throw enrollmentNotFound();
      const ctx = await loadBillingContext(tx, sub.spaceId);
      await tx
        .update(enrollments)
        .set({ status: 'ENDED', endedOn: ctx.today })
        .where(eq(enrollments.id, enrollment.id));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'enrollment.end',
        entity: 'subscription',
        entityId: sub.id,
        diff: { enrollmentId, classGroupId: enrollment.classGroupId },
      });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Transições (aluno e gestão)

  /**
   * RN-CLASS-08 (decisão 45). Pendente: retira o pedido na hora. Em curso, o acesso vai até o fim
   * do último mês com mensalidade paga ou dispensada, se esse mês é o corrente ou um futuro
   * (`keepUntil`); sem mês coberto, termina no ato (`endNow`). Repetir não muda nada.
   */
  private async cancel(
    tx: Tx,
    sub: SubscriptionRow,
    actor: Actor,
    input: SubscriptionReasonInput,
  ): Promise<CancelOutcome> {
    if (sub.status === 'PENDING_APPROVAL') return this.withdraw(tx, sub, actor, input);
    if (!includes(CANCELLABLE, sub.status)) throw invalidSubscriptionStatus(sub.status);
    if (sub.cancelAtPeriodEnd) return { notify: false, promoted: [] };
    // Serializa com a confirmação de presença: ela enxerga o fim do acesso ou cai na limpeza.
    await lockStudentSchedule(tx, sub.userId);
    const ctx = await loadBillingContext(tx, sub.spaceId);
    const charges = await tx
      .select({ periodEnd: subscriptionCharges.periodEnd, status: subscriptionCharges.status })
      .from(subscriptionCharges)
      .where(eq(subscriptionCharges.subscriptionId, sub.id));
    const paidUntil = cancellationAccessUntil(charges, ctx.today);
    const now = new Date();
    const groupSessions = subscriptionSessions(sub);
    const effect = paidUntil
      ? await keepUntil(tx, sub, paidUntil, ctx.timeZone, groupSessions, now)
      : await endNow(tx, sub, actor, ctx.today, groupSessions, now);
    await tx
      .update(subscriptions)
      .set({
        ...(paidUntil
          ? { cancelAtPeriodEnd: true }
          : { status: 'CANCELLED' as const, cancelledAt: now }),
        endsOn: paidUntil ?? ctx.today,
        cancelRequestedAt: now,
        cancelledBy: actor.userId,
        statusReason: input.reason ?? null,
      })
      .where(eq(subscriptions.id, sub.id));
    await audit(tx, {
      actorId: actor.userId,
      spaceId: sub.spaceId,
      action: 'subscription.cancel',
      entity: 'subscription',
      entityId: sub.id,
      diff: {
        by: actor.kind,
        from: sub.status,
        reason: input.reason ?? null,
        endsOn: paidUntil ?? ctx.today,
        immediate: paidUntil === null,
        waived: effect.waived,
        dropped: effect.dropped,
        attendancesReleased: effect.released,
      },
    });
    return { notify: true, promoted: effect.promoted };
  }

  /** Pedido ainda pendente: nunca deu acesso, então não há data a avisar. */
  private async withdraw(
    tx: Tx,
    sub: SubscriptionRow,
    actor: Actor,
    input: SubscriptionReasonInput,
  ): Promise<CancelOutcome> {
    await tx
      .delete(enrollments)
      .where(and(eq(enrollments.subscriptionId, sub.id), eq(enrollments.status, 'PENDING')));
    await tx
      .update(subscriptions)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: actor.userId,
        statusReason: input.reason ?? null,
      })
      .where(eq(subscriptions.id, sub.id));
    await audit(tx, {
      actorId: actor.userId,
      spaceId: sub.spaceId,
      action: 'subscription.cancel',
      entity: 'subscription',
      entityId: sub.id,
      diff: { by: actor.kind, from: sub.status, reason: input.reason ?? null },
    });
    return { notify: false, promoted: [] };
  }

  /**
   * RN-CLASS-08: desiste do cancelamento enquanto `ends_on` não passou (o cancelamento imediato já
   * encerrou a assinatura). Volta ao ciclo normal: a mensalidade seguinte volta a ser gerada e o
   * atraso é reavaliado. As aulas de que o aluno saiu ao cancelar não voltam: ele confirma de novo.
   */
  private async resumeCancel(tx: Tx, sub: SubscriptionRow, actor: Actor): Promise<void> {
    const ctx = await loadBillingContext(tx, sub.spaceId);
    if (
      !includes(CANCELLABLE, sub.status) ||
      !sub.cancelAtPeriodEnd ||
      !sub.endsOn ||
      sub.endsOn < ctx.today
    ) {
      throw invalidSubscriptionStatus(sub.status);
    }
    const [resumed] = await tx
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: false,
        endsOn: null,
        cancelRequestedAt: null,
        cancelledBy: null,
        statusReason: null,
      })
      .where(eq(subscriptions.id, sub.id))
      .returning();
    if (!resumed) throw subscriptionNotFound();
    const plan = await loadPlan(tx, sub.planId);
    const chargesCreated = await ensureCharges(tx, resumed, plan.billingDay, ctx);
    await refreshStanding(tx, resumed, ctx);
    await audit(tx, {
      actorId: actor.userId,
      spaceId: sub.spaceId,
      action: 'subscription.resume_cancel',
      entity: 'subscription',
      entityId: sub.id,
      diff: { by: actor.kind, endsOn: sub.endsOn, chargesCreated },
    });
  }

  /** Troca de turma: encerra hoje a matrícula da turma de origem e abre na de destino (com vaga). */
  private async swap(
    tx: Tx,
    sub: SubscriptionRow,
    actor: Actor,
    input: SwapClassGroupInput,
  ): Promise<void> {
    if (!includes(ENROLLABLE, sub.status)) throw invalidSubscriptionStatus(sub.status);
    if (actor.kind === 'STUDENT' && sub.cancelAtPeriodEnd) {
      throw subscriptionCancelRequested(sub.endsOn);
    }
    await lockStudentSchedule(tx, sub.userId);
    const active = await activeEnrollments(tx, sub.id);
    const from = active.find((e) => e.classGroupId === input.fromClassGroupId);
    if (!from) throw enrollmentNotFound();
    if (active.some((e) => e.classGroupId === input.toClassGroupId)) {
      throw alreadyEnrolled(input.toClassGroupId);
    }
    const plan = await loadPlan(tx, sub.planId);
    const [target] = await eligibleGroups(tx, plan, [input.toClassGroupId], true, false);
    if (!target) throw classGroupNotEligible(input.toClassGroupId);
    const others = active.filter((e) => e.id !== from.id).map((e) => e.classGroupId);
    assertNoOverlap([...(await groupsById(tx, others)), target]);
    await assertNoScheduleOverlap(tx, sub.userId, [target], sub.id);
    await assertSpot(tx, target);

    const ctx = await loadBillingContext(tx, sub.spaceId);
    await tx
      .update(enrollments)
      .set({ status: 'ENDED', endedOn: ctx.today })
      .where(eq(enrollments.id, from.id));
    await tx.insert(enrollments).values({
      subscriptionId: sub.id,
      classGroupId: target.id,
      status: 'ACTIVE',
      startedOn: ctx.today,
    });
    await audit(tx, {
      actorId: actor.userId,
      spaceId: sub.spaceId,
      action: 'subscription.swap_class_group',
      entity: 'subscription',
      entityId: sub.id,
      diff: { by: actor.kind, from: input.fromClassGroupId, to: input.toClassGroupId },
    });
  }

  // -------------------------------------------------------------------------------------------

  private async publishCancel(subscriptionId: string, outcome: CancelOutcome): Promise<void> {
    if (outcome.notify)
      await this.events.publish({ type: 'subscription.cancelled', subscriptionId });
    for (const { sessionId, userId } of outcome.promoted) {
      await this.events.publish({ type: 'class_attendance.promoted', sessionId, userId });
    }
  }

  private async detail<Charge>(
    where: SQL | undefined,
    charges: (db: Database, subscriptionId: string) => Promise<Charge[]>,
  ): Promise<Subscription & { charges: Charge[] }> {
    const [sub] = await subscriptionRows(this.db, where, { limit: 1 });
    if (!sub) throw subscriptionNotFound();
    return { ...sub, charges: await charges(this.db, sub.id) };
  }

  private async lockMine(tx: Tx, userId: string, id: string): Promise<SubscriptionRow> {
    const sub = await lockSubscription(
      tx,
      and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)),
    );
    if (!sub) throw subscriptionNotFound();
    await assertSpaceWritable(tx, sub.spaceId);
    return sub;
  }

  private async lockInSpace(tx: Tx, spaceId: string, id: string): Promise<SubscriptionRow> {
    const sub = await lockSubscription(
      tx,
      and(eq(subscriptions.id, id), eq(subscriptions.spaceId, spaceId)),
    );
    if (!sub) throw subscriptionNotFound();
    return sub;
  }

  private async mutateMine(
    userId: string,
    id: string,
    action: (tx: Tx, sub: SubscriptionRow) => Promise<void>,
  ): Promise<SubscriptionDetail> {
    await this.db.transaction(async (tx) => action(tx, await this.lockMine(tx, userId, id)));
    return this.getMine(userId, id);
  }

  private async mutateInSpace(
    spaceId: string,
    id: string,
    action: (tx: Tx, sub: SubscriptionRow) => Promise<void>,
  ): Promise<StaffSubscriptionDetail> {
    await this.db.transaction(async (tx) => action(tx, await this.lockInSpace(tx, spaceId, id)));
    return this.getForSpace(spaceId, id);
  }
}

type CancelEffect = {
  waived: string[];
  dropped: string[];
  released: number;
  promoted: { sessionId: string; userId: string }[];
};

/**
 * A assinatura segue em curso até `endsOn`, com a vaga nas turmas: só sai das aulas depois dessa
 * data e os ciclos seguintes deixam de existir. O job encerra quando a data passar.
 */
async function keepUntil(
  tx: Tx,
  sub: SubscriptionRow,
  endsOn: string,
  timeZone: string,
  groupSessions: SQL,
  now: Date,
): Promise<CancelEffect> {
  const dropped = await dropUnbilledCharges(
    tx,
    sub.id,
    gt(subscriptionCharges.periodStart, endsOn),
  );
  const list = await releaseUpcomingAttendances(
    tx,
    sub.userId,
    now,
    and(groupSessions, gte(classSessions.startsAt, accessEndsAt(endsOn, timeZone))),
  );
  return { waived: [], dropped, ...list };
}

/**
 * Sem mês coberto: sai de todas as aulas que ainda não começaram e as matrículas acabam hoje. A
 * mensalidade corrente não vencida é dispensada; a vencida segue devida e aparece para a gestão.
 */
async function endNow(
  tx: Tx,
  sub: SubscriptionRow,
  actor: Actor,
  today: string,
  groupSessions: SQL,
  now: Date,
): Promise<CancelEffect> {
  const list = await releaseUpcomingAttendances(tx, sub.userId, now, groupSessions);
  await endEnrollments(tx, sub.id, today);
  await markOverdue(tx, sub.id, today);
  const waived = await waiveCurrentCharge(tx, sub.id, today, actor.userId);
  const dropped = await dropUnbilledCharges(tx, sub.id, gt(subscriptionCharges.periodStart, today));
  return { waived, dropped, ...list };
}

async function loadPlan(tx: Tx, planId: string): Promise<PlanRow> {
  const [plan] = await tx.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw planNotFound();
  return plan;
}

/**
 * Turmas válidas para o plano (RN-CLASS-01): do espaço do plano, ativas e do esporte do plano;
 * plano Nx/semana exige exatamente N (`exact`), e as turmas não podem coincidir no horário.
 * Com `lock`, trava as linhas das turmas em ordem de id (a contagem de vagas fica serializada
 * com outras aprovações, trocas e com a edição da capacidade da turma).
 */
async function eligibleGroups(
  tx: Tx,
  plan: PlanRow,
  ids: string[],
  lock: boolean,
  exact = true,
): Promise<GroupRow[]> {
  const unique = [...new Set(ids)];
  const query = tx
    .select()
    .from(classGroups)
    .where(and(inArray(classGroups.id, unique), eq(classGroups.spaceId, plan.spaceId)))
    .orderBy(asc(classGroups.id));
  const rows = lock ? await query.for('update') : await query;
  for (const id of unique) {
    const group = rows.find((row) => row.id === id);
    if (!group?.active || group.sportId !== plan.sportId) throw classGroupNotEligible(id);
  }
  if (exact && plan.weeklyFrequency !== null && unique.length !== plan.weeklyFrequency) {
    throw classGroupCountMismatch(plan.weeklyFrequency, unique.length);
  }
  assertNoOverlap(rows);
  return rows;
}

function assertNoOverlap(groups: GroupRow[]): void {
  for (const [i, a] of groups.entries()) {
    for (const b of groups.slice(i + 1)) {
      if (weeklySlotsOverlap(a, b)) throw classGroupsOverlap([a.id, b.id]);
    }
  }
}

/** RN-CLASS-02: matrículas ativas < capacidade. Com a turma travada, a contagem é definitiva. */
async function assertSpot(tx: Tx, group: GroupRow): Promise<void> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(eq(enrollments.classGroupId, group.id), eq(enrollments.status, 'ACTIVE')));
  if ((row?.count ?? 0) >= group.capacity) throw classGroupFull(group.id);
}

function activeEnrollments(tx: Tx, subscriptionId: string) {
  return tx
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.subscriptionId, subscriptionId), eq(enrollments.status, 'ACTIVE')))
    .orderBy(desc(enrollments.startedOn));
}

async function groupsById(tx: Tx, ids: string[]): Promise<GroupRow[]> {
  if (!ids.length) return [];
  return tx.select().from(classGroups).where(inArray(classGroups.id, ids));
}
