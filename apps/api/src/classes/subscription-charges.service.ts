import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  CHARGE_DUE_SOON_DAYS,
  DEFAULT_TIME_ZONE,
  type DelinquentsResponse,
  daysBetween,
  type SpaceSubscriptionChargePage,
  type StaffSubscriptionCharge,
  type SubscriptionCharge,
  type SubscriptionChargesQuery,
  type SubscriptionReasonInput,
  utcToZoned,
} from '@space-sports/shared';
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { audit, decodeCursor, encodeCursor, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  attendances,
  cities,
  classSessions,
  paymentRecords,
  plans,
  spaces,
  subscriptionCharges,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { releaseUpcomingAttendances } from './attendance-core.js';
import {
  accessEndsAt,
  afterChargeChange,
  BILLED_STATUSES,
  chargePaidSql,
  endEnrollments,
  ensureCharges,
  loadBillingContext,
  lockCharge,
  lockSubscription,
  markOverdue,
  refreshStanding,
  subscriptionSessions,
} from './subscription-billing.js';
import { chargeRows, spaceChargeRows, staffChargeRows } from './subscription-views.js';
import {
  chargeHasPayments,
  chargeNotWaivable,
  subscriptionChargeNotFound,
  subscriptionNotFound,
} from './subscriptions.errors.js';

export interface BillingRunSummary {
  /** Assinaturas processadas. */
  subscriptions: number;
  /** Cancelamentos que chegaram ao último dia. */
  cancelled: number;
  chargesCreated: number;
  markedOverdue: number;
  /** Assinaturas que passaram a `PAST_DUE` / voltaram a `ACTIVE`. */
  becamePastDue: number;
  restored: number;
  /** Assinaturas cujo processamento falhou (o job falha no fim e o BullMQ tenta de novo). */
  failures: number;
}

export interface ReminderRunSummary {
  dueSoon: number;
  overdue: number;
}

/** Mensalidades reservadas por rodada de lembretes; o resto fica para a próxima. */
const REMINDER_BATCH = 500;

const student = alias(users, 'student');

/**
 * Mensalidades das aulas (RF-CLASS-11; RN-CLASS-06/08; decisões 25 e 45). O job (de hora em hora,
 * uma vez por dia local para cada assinatura), por assinatura e na própria transação: encerra os
 * cancelamentos cujo último dia passou, gera a mensalidade do mês (sem pró-rata), marca as
 * vencidas como `OVERDUE` e aplica a regra de atraso. Rodar de novo não duplica nada. Os lembretes
 * (próxima do vencimento, vencida) são reservados por coluna, então saem uma vez só.
 */
@Injectable()
export class SubscriptionChargesService {
  private readonly logger = new Logger(SubscriptionChargesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Roda de hora em hora: cada assinatura entra na primeira rodada depois da meia-noite do fuso
   * do espaço (`billing_processed_on` anterior ao dia local) e fica marcada até o dia seguinte.
   * Falhou, não marca: a próxima tentativa ou rodada a pega de novo.
   */
  async processBilling(now: Date = new Date()): Promise<BillingRunSummary> {
    const localToday = sql`(${now.toISOString()}::timestamptz AT TIME ZONE coalesce(nullif(${cities.timezone}, ''), ${DEFAULT_TIME_ZONE}))::date`;
    const rows = await this.db
      .select({ id: subscriptions.id, spaceId: subscriptions.spaceId })
      .from(subscriptions)
      .innerJoin(spaces, eq(spaces.id, subscriptions.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(
        and(
          inArray(subscriptions.status, [...BILLED_STATUSES]),
          eq(spaces.status, 'ACTIVE'),
          or(
            isNull(subscriptions.billingProcessedOn),
            lt(subscriptions.billingProcessedOn, localToday),
          ),
        ),
      )
      .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id));

    const summary: BillingRunSummary = {
      subscriptions: rows.length,
      cancelled: 0,
      chargesCreated: 0,
      markedOverdue: 0,
      becamePastDue: 0,
      restored: 0,
      failures: 0,
    };
    for (const { id, spaceId } of rows) {
      try {
        const promoted = await this.db.transaction((tx) =>
          this.processOne(tx, id, spaceId, now, summary),
        );
        for (const { sessionId, userId } of promoted) {
          await this.events.publish({ type: 'class_attendance.promoted', sessionId, userId });
        }
      } catch (err) {
        summary.failures++;
        this.logger.error({ err, subscriptionId: id }, 'Falha ao processar a assinatura');
      }
    }
    return summary;
  }

  /** Devolve quem saiu da espera, para avisar depois do commit. */
  private async processOne(
    tx: Tx,
    id: string,
    spaceId: string,
    now: Date,
    summary: BillingRunSummary,
  ): Promise<{ sessionId: string; userId: string }[]> {
    const sub = await lockSubscription(tx, eq(subscriptions.id, id));
    // Mudou desde a consulta (cancelada, por exemplo): nada a fazer.
    if (!sub || !(BILLED_STATUSES as readonly string[]).includes(sub.status)) return [];
    const ctx = await loadBillingContext(tx, spaceId, now);
    // Outra rodada já passou por ela hoje (no fuso do espaço).
    if (sub.billingProcessedOn && sub.billingProcessedOn >= ctx.today) return [];
    await tx
      .update(subscriptions)
      .set({ billingProcessedOn: ctx.today })
      .where(eq(subscriptions.id, sub.id));

    // RN-CLASS-08: o último dia de serviço passou.
    if (sub.cancelAtPeriodEnd && sub.endsOn && sub.endsOn < ctx.today) {
      // Pedido antes da regra atual ou sobra: a inclusão pela gestão fica, vale sem assinatura.
      const { promoted } = await releaseUpcomingAttendances(
        tx,
        sub.userId,
        now,
        and(
          subscriptionSessions(sub),
          gte(classSessions.startsAt, accessEndsAt(sub.endsOn, ctx.timeZone)),
          eq(attendances.addedByStaff, false),
        ),
      );
      await tx
        .update(subscriptions)
        .set({ status: 'CANCELLED', cancelledAt: now })
        .where(eq(subscriptions.id, sub.id));
      await endEnrollments(tx, sub.id, sub.endsOn);
      await markOverdue(tx, sub.id, ctx.today);
      summary.cancelled++;
      return promoted;
    }

    const [plan] = await tx
      .select({ billingDay: plans.billingDay })
      .from(plans)
      .where(eq(plans.id, sub.planId));
    if (plan) summary.chargesCreated += await ensureCharges(tx, sub, plan.billingDay, ctx);
    summary.markedOverdue += await markOverdue(tx, sub.id, ctx.today);
    const status = await refreshStanding(tx, sub, ctx);
    if (status !== sub.status) {
      if (status === 'PAST_DUE') summary.becamePastDue++;
      else summary.restored++;
    }
    return [];
  }

  /**
   * Lembretes (RF-NOTIF-01): mensalidade em aberto que vence nos próximos 3 dias e mensalidade
   * vencida. Cada uma é reservada com um UPDATE atômico (`FOR UPDATE SKIP LOCKED`) na coluna do
   * aviso, então repetir ou rodar em paralelo nunca avisa duas vezes.
   */
  async sendReminders(now: Date = new Date()): Promise<ReminderRunSummary> {
    // O fuso é por cidade: a janela em UTC tem um dia de folga e o corte exato é feito em JS.
    const utcToday = now.toISOString().slice(0, 10);
    const candidates = await this.db
      .select({
        id: subscriptionCharges.id,
        dueDate: subscriptionCharges.dueDate,
        timeZone: cities.timezone,
      })
      .from(subscriptionCharges)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .innerJoin(spaces, eq(spaces.id, subscriptions.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(
        and(
          eq(subscriptionCharges.status, 'PENDING'),
          isNull(subscriptionCharges.dueReminderSentAt),
          sql`${subscriptionCharges.amountCents} > 0`,
          inArray(subscriptions.status, [...BILLED_STATUSES]),
          eq(spaces.status, 'ACTIVE'),
          gte(subscriptionCharges.dueDate, addDays(utcToday, -1)),
          lte(subscriptionCharges.dueDate, addDays(utcToday, CHARGE_DUE_SOON_DAYS + 1)),
        ),
      )
      .limit(REMINDER_BATCH);
    const dueSoonIds = candidates
      .filter((charge) => {
        const today = utcToZoned(now, charge.timeZone).date;
        return charge.dueDate >= today && charge.dueDate <= addDays(today, CHARGE_DUE_SOON_DAYS);
      })
      .map((charge) => charge.id);
    const dueSoon = dueSoonIds.length
      ? await this.claim(
          'DUE_SOON',
          and(
            inArray(subscriptionCharges.id, dueSoonIds),
            eq(subscriptionCharges.status, 'PENDING'),
          ),
          now,
        )
      : [];

    const overdue = await this.claim(
      'OVERDUE',
      and(
        eq(subscriptionCharges.status, 'OVERDUE'),
        // Qualificado à mão: a subconsulta do `claim` é de uma tabela só (ver subscription-billing).
        sql.raw(
          `EXISTS (SELECT 1 FROM subscriptions s JOIN spaces sp ON sp.id = s.space_id WHERE s.id = "subscription_charges"."subscription_id" AND s.status IN ('ACTIVE', 'PAST_DUE') AND sp.status = 'ACTIVE')`,
        ),
      ),
      now,
    );

    for (const chargeId of dueSoon) {
      await this.events.publish({ type: 'subscription_charge.due_soon', chargeId });
    }
    for (const chargeId of overdue) {
      await this.events.publish({ type: 'subscription_charge.overdue', chargeId });
    }
    return { dueSoon: dueSoon.length, overdue: overdue.length };
  }

  /** Marca a coluna do aviso nas mensalidades ainda sem aviso e devolve as reservadas. */
  private async claim(
    notice: 'DUE_SOON' | 'OVERDUE',
    where: SQL | undefined,
    now: Date,
  ): Promise<string[]> {
    const column =
      notice === 'DUE_SOON'
        ? subscriptionCharges.dueReminderSentAt
        : subscriptionCharges.overdueNotifiedAt;
    const claimed = await this.db
      .update(subscriptionCharges)
      .set(notice === 'DUE_SOON' ? { dueReminderSentAt: now } : { overdueNotifiedAt: now })
      .where(
        inArray(
          subscriptionCharges.id,
          this.db
            .select({ id: subscriptionCharges.id })
            .from(subscriptionCharges)
            .where(and(where, isNull(column)))
            .orderBy(asc(subscriptionCharges.dueDate))
            .limit(REMINDER_BATCH)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning({ id: subscriptionCharges.id });
    return claimed.map((row) => row.id);
  }

  // -------------------------------------------------------------------------------------------
  // Leituras

  /** Mensalidades de uma assinatura do aluno (RF-CLASS-06). */
  async listMine(userId: string, subscriptionId: string): Promise<SubscriptionCharge[]> {
    const [sub] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)));
    if (!sub) throw subscriptionNotFound();
    return chargeRows(this.db, sub.id);
  }

  /** RF-CLASS-11: mensalidades do espaço (a receber, vencidas, pagas…), por vencimento. */
  async listForSpace(
    spaceId: string,
    query: SubscriptionChargesQuery,
  ): Promise<SpaceSubscriptionChargePage> {
    const { today } = await loadBillingContext(this.db, spaceId);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const filters = and(
      eq(subscriptions.spaceId, spaceId),
      query.status?.length ? inArray(subscriptionCharges.status, query.status) : undefined,
      query.subscriptionId
        ? eq(subscriptionCharges.subscriptionId, query.subscriptionId)
        : undefined,
      query.userId ? eq(subscriptions.userId, query.userId) : undefined,
      query.dueFrom ? gte(subscriptionCharges.dueDate, query.dueFrom) : undefined,
      query.dueTo ? lte(subscriptionCharges.dueDate, query.dueTo) : undefined,
      // Vencida = em aberto e com vencimento passado, mesmo que o job ainda não tenha marcado.
      query.overdue
        ? and(
            inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
            lt(subscriptionCharges.dueDate, today),
          )
        : undefined,
    );
    const keyset = after
      ? sql`(${subscriptionCharges.dueDate}, ${subscriptionCharges.id}) > (${after.startsAt.toISOString().slice(0, 10)}::date, ${after.id}::uuid)`
      : undefined;
    const [items, [total]] = await Promise.all([
      spaceChargeRows(
        this.db,
        and(filters, keyset),
        [asc(subscriptionCharges.dueDate), asc(subscriptionCharges.id)],
        query.limit + 1,
      ),
      this.db
        .select({
          cents: sql<string>`coalesce(sum(greatest(${subscriptionCharges.amountCents} - ${subscriptionCharges.discountCents} - ${chargePaidSql}, 0)), 0)::bigint`,
        })
        .from(subscriptionCharges)
        .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
        .where(and(filters, inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']))),
    ]);
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ startsAt: new Date(`${last.dueDate}T00:00:00Z`), id: last.id })
          : null,
      totalDueCents: Number(total?.cents ?? 0),
    };
  }

  /** RF-CLASS-11: inadimplentes, por assinatura, do atraso mais antigo para o mais novo. */
  async delinquents(spaceId: string): Promise<DelinquentsResponse> {
    const { today } = await loadBillingContext(this.db, spaceId);
    const due = sql<number>`greatest(${subscriptionCharges.amountCents} - ${subscriptionCharges.discountCents} - ${chargePaidSql}, 0)`;
    const oldest = sql<string>`min(${subscriptionCharges.dueDate})`;
    const rows = await this.db
      .select({
        subscriptionId: subscriptions.id,
        subscriptionStatus: subscriptions.status,
        userId: subscriptions.userId,
        studentName: student.name,
        studentAvatarUrl: student.avatarUrl,
        planId: plans.id,
        planName: plans.name,
        overdueCount: sql<number>`count(*)::int`,
        overdueCents: sql<string>`sum(${due})::bigint`,
        oldestDueDate: oldest,
      })
      .from(subscriptionCharges)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(student, eq(student.id, subscriptions.userId))
      .where(
        and(
          eq(subscriptions.spaceId, spaceId),
          inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
          lt(subscriptionCharges.dueDate, today),
        ),
      )
      .groupBy(subscriptions.id, student.id, plans.id)
      .orderBy(asc(oldest), asc(subscriptions.id));
    const items = rows
      .map((row) => ({
        subscriptionId: row.subscriptionId,
        subscriptionStatus: row.subscriptionStatus,
        student: { userId: row.userId, name: row.studentName, avatarUrl: row.studentAvatarUrl },
        plan: { id: row.planId, name: row.planName },
        overdueCount: row.overdueCount,
        overdueCents: Number(row.overdueCents),
        oldestDueDate: row.oldestDueDate,
        daysOverdue: daysBetween(row.oldestDueDate, today),
      }))
      .filter((row) => row.overdueCents > 0);
    return {
      date: today,
      totalOverdueCents: items.reduce((sum, row) => sum + row.overdueCents, 0),
      items,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Dispensa

  /**
   * Dispensa a mensalidade em aberto (`WAIVED`, Dono/Admin): deixa de ser cobrada e não aceita
   * pagamento; a regra de atraso é reavaliada. Paga ou com pagamento não estornado → 409.
   * Idempotente.
   */
  async waive(
    spaceId: string,
    actorId: string,
    chargeId: string,
    input: SubscriptionReasonInput,
  ): Promise<StaffSubscriptionCharge> {
    const subscriptionId = await this.db.transaction(async (tx) => {
      const locked = await lockCharge(tx, spaceId, chargeId);
      if (!locked) throw subscriptionChargeNotFound();
      const { sub, charge } = locked;
      if (charge.status === 'WAIVED') return sub.id;
      if (charge.status === 'PAID') throw chargeNotWaivable(charge.status);
      const [payment] = await tx
        .select({ id: paymentRecords.id })
        .from(paymentRecords)
        .where(
          and(
            eq(paymentRecords.payableType, 'SUBSCRIPTION_CHARGE'),
            eq(paymentRecords.payableId, charge.id),
            isNull(paymentRecords.reversedAt),
          ),
        )
        .limit(1);
      if (payment) throw chargeHasPayments();

      await tx
        .update(subscriptionCharges)
        .set({
          status: 'WAIVED',
          waivedAt: new Date(),
          waivedBy: actorId,
          waiveReason: input.reason ?? null,
        })
        .where(eq(subscriptionCharges.id, charge.id));
      await afterChargeChange(tx, spaceId, sub, charge.id);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'subscription_charge.waive',
        entity: 'subscription_charge',
        entityId: charge.id,
        diff: {
          subscriptionId: sub.id,
          from: charge.status,
          amountCents: charge.amountCents,
          reason: input.reason ?? null,
        },
      });
      return sub.id;
    });
    const waived = (await staffChargeRows(this.db, subscriptionId)).find((c) => c.id === chargeId);
    if (!waived) throw subscriptionChargeNotFound();
    return waived;
  }
}
