import {
  addDays,
  CANCELLATION_WAIVE_REASON,
  chargePeriodsToGenerate,
  DEFAULT_TIME_ZONE,
  isPastDue,
  monthStart,
  type PaymentRecord,
  type RecordPaymentInput,
  type ReversePaymentInput,
  SPACE_SETTINGS_DEFAULTS,
  type SubscriptionStatus,
  subscriptionChargeStatus,
  utcToZoned,
  zonedToUtc,
} from '@space-sports/shared';
import { and, eq, inArray, isNull, lt, min, type SQL, sql } from 'drizzle-orm';
import { toPaymentRecord } from '../bookings/booking-views.js';
import {
  payableNotFound,
  paymentAlreadyReversed,
  paymentExceedsDue,
  paymentNotFound,
} from '../bookings/bookings.errors.js';
import { audit, type DbOrTx, type Tx } from '../bookings/db-utils.js';
import {
  cities,
  classSessions,
  enrollments,
  paymentRecords,
  spaceSettings,
  spaces,
  subscriptionCharges,
  subscriptions,
} from '../db/schema/index.js';
import { chargeNotPayable } from './subscriptions.errors.js';

// Regras de cobrança das assinaturas (RF-CLASS-11, RN-CLASS-06/08) usadas pelas assinaturas,
// pelo job de mensalidades e pelo registro de pagamentos (RF-PAY-01). Funções sobre a transação
// do chamador, que já travou a assinatura: a ordem das travas é sempre assinatura → mensalidade.

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type ChargeRow = typeof subscriptionCharges.$inferSelect;

/** Assinaturas que geram mensalidade e entram na regra de atraso. */
export const BILLED_STATUSES = ['ACTIVE', 'PAST_DUE'] as const satisfies SubscriptionStatus[];

/** O que a cobrança precisa saber do espaço, com a data de hoje no fuso dele. */
export interface BillingContext {
  timeZone: string;
  today: string;
  /** RN-CLASS-06. */
  pastDueRule: { enabled: boolean; days: number };
}

export async function loadBillingContext(
  db: DbOrTx,
  spaceId: string,
  now: Date = new Date(),
): Promise<BillingContext> {
  const [row] = await db
    .select({ timeZone: cities.timezone, settings: spaceSettings })
    .from(spaces)
    .innerJoin(cities, eq(cities.id, spaces.cityId))
    .leftJoin(spaceSettings, eq(spaceSettings.spaceId, spaces.id))
    .where(eq(spaces.id, spaceId));
  const d = SPACE_SETTINGS_DEFAULTS;
  const s = row?.settings;
  const timeZone = row?.timeZone || DEFAULT_TIME_ZONE;
  return {
    timeZone,
    today: utcToZoned(now, timeZone).date,
    pastDueRule: {
      enabled: s?.pastDueBlockEnabled ?? d.pastDueBlockEnabled,
      days: s?.pastDueBlockDays ?? d.pastDueBlockDays,
    },
  };
}

// Nomes qualificados à mão: numa consulta de uma tabela só o Drizzle omite o nome da tabela das
// colunas, e `id` dentro da subconsulta passaria a ser o de `payment_records`.
const paidOfCharge = sql.raw(
  `FROM payment_records pr WHERE pr.payable_type = 'SUBSCRIPTION_CHARGE' AND pr.payable_id = "subscription_charges"."id"`,
);

/** Subconsulta: pagamentos não estornados da mensalidade. */
export const chargePaidSql = sql<number>`(SELECT coalesce(sum(pr.amount_cents), 0)::int ${paidOfCharge} AND pr.reversed_at IS NULL)`;

/** Nenhum pagamento (nem estornado) na mensalidade: ela pode ser apagada sem perder histórico. */
const withoutAnyPayment = sql`NOT EXISTS (SELECT 1 ${paidOfCharge})`;

export async function lockSubscription(
  tx: Tx,
  where: SQL | undefined,
): Promise<SubscriptionRow | undefined> {
  const [row] = await tx.select().from(subscriptions).where(where).for('update');
  return row;
}

/**
 * Gera as mensalidades devidas hoje (mês corrente e, na geração antecipada, o seguinte), com o
 * preço contratado e sem pró-rata. Idempotente por `UNIQUE(subscription_id, period_start)`.
 * Devolve quantas criou.
 */
