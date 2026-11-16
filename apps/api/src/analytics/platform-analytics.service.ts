import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  PLATFORM_ANALYTICS_COLUMNS,
  type PlatformAnalytics,
  type PlatformAnalyticsQuery,
  previousAnalyticsPeriod,
  SPACES_ANALYTICS_COLUMNS,
  type SpacesAnalytics,
  type SpacesAnalyticsQuery,
} from '@space-sports/shared';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { STATEMENT_PAYABLE_TYPES } from '../bookings/statement.service.js';
import { ENROLLED_SUBSCRIPTION } from '../classes/attendance-rules.js';
import type { Database } from '../db/client.js';
import {
  attendances,
  bookings,
  classSessions,
  enrollments,
  onlineCharges,
  paymentRecords,
  recurringBookings,
  spaceLedgerEntries,
  spaces,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { costFigure, ledgerFigures, toFigures } from '../payments/super-payments.service.js';
import { bookingCounts } from './analytics-common.js';
import {
  columnsOf,
  fillRows,
  hoursOf,
  inPeriod,
  num,
  resolvePeriod,
  timeBucketSql,
  timeBuckets,
  withInstants,
} from './period.js';

const TZ = DEFAULT_TIME_ZONE;

type PlatformSums = Omit<PlatformAnalytics['totals'], 'bookedHours' | 'activeSpaces'> & {
  minutes: number;
  spaces: Set<string>;
};
const zero = (): PlatformSums => ({
  bookings: 0,
  minutes: 0,
  newUsers: 0,
  newSpaces: 0,
  spaces: new Set(),
  onlinePayments: 0,
  onlineVolumeCents: 0,
  platformRevenueCents: 0,
});
const platformValues = ({ minutes, spaces: active, ...rest }: PlatformSums) => ({
  ...rest,
  bookedHours: hoursOf(minutes),
  activeSpaces: active.size,
});

/**
 * Métricas da plataforma e comparação entre espaços para o Super (docs/14-mcp.md 8.4), no fuso
 * dos espaços. Uma consulta por fonte (reservas, aulas, cadastros, livro-razão), em paralelo.
 */
@Injectable()
export class PlatformAnalyticsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async platform(query: PlatformAnalyticsQuery): Promise<PlatformAnalytics> {
    const period = resolvePeriod(query, TZ);
    const bucket = (column: Parameters<typeof timeBucketSql>[1]) =>
      timeBucketSql(query.groupBy, column, TZ);

    const [bookingRows, classRows, userRows, spaceRows, ledgerRows, costRows] = await Promise.all([
      // Reservas que contam, por espaço (para "espaços com movimento").
      this.db
        .select({
          key: bucket(bookings.startsAt),
          spaceId: bookings.spaceId,
          bookings: sql<number>`count(*)::int`,
          minutes: sql<string>`coalesce(sum(${bookings.durationMin}), 0)::bigint`,
        })
        .from(bookings)
        .where(and(inPeriod(bookings.startsAt, period), bookingCounts()))
        .groupBy(sql`1`, sql`2`),
      this.db
        .selectDistinct({ key: bucket(classSessions.startsAt), spaceId: classSessions.spaceId })
        .from(classSessions)
        .where(and(inPeriod(classSessions.startsAt, period), eq(classSessions.status, 'DONE'))),
      this.db
        .select({ key: bucket(users.createdAt), total: sql<number>`count(*)::int` })
        .from(users)
        .where(inPeriod(users.createdAt, period))
        .groupBy(sql`1`),
      this.db
        .select({ key: bucket(spaces.createdAt), total: sql<number>`count(*)::int` })
        .from(spaces)
        .where(inPeriod(spaces.createdAt, period))
        .groupBy(sql`1`),
      // Receita online: a mesma regra do relatório do Super (RF-ONPAY-11, decisão 91).
      this.db
        .select({ key: bucket(spaceLedgerEntries.createdAt), ...ledgerFigures })
        .from(spaceLedgerEntries)
        .innerJoin(onlineCharges, eq(onlineCharges.id, spaceLedgerEntries.chargeId))
        .where(
          and(
            inArray(spaceLedgerEntries.kind, ['SALE', 'PLATFORM_FEE', 'FEE_REFUND']),
            inPeriod(spaceLedgerEntries.createdAt, period),
          ),
        )
        .groupBy(sql`1`),
      this.db
        .select({ key: bucket(onlineCharges.paidAt), ...costFigure })
        .from(onlineCharges)
        .where(and(isNotNull(onlineCharges.paidAt), inPeriod(onlineCharges.paidAt, period)))
        .groupBy(sql`1`),
    ]);

    const groups = new Map<string, PlatformSums>();
    const total = zero();
    const at = (key: string) => {
      const acc = groups.get(key) ?? zero();
      groups.set(key, acc);
      return acc;
    };
    for (const row of bookingRows) {
      const acc = at(row.key);
      acc.bookings += row.bookings;
      acc.minutes += num(row.minutes);
      acc.spaces.add(row.spaceId);
      total.bookings += row.bookings;
      total.minutes += num(row.minutes);
      total.spaces.add(row.spaceId);
    }
    for (const row of classRows) {
      at(row.key).spaces.add(row.spaceId);
      total.spaces.add(row.spaceId);
    }
    for (const row of userRows) {
      at(row.key).newUsers += row.total;
      total.newUsers += row.total;
    }
    for (const row of spaceRows) {
      at(row.key).newSpaces += row.total;
      total.newSpaces += row.total;
    }
    const costOf = new Map(costRows.map((row) => [row.key, row.gatewayCostCents]));
    for (const key of new Set([...ledgerRows.map((r) => r.key), ...costOf.keys()])) {
      const figures = toFigures(
        ledgerRows.find((r) => r.key === key),
        costOf.get(key),
      );
      const acc = at(key);
      acc.onlinePayments += figures.chargesCount;
      acc.onlineVolumeCents += figures.volumeCents;
      acc.platformRevenueCents += figures.netRevenueCents;
      total.onlinePayments += figures.chargesCount;
      total.onlineVolumeCents += figures.volumeCents;
      total.platformRevenueCents += figures.netRevenueCents;
    }

    return {
      period: { from: period.from, to: period.to },
      groupBy: query.groupBy,
      timezone: TZ,
      columns: columnsOf(PLATFORM_ANALYTICS_COLUMNS),
      rows: fillRows(
        timeBuckets(query.groupBy, period),
        new Map([...groups].map(([key, sums]) => [key, platformValues(sums)])),
        () => platformValues(zero()),
      ),
      totals: platformValues(total),
    };
  }

  /**
   * Comparação entre espaços (RF-SUPER-09): o período e o anterior, de mesma duração, numa
   * consulta por fonte (reservas, presenças, recebido) com as duas janelas em `FILTER`; mensalistas
   * e alunos ativos são o retrato de hoje. Ordena e corta em `limit` aqui (a lista de espaços é
   * pequena); os totais somam todos os espaços do filtro.
   */
  async spaces(query: SpacesAnalyticsQuery): Promise<SpacesAnalytics> {
    const period = resolvePeriod(query, TZ);
    const previous = withInstants(previousAnalyticsPeriod(period), TZ);
    const window = { start: previous.start, end: period.end };
    const current = (column: Parameters<typeof inPeriod>[0]) => inPeriod(column, period);
    const both = (column: Parameters<typeof inPeriod>[0]) => inPeriod(column, window);
    const split = (column: Parameters<typeof inPeriod>[0]) => ({
      current: sql<number>`(count(*) FILTER (WHERE ${current(column)}))::int`,
      previous: sql<number>`(count(*) FILTER (WHERE NOT (${current(column)})))::int`,
    });

    const [spaceList, bookingRows, presenceRows, receivedRows, recurringRows, studentRows] =
      await Promise.all([
        this.db
          .select({ id: spaces.id, name: spaces.name })
          .from(spaces)
          .where(query.status ? eq(spaces.status, query.status) : undefined)
          .orderBy(asc(spaces.name), asc(spaces.id)),
        this.db
          .select({ spaceId: bookings.spaceId, ...split(bookings.startsAt) })
          .from(bookings)
          .where(and(both(bookings.startsAt), bookingCounts()))
          .groupBy(bookings.spaceId),
        this.db
          .select({ spaceId: classSessions.spaceId, ...split(classSessions.startsAt) })
          .from(attendances)
          .innerJoin(classSessions, eq(classSessions.id, attendances.sessionId))
          .where(
            and(
              both(classSessions.startsAt),
              eq(classSessions.status, 'DONE'),
              eq(attendances.status, 'PRESENT'),
            ),
          )
          .groupBy(classSessions.spaceId),
        // Recebido: a regra do extrato (tipos do extrato, sem estornados), por data do pagamento.
        this.db
          .select({
            spaceId: paymentRecords.spaceId,
            current: sql<string>`coalesce(sum(${paymentRecords.amountCents}) FILTER (WHERE ${current(paymentRecords.paidAt)}), 0)::bigint`,
            previous: sql<string>`coalesce(sum(${paymentRecords.amountCents}) FILTER (WHERE NOT (${current(paymentRecords.paidAt)})), 0)::bigint`,
          })
          .from(paymentRecords)
          .where(
            and(
              both(paymentRecords.paidAt),
              isNull(paymentRecords.reversedAt),
              inArray(paymentRecords.payableType, STATEMENT_PAYABLE_TYPES),
            ),
          )
          .groupBy(paymentRecords.spaceId),
        this.db
          .select({ spaceId: recurringBookings.spaceId, total: sql<number>`count(*)::int` })
          .from(recurringBookings)
          .where(eq(recurringBookings.status, 'ACTIVE'))
          .groupBy(recurringBookings.spaceId),
        this.db
          .select({
            spaceId: subscriptions.spaceId,
            total: sql<number>`count(DISTINCT ${subscriptions.userId})::int`,
          })
          .from(enrollments)
          .innerJoin(subscriptions, eq(subscriptions.id, enrollments.subscriptionId))
          .where(
            and(
              eq(enrollments.status, 'ACTIVE'),
              inArray(subscriptions.status, ENROLLED_SUBSCRIPTION),
            ),
          )
          .groupBy(subscriptions.spaceId),
      ]);

    const bookingsOf = new Map(bookingRows.map((r) => [r.spaceId, r]));
    const presencesOf = new Map(presenceRows.map((r) => [r.spaceId, r]));
    const receivedOf = new Map(receivedRows.map((r) => [r.spaceId, r]));
    const recurringOf = new Map(recurringRows.map((r) => [r.spaceId, r.total]));
    const studentsOf = new Map(studentRows.map((r) => [r.spaceId, r.total]));
    const rowOf = (spaceId: string): SpacesAnalytics['totals'] => {
      const b = bookingsOf.get(spaceId);
      const p = presencesOf.get(spaceId);
      const r = receivedOf.get(spaceId);
      const bookingsNow = b?.current ?? 0;
      const bookingsBefore = b?.previous ?? 0;
      const presencesNow = p?.current ?? 0;
      const presencesBefore = p?.previous ?? 0;
      const receivedNow = num(r?.current);
      const receivedBefore = num(r?.previous);
      return {
        bookings: bookingsNow,
        previousBookings: bookingsBefore,
        bookingsDelta: bookingsNow - bookingsBefore,
        presences: presencesNow,
        previousPresences: presencesBefore,
        presencesDelta: presencesNow - presencesBefore,
        receivedCents: receivedNow,
        previousReceivedCents: receivedBefore,
        receivedDeltaCents: receivedNow - receivedBefore,
        activeRecurring: recurringOf.get(spaceId) ?? 0,
        activeStudents: studentsOf.get(spaceId) ?? 0,
      };
    };
    const rows = spaceList.map((space) => ({
      key: space.id,
      label: space.name,
      ...rowOf(space.id),
    }));
    const totals = rows.reduce(
      (acc, row) => {
        for (const column of SPACES_ANALYTICS_COLUMNS) {
          acc[column.key] += row[column.key];
        }
        return acc;
      },
      Object.fromEntries(
        SPACES_ANALYTICS_COLUMNS.map((c) => [c.key, 0]),
      ) as SpacesAnalytics['totals'],
    );

    // Ordem pedida (padrão: quem mais caiu em reservas primeiro); empate pelo nome e pelo id.
    const direction = query.order === 'desc' ? -1 : 1;
    const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      a.label.localeCompare(b.label, 'pt-BR') || a.key.localeCompare(b.key);
    const sorted = [...rows].sort((a, b) =>
      query.sort === 'name'
        ? direction * byName(a, b)
        : direction * (a[query.sort] - b[query.sort]) || byName(a, b),
    );

    return {
      period: { from: period.from, to: period.to },
      previousPeriod: { from: previous.from, to: previous.to },
      groupBy: 'space',
      timezone: TZ,
      columns: columnsOf(SPACES_ANALYTICS_COLUMNS),
      rows: sorted.slice(0, query.limit),
      totals,
      spacesCount: rows.length,
    };
  }
}
