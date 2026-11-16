import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
  REVENUE_ANALYTICS_COLUMNS,
  REVENUE_ORIGIN_LABELS,
  type RevenueAnalytics,
  type RevenueAnalyticsGroupBy,
  type RevenueAnalyticsQuery,
} from '@space-sports/shared';
import { and, eq, inArray, ne, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PAYABLE_STATUSES } from '../bookings/booking-payments.js';
import { paidCentsSql } from '../bookings/booking-views.js';
import { SpaceContextService } from '../bookings/space-context.js';
import { SERVICE_OF_TYPE, statementWhere } from '../bookings/statement.service.js';
import { chargePaidSql } from '../classes/subscription-billing.js';
import type { Database } from '../db/client.js';
import {
  bookingParticipants,
  bookings,
  courts,
  paymentRecords,
  plans,
  recurringBookingCharges,
  recurringBookings,
  sports,
  subscriptionCharges,
  subscriptions,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { activeCourts } from './analytics-common.js';
import {
  type Bucket,
  columnsOf,
  enumBuckets,
  fillRows,
  isTimeBucket,
  num,
  type ResolvedPeriod,
  resolvePeriod,
  timeBucketSql,
  timeBuckets,
} from './period.js';

const booking = alias(bookings, 'booking');
const participantBooking = alias(bookings, 'participant_booking');
const NO_COURT = 'none';
const NO_COURT_LABEL = 'Sem quadra (mensalidades de aula)';

/** Origem (serviço do extrato) do tipo de pagamento, em SQL. */
const originOf = sql<string>`CASE ${sql.join(
  [...SERVICE_OF_TYPE].map(
    ([type, service]) => sql`WHEN ${paymentRecords.payableType} = ${type} THEN ${service}`,
  ),
  sql` `,
)} END`;

/** Quadra e esporte do item pago (reserva, parte antiga, mensalista antigo ou plano da aula). */
const paidCourt = sql`coalesce(${booking.courtId}, ${participantBooking.courtId}, ${recurringBookings.courtId})`;
const paidSport = sql`coalesce(${booking.sportId}, ${participantBooking.sportId}, ${recurringBookings.sportId}, ${plans.sportId})`;

type Sums = { receivedCents: number; paymentsCount: number; reversedCents: number };

/**
 * Receita do espaço (docs/14-mcp.md 8.4; só Dono e Admin, decisão 53). **Recebido**: os registros
 * do extrato (`statementWhere`, RF-PAY-03) pela data do pagamento, sem os estornados (que vão em
 * "estornado"). **A receber**: o saldo em aberto das reservas que contam (a regra do "a receber
 * hoje": preço − abatimento − pago) pela data de início, e das mensalidades de aula pendentes ou
 * vencidas (valor − abatimento − pago) pela data de vencimento. Três consultas agregadas.
 */
@Injectable()
export class RevenueAnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async revenue(spaceId: string, query: RevenueAnalyticsQuery): Promise<RevenueAnalytics> {
    const { timeZone } = await this.spaces.load(spaceId);
    const period = resolvePeriod(query, timeZone);
    const { groupBy } = query;

    const [received, bookingsDue, chargesDue, buckets] = await Promise.all([
      this.received(spaceId, period, query),
      this.bookingsDue(spaceId, period, query),
      query.courtId ? Promise.resolve([]) : this.chargesDue(spaceId, period, query),
      this.buckets(groupBy, period, spaceId, query.courtId),
    ]);

    const labels = new Map<string, string>();
    const sums = new Map<string, Sums>();
    for (const row of received) {
      sums.set(row.key, {
        receivedCents: num(row.receivedCents),
        paymentsCount: row.paymentsCount,
        reversedCents: num(row.reversedCents),
      });
      if (row.label) labels.set(row.key, row.label);
    }
    const due = new Map<string, number>();
    for (const row of [...bookingsDue, ...chargesDue]) {
      due.set(row.key, (due.get(row.key) ?? 0) + num(row.dueCents));
      if (row.label) labels.set(row.key, row.label);
    }
    // Forma e canal não existem no que falta receber: a coluna fica nula nessas linhas.
    const hasDue = groupBy !== 'method' && groupBy !== 'channel';
    const empty: Sums = { receivedCents: 0, paymentsCount: 0, reversedCents: 0 };
    const keys = new Set([...sums.keys(), ...(hasDue ? due.keys() : [])]);
    const found = new Map(
      [...keys].map((key) => [
        key,
        { ...(sums.get(key) ?? empty), receivableCents: hasDue ? (due.get(key) ?? 0) : null },
      ]),
    );
    const totals = [...sums.values()].reduce(
      (acc, s) => ({
        receivedCents: acc.receivedCents + s.receivedCents,
        paymentsCount: acc.paymentsCount + s.paymentsCount,
        reversedCents: acc.reversedCents + s.reversedCents,
      }),
      empty,
    );

    return {
      period: { from: period.from, to: period.to },
      groupBy,
      timezone: timeZone,
      columns: columnsOf(REVENUE_ANALYTICS_COLUMNS),
      rows: fillRows(
        buckets,
        found,
        () => ({ ...empty, receivableCents: hasDue ? 0 : null }),
        (key) => labels.get(key) ?? key,
      ),
      totals: { ...totals, receivableCents: [...due.values()].reduce((a, b) => a + b, 0) },
    };
  }

  /** Pagamentos do extrato no período, agrupados. */
  private received(spaceId: string, period: ResolvedPeriod, query: RevenueAnalyticsQuery) {
    const key = receivedKey(query.groupBy, period.timeZone);
    const label =
      query.groupBy === 'court'
        ? sql<string | null>`max(${courts.name})`
        : query.groupBy === 'sport'
          ? sql<string | null>`max(${sports.name})`
          : sql<null>`NULL`;
    return this.db
      .select({
        key,
        label,
        receivedCents: sql<string>`coalesce(sum(${paymentRecords.amountCents}) FILTER (WHERE ${paymentRecords.reversedAt} IS NULL), 0)::bigint`,
        paymentsCount: sql<number>`(count(*) FILTER (WHERE ${paymentRecords.reversedAt} IS NULL))::int`,
        reversedCents: sql<string>`coalesce(sum(${paymentRecords.amountCents}) FILTER (WHERE ${paymentRecords.reversedAt} IS NOT NULL), 0)::bigint`,
      })
      .from(paymentRecords)
      .leftJoin(
        bookingParticipants,
        and(
          eq(paymentRecords.payableType, 'BOOKING_PARTICIPANT'),
          eq(bookingParticipants.id, paymentRecords.payableId),
        ),
      )
      .leftJoin(
        booking,
        and(eq(paymentRecords.payableType, 'BOOKING'), eq(booking.id, paymentRecords.payableId)),
      )
      .leftJoin(participantBooking, eq(participantBooking.id, bookingParticipants.bookingId))
      .leftJoin(
        recurringBookingCharges,
        and(
          eq(paymentRecords.payableType, 'RECURRING_BOOKING_CHARGE'),
          eq(recurringBookingCharges.id, paymentRecords.payableId),
        ),
      )
      .leftJoin(
        recurringBookings,
        eq(recurringBookings.id, recurringBookingCharges.recurringBookingId),
      )
      .leftJoin(
        subscriptionCharges,
        and(
          eq(paymentRecords.payableType, 'SUBSCRIPTION_CHARGE'),
          eq(subscriptionCharges.id, paymentRecords.payableId),
        ),
      )
      .leftJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(courts, sql`${courts.id} = ${paidCourt}`)
      .leftJoin(sports, sql`${sports.id} = ${paidSport}`)
      .where(
        and(
          statementWhere(spaceId, { from: period.start, to: period.end }),
          query.courtId ? sql`${paidCourt} = ${query.courtId}::uuid` : undefined,
          query.sportId ? sql`${paidSport} = ${query.sportId}::uuid` : undefined,
        ),
      )
      .groupBy(sql`1`);
  }

  /** Saldo em aberto das reservas que contam, com início no período. */
  private bookingsDue(spaceId: string, period: ResolvedPeriod, query: RevenueAnalyticsQuery) {
    const { groupBy } = query;
    const key: SQL<string> = isTimeBucket(groupBy)
      ? timeBucketSql(groupBy, bookings.startsAt, period.timeZone)
      : groupBy === 'origin'
        ? sql<string>`'RENTAL'`
        : groupBy === 'court'
          ? sql<string>`${bookings.courtId}::text`
          : groupBy === 'sport'
            ? sql<string>`${bookings.sportId}::text`
            : sql<string>`'total'`;
    return this.db
      .select({
        key,
        label:
          groupBy === 'court'
            ? sql<string | null>`max(${courts.name})`
            : groupBy === 'sport'
              ? sql<string | null>`max(${sports.name})`
              : sql<null>`NULL`,
        dueCents: sql<string>`coalesce(sum(greatest(${bookings.priceCents} - ${bookings.discountCents} - ${paidCentsSql}, 0)), 0)::bigint`,
      })
      .from(bookings)
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(sports, eq(sports.id, bookings.sportId))
      .where(
        and(
          eq(bookings.spaceId, spaceId),
          sql`${bookings.startsAt} >= ${period.start.toISOString()}::timestamptz AND ${bookings.startsAt} < ${period.end.toISOString()}::timestamptz`,
          inArray(bookings.status, [...PAYABLE_STATUSES]),
          ne(bookings.paymentStatus, 'PAID'),
          sql`${bookings.priceCents} > 0`,
          query.courtId ? eq(bookings.courtId, query.courtId) : undefined,
          query.sportId ? eq(bookings.sportId, query.sportId) : undefined,
        ),
      )
      .groupBy(sql`1`);
  }

  /** Saldo em aberto das mensalidades de aula pendentes ou vencidas, com vencimento no período. */
  private chargesDue(spaceId: string, period: ResolvedPeriod, query: RevenueAnalyticsQuery) {
    const { groupBy } = query;
    const dueAt = sql`(${subscriptionCharges.dueDate}::timestamp AT TIME ZONE ${period.timeZone})`;
    const key: SQL<string> = isTimeBucket(groupBy)
      ? timeBucketSql(groupBy, dueAt, period.timeZone)
      : groupBy === 'origin'
        ? sql<string>`'CLASS'`
        : groupBy === 'court'
          ? sql<string>`${NO_COURT}`
          : groupBy === 'sport'
            ? sql<string>`${plans.sportId}::text`
            : sql<string>`'total'`;
    return this.db
      .select({
        key,
        label: groupBy === 'sport' ? sql<string | null>`max(${sports.name})` : sql<null>`NULL`,
        dueCents: sql<string>`coalesce(sum(greatest(${subscriptionCharges.amountCents} - ${subscriptionCharges.discountCents} - ${chargePaidSql}, 0)), 0)::bigint`,
      })
      .from(subscriptionCharges)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(sports, eq(sports.id, plans.sportId))
      .where(
        and(
          eq(subscriptions.spaceId, spaceId),
          sql`${subscriptionCharges.dueDate} BETWEEN ${period.from}::date AND ${period.to}::date`,
          inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
          query.sportId ? eq(plans.sportId, query.sportId) : undefined,
        ),
      )
      .groupBy(sql`1`);
  }

  private async buckets(
    groupBy: RevenueAnalyticsGroupBy,
    period: { from: string; to: string },
    spaceId: string,
    courtId: string | undefined,
  ): Promise<Bucket[]> {
    if (isTimeBucket(groupBy)) return timeBuckets(groupBy, period);
    switch (groupBy) {
      case 'method':
        return enumBuckets(PAYMENT_METHOD_LABELS);
      case 'channel':
        return enumBuckets(PAYMENT_CHANNEL_LABELS);
      case 'origin':
        return enumBuckets(REVENUE_ORIGIN_LABELS);
      case 'court': {
        const list = (await activeCourts(this.db, spaceId, courtId)).map((c) => ({
          key: c.id,
          label: c.name,
        }));
        return courtId ? list : [...list, { key: NO_COURT, label: NO_COURT_LABEL }];
      }
      default:
        return [];
    }
  }
}

function receivedKey(groupBy: RevenueAnalyticsGroupBy, timeZone: string): SQL<string> {
  if (isTimeBucket(groupBy)) return timeBucketSql(groupBy, paymentRecords.paidAt, timeZone);
  switch (groupBy) {
    case 'method':
      return sql<string>`${paymentRecords.method}::text`;
    case 'channel':
      return sql<string>`${paymentRecords.channel}::text`;
    case 'origin':
      return originOf;
    case 'court':
      return sql<string>`coalesce(${paidCourt}::text, ${NO_COURT})`;
    default:
      return sql<string>`${paidSport}::text`;
  }
}