export async function ensureCharges(
  tx: Tx,
  sub: SubscriptionRow,
  billingDay: number,
  ctx: Pick<BillingContext, 'today'>,
): Promise<number> {
  if (!sub.startsOn || !(BILLED_STATUSES as readonly string[]).includes(sub.status)) return 0;
  const { today } = ctx;
  const periods = chargePeriodsToGenerate(
    { startsOn: sub.startsOn, endsOn: sub.endsOn },
    billingDay,
    today,
  );
  if (!periods.length) return 0;
  const inserted = await tx
    .insert(subscriptionCharges)
    .values(
      periods.map((period) => ({
        subscriptionId: sub.id,
        ...period,
        amountCents: sub.priceCents,
        // Plano gratuito já nasce quitado; gerada com atraso (job parado) já nasce vencida.
        status: subscriptionChargeStatus(
          { amountCents: sub.priceCents, dueDate: period.dueDate },
          0,
          today,
        ),
      })),
    )
    .onConflictDoNothing({
      target: [subscriptionCharges.subscriptionId, subscriptionCharges.periodStart],
    })
    .returning({ id: subscriptionCharges.id });
  return inserted.length;
}

/**
 * Apaga as mensalidades em aberto, ainda não vencidas e sem nenhum pagamento que deixaram de ser
 * devidas (ciclo depois do fim). Devolve os ciclos apagados.
 */
export async function dropUnbilledCharges(
  tx: Tx,
  subscriptionId: string,
  condition: SQL,
): Promise<string[]> {
  const removed = await tx
    .delete(subscriptionCharges)
    .where(
      and(
        eq(subscriptionCharges.subscriptionId, subscriptionId),
        eq(subscriptionCharges.status, 'PENDING'),
        withoutAnyPayment,
        condition,
      ),
    )
    .returning({ periodStart: subscriptionCharges.periodStart });
  return removed.map((row) => row.periodStart);
}

/**
 * RN-CLASS-08: o cancelamento imediato dispensa a mensalidade do mês corrente ainda não vencida.
 * Com pagamento não estornado ela não é dispensável (como na dispensa da gestão) e segue em aberto.
 * Quem chama roda `markOverdue` antes. Devolve os ciclos dispensados.
 */
export async function waiveCurrentCharge(
  tx: Tx,
  subscriptionId: string,
  today: string,
  actorId: string,
): Promise<string[]> {
  const waived = await tx
    .update(subscriptionCharges)
    .set({
      status: 'WAIVED',
      waivedAt: new Date(),
      waivedBy: actorId,
      waiveReason: CANCELLATION_WAIVE_REASON,
    })
    .where(
      and(
        eq(subscriptionCharges.subscriptionId, subscriptionId),
        eq(subscriptionCharges.status, 'PENDING'),
        eq(subscriptionCharges.periodStart, monthStart(today)),
        sql`${chargePaidSql} = 0`,
      ),
    )
    .returning({ periodStart: subscriptionCharges.periodStart });
  return waived.map((row) => row.periodStart);
}

/** Primeiro instante depois de `endsOn` no fuso do espaço: daí em diante, sem acesso. */
export function accessEndsAt(endsOn: string, timeZone: string): Date {
  return zonedToUtc(addDays(endsOn, 1), 0, timeZone);
}

/**
 * Sessões das turmas que passaram pela assinatura, com a matrícula em qualquer status: quem trocou
 * de turma pode ter presença na antiga. Fica de fora a turma com matrícula ativa em outra
 * assinatura do aluno, que continua dando acesso a ela.
 */
export function subscriptionSessions(sub: Pick<SubscriptionRow, 'id' | 'userId'>): SQL {
  return sql`${classSessions.classGroupId} IN (SELECT ${enrollments.classGroupId} FROM ${enrollments} WHERE ${enrollments.subscriptionId} = ${sub.id}) AND ${classSessions.classGroupId} NOT IN (SELECT ${enrollments.classGroupId} FROM ${enrollments} INNER JOIN ${subscriptions} ON ${subscriptions.id} = ${enrollments.subscriptionId} WHERE ${subscriptions.userId} = ${sub.userId} AND ${subscriptions.id} <> ${sub.id} AND ${inArray(subscriptions.status, [...BILLED_STATUSES])} AND ${enrollments.status} = 'ACTIVE')`;
}

/** Encerra as matrículas ativas da assinatura em `on` (nunca antes do início de cada uma). */
export async function endEnrollments(tx: Tx, subscriptionId: string, on: string): Promise<void> {
  await tx
    .update(enrollments)
    .set({ status: 'ENDED', endedOn: sql`greatest(${enrollments.startedOn}, ${on}::date)` })
    .where(and(eq(enrollments.subscriptionId, subscriptionId), eq(enrollments.status, 'ACTIVE')));
}

