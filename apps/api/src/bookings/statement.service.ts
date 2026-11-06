import { Inject, Injectable } from '@nestjs/common';
import {
  type PayableType,
  type PaymentMethod,
  STATEMENT_SERVICE_PAYABLE_TYPES,
  type Statement,
  type StatementEntry,
  type StatementFilters,
  type StatementQuery,
  type StatementService as StatementServiceType,
} from '@space-sports/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CSV_BOM, csvLine, csvMonth, csvUtcDateTime } from '../common/csv.js';
import type { Database } from '../db/client.js';
import {
  bookingParticipants,
  bookings,
  courts,
  paymentRecords,
  plans,
  recurringBookingCharges,
  recurringBookings,
  subscriptionCharges,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { type Cursor, decodeCursor, encodeCursor } from './db-utils.js';
import { SpaceContextService } from './space-context.js';

const SERVICE_OF_TYPE = new Map<PayableType, StatementServiceType>(
  (
    Object.entries(STATEMENT_SERVICE_PAYABLE_TYPES) as [
      StatementServiceType,
      readonly PayableType[],
    ][]
  ).flatMap(([service, types]) => types.map((type) => [type, service] as const)),
);
const ALL_TYPES = [...SERVICE_OF_TYPE.keys()];
const CSV_BATCH = 1000;

export const STATEMENT_CSV_COLUMNS = [
  'id',
  'pago_em_utc',
  'pago_em_local',
  'servico',
  'tipo',
  'forma',
  'canal',
  'valor_centavos',
  'pagador',
  'quadra',
  'reserva_inicio_local',
  'mensalidade_mes',
  'registrado_por',
  'observacao',
  'estornado_em_utc',
] as const;

const payer = alias(users, 'payer');
const recorder = alias(users, 'recorder');
const booking = alias(bookings, 'booking');
const participantBooking = alias(bookings, 'participant_booking');

/** Somas vêm como `bigint` (string no driver); centavos cabem com folga em `Number`. */
const num = (value: unknown) => Number(value ?? 0);

/**
 * Extrato de recebimentos do espaço (RF-PAY-03): os registros de pagamento do aluguel (reserva,
 * partes e mensalidade do mensalista) e da mensalidade de aula num período de `paid_at`, com filtros por forma e serviço,
 * totais e CSV. Só leitura; sempre filtrado pelo `space_id` da rota.
 */
@Injectable()
export class StatementService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async statement(spaceId: string, query: StatementQuery): Promise<Statement> {
    const { timeZone } = await this.spaces.load(spaceId);
    const where = this.conditions(spaceId, query);
    const amount = sql<string>`coalesce(sum(${paymentRecords.amountCents}), 0)::bigint`;
    const total = sql<number>`count(*)::int`;

    const [byMethod, byChannel, [reversed], rows] = await Promise.all([
      this.db
        .select({ method: paymentRecords.method, receivedCents: amount, paymentsCount: total })
        .from(paymentRecords)
        .where(and(where, isNull(paymentRecords.reversedAt)))
        .groupBy(paymentRecords.method)
        .orderBy(desc(amount), asc(paymentRecords.method)),
      this.db
        .select({ channel: paymentRecords.channel, receivedCents: amount, paymentsCount: total })
        .from(paymentRecords)
        .where(and(where, isNull(paymentRecords.reversedAt)))
        .groupBy(paymentRecords.channel)
        .orderBy(asc(paymentRecords.channel)),
      this.db
        .select({ cents: amount })
        .from(paymentRecords)
        .where(and(where, sql`${paymentRecords.reversedAt} IS NOT NULL`)),
      this.entries(
        where,
        query.cursor ? decodeCursor(query.cursor) : undefined,
        query.limit + 1,
        timeZone,
        'desc',
      ),
    ]);

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    const methods = byMethod.map((row) => ({
      method: row.method as PaymentMethod,
      receivedCents: num(row.receivedCents),
      paymentsCount: row.paymentsCount,
    }));
    return {
      period: { from: query.from.toISOString(), to: query.to.toISOString() },
      timeZone,
      totals: {
        receivedCents: methods.reduce((sum, row) => sum + row.receivedCents, 0),
        paymentsCount: methods.reduce((sum, row) => sum + row.paymentsCount, 0),
        reversedCents: num(reversed?.cents),
      },
      byMethod: methods,
      byChannel: byChannel.map((row) => ({
        channel: row.channel,
        receivedCents: num(row.receivedCents),
        paymentsCount: row.paymentsCount,
      })),
      items: items.map(({ entry }) => entry),
      nextCursor:
        hasMore && last
          ? encodeCursor({ startsAt: new Date(last.entry.paidAt), id: last.entry.id })
          : null,
    };
  }

  /**
   * CSV do extrato (inclusive estornados, com a data do estorno), em ordem cronológica e em
   * lotes, sem carregar tudo na memória. Datas locais no fuso do espaço.
   */
  async *exportCsv(spaceId: string, filters: StatementFilters): AsyncGenerator<string> {
    const { timeZone } = await this.spaces.load(spaceId);
    const where = this.conditions(spaceId, filters);
    yield `${CSV_BOM}${STATEMENT_CSV_COLUMNS.join(',')}\r\n`;

    let after: Cursor | undefined;
    for (;;) {
      const rows = await this.entries(where, after, CSV_BATCH, timeZone, 'asc');
      if (!rows.length) return;
      yield rows
        .map(({ entry, paidLocal, bookingStartsLocal }) =>
          csvLine([
            entry.id,
            csvUtcDateTime(entry.paidAt),
            paidLocal,
            entry.service,
            entry.payableType,
            entry.method,
            entry.channel === 'ONLINE' ? 'online' : 'no_local',
            entry.amountCents,
            entry.payerName ?? '',
            entry.courtName ?? '',
            bookingStartsLocal ?? '',
            entry.chargePeriodStart ? csvMonth(entry.chargePeriodStart) : '',
            entry.recordedByName ?? (entry.channel === 'ONLINE' ? 'Pagamento online' : ''),
            entry.note ?? '',
            entry.reversedAt ? csvUtcDateTime(entry.reversedAt) : '',
          ]),
        )
        .join('');
      const last = rows.at(-1);
      if (rows.length < CSV_BATCH || !last) return;
      after = { startsAt: new Date(last.entry.paidAt), id: last.entry.id };
    }
  }

  /** Espaço, período [from, to) por `paid_at`, forma e serviço. */
  private conditions(spaceId: string, filters: StatementFilters): SQL | undefined {
    const types = filters.service ? STATEMENT_SERVICE_PAYABLE_TYPES[filters.service] : ALL_TYPES;
    return and(
      eq(paymentRecords.spaceId, spaceId),
      gte(paymentRecords.paidAt, filters.from),
      lt(paymentRecords.paidAt, filters.to),
      inArray(paymentRecords.payableType, [...types]),
      filters.method ? eq(paymentRecords.method, filters.method) : undefined,
      filters.channel ? eq(paymentRecords.channel, filters.channel) : undefined,
    );
  }

  /** Registros com pagador, quadra e item pago; keyset por (paid_at, id). */
  private async entries(
    where: SQL | undefined,
    after: Cursor | undefined,
    limit: number,
    timeZone: string,
    direction: 'asc' | 'desc',
  ) {
    const keyset = after
      ? direction === 'asc'
        ? sql`(${paymentRecords.paidAt}, ${paymentRecords.id}) > (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`
        : sql`(${paymentRecords.paidAt}, ${paymentRecords.id}) < (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`
      : undefined;
    const order =
      direction === 'asc'
        ? [asc(paymentRecords.paidAt), asc(paymentRecords.id)]
        : [desc(paymentRecords.paidAt), desc(paymentRecords.id)];

    // A reserva vem direto (BOOKING) ou pela parte paga (BOOKING_PARTICIPANT).
    const bookingStartsAt = sql<Date | null>`coalesce(${booking.startsAt}, ${participantBooking.startsAt})`;

    const rows = await this.db
      .select({
        record: paymentRecords,
        payerName: payer.name,
        recordedByName: recorder.name,
        participantName: bookingParticipants.name,
        bookingId: sql<string | null>`coalesce(${booking.id}, ${participantBooking.id})`,
        bookingStartsAt: bookingStartsAt.mapWith(booking.startsAt),
        bookingGuestName: sql<
          string | null
        >`coalesce(${booking.guestName}, ${participantBooking.guestName})`,
        recurringBookingId: recurringBookings.id,
        recurringGuestName: recurringBookings.guestName,
        recurringChargePeriodStart: recurringBookingCharges.periodStart,
        subscriptionId: subscriptions.id,
        planName: plans.name,
        subscriptionChargePeriodStart: subscriptionCharges.periodStart,
        courtName: courts.name,
        paidLocal: sql<string>`to_char(${paymentRecords.paidAt} AT TIME ZONE ${timeZone}, 'DD/MM/YYYY HH24:MI:SS')`,
        bookingStartsLocal: sql<
          string | null
        >`to_char(${bookingStartsAt} AT TIME ZONE ${timeZone}, 'DD/MM/YYYY HH24:MI')`,
      })
      .from(paymentRecords)
      .leftJoin(recorder, eq(recorder.id, paymentRecords.recordedBy))
      .leftJoin(payer, eq(payer.id, paymentRecords.payerUserId))
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
      .leftJoin(
        courts,
        sql`${courts.id} = coalesce(${booking.courtId}, ${participantBooking.courtId}, ${recurringBookings.courtId})`,
      )
      .where(and(where, keyset))
      .orderBy(...order)
      .limit(limit);

    return rows.map((row) => {
      const { record } = row;
      const service = SERVICE_OF_TYPE.get(record.payableType as PayableType) ?? 'RENTAL';
      const entry: StatementEntry = {
        id: record.id,
        payableType: record.payableType as StatementEntry['payableType'],
        payableId: record.payableId,
        payerUserId: record.payerUserId,
        amountCents: record.amountCents,
        method: record.method as PaymentMethod,
        channel: record.channel,
        onlineChargeId: record.onlineChargeId,
        paidAt: record.paidAt.toISOString(),
        recordedBy: record.recordedBy,
        note: record.note,
        reversedAt: record.reversedAt?.toISOString() ?? null,
        reversedBy: record.reversedBy,
        service,
        payerName:
          row.payerName ??
          (record.payableType === 'BOOKING_PARTICIPANT'
            ? row.participantName
            : (row.bookingGuestName ?? row.recurringGuestName)),
        recordedByName: row.recordedByName,
        bookingId: row.bookingId,
        bookingStartsAt: row.bookingStartsAt?.toISOString() ?? null,
        recurringBookingId: row.recurringBookingId,
        subscriptionId: row.subscriptionId,
        planName: row.planName,
        chargePeriodStart: row.recurringChargePeriodStart ?? row.subscriptionChargePeriodStart,
        courtName: row.courtName,
      };
      return { entry, paidLocal: row.paidLocal, bookingStartsLocal: row.bookingStartsLocal };
    });
  }
}