/** Mensalidades em aberto vencidas antes de hoje passam a `OVERDUE`. */
export async function markOverdue(tx: Tx, subscriptionId: string, today: string): Promise<number> {
  const updated = await tx
    .update(subscriptionCharges)
    .set({ status: 'OVERDUE' })
    .where(
      and(
        eq(subscriptionCharges.subscriptionId, subscriptionId),
        eq(subscriptionCharges.status, 'PENDING'),
        lt(subscriptionCharges.dueDate, today),
      ),
    )
    .returning({ id: subscriptionCharges.id });
  return updated.length;
}

/**
 * RN-CLASS-06: assinatura ativa com mensalidade em aberto vencida há mais de X dias (regra
 * ligada) vai para `PAST_DUE`; regularizada (paga, dispensada ou regra desligada) volta para
 * `ACTIVE`. Pendente ou cancelada não muda. Devolve o status final.
 */
export async function refreshStanding(
  tx: Tx,
  sub: Pick<SubscriptionRow, 'id' | 'status'>,
  ctx: Pick<BillingContext, 'today' | 'pastDueRule'>,
): Promise<SubscriptionStatus> {
  if (!(BILLED_STATUSES as readonly string[]).includes(sub.status)) return sub.status;
  const [row] = await tx
    .select({ oldest: min(subscriptionCharges.dueDate) })
    .from(subscriptionCharges)
    .where(
      and(
        eq(subscriptionCharges.subscriptionId, sub.id),
        inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
        lt(subscriptionCharges.dueDate, ctx.today),
      ),
    );
  const next = isPastDue(row?.oldest ?? null, ctx.today, ctx.pastDueRule) ? 'PAST_DUE' : 'ACTIVE';
  if (next !== sub.status) {
    await tx.update(subscriptions).set({ status: next }).where(eq(subscriptions.id, sub.id));
  }
  return next;
}

/** Recalcula o status da mensalidade pelo que foi pago; dispensada não muda. */
async function refreshChargeStatus(tx: Tx, charge: ChargeRow, today: string): Promise<void> {
  if (charge.status === 'WAIVED') return;
  const [paid] = await tx
    .select({ cents: chargePaidSql })
    .from(subscriptionCharges)
    .where(eq(subscriptionCharges.id, charge.id));
  const status = subscriptionChargeStatus(
    { amountCents: charge.amountCents - charge.discountCents, dueDate: charge.dueDate },
    paid?.cents ?? 0,
    today,
  );
  if (status !== charge.status) {
    await tx
      .update(subscriptionCharges)
      .set({ status })
      .where(eq(subscriptionCharges.id, charge.id));
  }
}

/** Trava a assinatura e a mensalidade do espaço, nessa ordem. */
export async function lockCharge(
  tx: Tx,
  spaceId: string,
  chargeId: string,
): Promise<{ sub: SubscriptionRow; charge: ChargeRow } | undefined> {
  const [ref] = await tx
    .select({ subscriptionId: subscriptionCharges.subscriptionId })
    .from(subscriptionCharges)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
    .where(and(eq(subscriptionCharges.id, chargeId), eq(subscriptions.spaceId, spaceId)));
  if (!ref) return undefined;
  const sub = await lockSubscription(tx, eq(subscriptions.id, ref.subscriptionId));
  const [charge] = await tx
    .select()
    .from(subscriptionCharges)
    .where(eq(subscriptionCharges.id, chargeId))
    .for('update');
  return sub && charge ? { sub, charge } : undefined;
}

/** Depois de pagar, estornar ou dispensar: status da mensalidade e da assinatura. */
export async function afterChargeChange(
  tx: Tx,
  spaceId: string,
  sub: SubscriptionRow,
  chargeId: string,
): Promise<void> {
  const ctx = await loadBillingContext(tx, spaceId);
  const [charge] = await tx
    .select()
    .from(subscriptionCharges)
    .where(eq(subscriptionCharges.id, chargeId));
  if (charge) await refreshChargeStatus(tx, charge, ctx.today);
  await refreshStanding(tx, sub, ctx);
}

/**
 * A mensalidade do espaço aceita o pagamento deste valor? Sem travas: a conferência antes de
 * cancelar a cobrança online aberta (decisão 96); `recordChargePayment` confere de novo, travado.
 */
export async function assertChargePayable(
  tx: Tx,
  spaceId: string,
  chargeId: string,
  amountCents: number,
): Promise<void> {
  const [row] = await tx
    .select({ charge: subscriptionCharges, paid: chargePaidSql })
    .from(subscriptionCharges)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
    .where(and(eq(subscriptionCharges.id, chargeId), eq(subscriptions.spaceId, spaceId)));
  if (!row) throw payableNotFound();
  if (row.charge.status === 'WAIVED') throw chargeNotPayable(row.charge.status);
  const due = Math.max(row.charge.amountCents - row.charge.discountCents - row.paid, 0);
  if (amountCents > due) throw paymentExceedsDue(due);
}

/**
 * Pagamento da mensalidade de aula (RF-PAY-01, RN-PAY-01, RF-CLASS-11): a gestão registra no
 * local, ou o pagamento online confirmado registra pelo mesmo caminho (`online`, RN-ONPAY-04, sem
 * `recorded_by`), até o valor em aberto, com auditoria. Quitar volta a assinatura `PAST_DUE` para
 * `ACTIVE`.
 */
export async function recordChargePayment(
  tx: Tx,
  spaceId: string,
  actorId: string | null,
  input: RecordPaymentInput,
  online?: { chargeId: string },
): Promise<PaymentRecord> {
  const locked = await lockCharge(tx, spaceId, input.payableId);
  if (!locked) throw payableNotFound();
  const { sub, charge } = locked;
  if (charge.status === 'WAIVED') throw chargeNotPayable(charge.status);
  const [paid] = await tx
    .select({ cents: chargePaidSql })
    .from(subscriptionCharges)
    .where(eq(subscriptionCharges.id, charge.id));
  const due = Math.max(charge.amountCents - charge.discountCents - (paid?.cents ?? 0), 0);
  if (input.amountCents > due) throw paymentExceedsDue(due);

  const [record] = await tx
    .insert(paymentRecords)
    .values({
      spaceId,
      payableType: 'SUBSCRIPTION_CHARGE',
      payableId: charge.id,
      payerUserId: sub.userId,
      amountCents: input.amountCents,
      method: input.method,
      channel: online ? 'ONLINE' : 'ON_SITE',
      onlineChargeId: online?.chargeId ?? null,
      paidAt: input.paidAt ?? new Date(),
      recordedBy: online ? null : actorId,
      note: input.note ?? null,
    })
    .returning();
  if (!record) throw new Error('Insert de pagamento sem retorno.');
  await afterChargeChange(tx, spaceId, sub, charge.id);
  await audit(tx, {
    actorId,
    spaceId,
    action: 'payment.record',
    entity: 'payment_record',
    entityId: record.id,
    diff: {
      chargeId: charge.id,
      subscriptionId: sub.id,
      payableType: record.payableType,
      payableId: record.payableId,
      amountCents: record.amountCents,
      method: record.method,
      channel: record.channel,
      onlineChargeId: record.onlineChargeId,
      paidAt: record.paidAt.toISOString(),
    },
  });
  return toPaymentRecord(record);
}

/** Estorno do pagamento de mensalidade: a mensalidade volta a ficar em aberto (e a regra de atraso). */
export async function reverseChargePayment(
  tx: Tx,
  spaceId: string,
  actorId: string,
  found: typeof paymentRecords.$inferSelect,
  input: ReversePaymentInput,
): Promise<PaymentRecord> {
  const locked = await lockCharge(tx, spaceId, found.payableId);
  if (!locked) throw paymentNotFound();
  // Relido depois das travas: dois estornos simultâneos não passam os dois.
  const [record] = await tx
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.id, found.id))
    .for('update');
  if (!record) throw paymentNotFound();
  if (record.reversedAt) throw paymentAlreadyReversed();

  const [reversed] = await tx
    .update(paymentRecords)
    .set({ reversedAt: new Date(), reversedBy: actorId })
    .where(and(eq(paymentRecords.id, record.id), isNull(paymentRecords.reversedAt)))
    .returning();
  if (!reversed) throw paymentNotFound();
  await afterChargeChange(tx, spaceId, locked.sub, locked.charge.id);
  await audit(tx, {
    actorId,
    spaceId,
    action: 'payment.reverse',
    entity: 'payment_record',
    entityId: record.id,
    diff: {
      chargeId: locked.charge.id,
      subscriptionId: locked.sub.id,
      amountCents: record.amountCents,
      method: record.method,
      reason: input.reason ?? null,
    },
  });
  return toPaymentRecord(reversed);
}
