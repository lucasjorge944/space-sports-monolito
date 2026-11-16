import { Inject, Injectable } from '@nestjs/common';
import {
  BOOKING_ANALYTICS_COLUMNS,
  BOOKING_CHANNEL_LABELS,
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  type BookingAnalytics,
  type BookingAnalyticsGroupBy,
  type BookingAnalyticsQuery,
  type BookingStatus,
} from '@space-sports/shared';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import { bookings, courts, sports } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { activeCourts, bookingCounts, bookingCountsOrCancelled } from './analytics-common.js';
import {
  type Bucket,
  columnsOf,
  enumBuckets,
  fillRows,
  hoursOf,
  inPeriod,
  isTimeBucket,
  num,
  ratio,
  resolvePeriod,
  timeBucketSql,
  timeBuckets,
} from './period.js';

type Values = Omit<BookingAnalytics['totals'], never>;
type Sums = { bookings: number; minutes: number; noShows: number; cancelled: number };

const STATUS_LABELS: Partial<Record<BookingStatus, string>> = {
  CONFIRMED: BOOKING_STATUS_LABELS.CONFIRMED,
  COMPLETED: BOOKING_STATUS_LABELS.COMPLETED,
  NO_SHOW: BOOKING_STATUS_LABELS.NO_SHOW,
  CANCELLED: BOOKING_STATUS_LABELS.CANCELLED,
};

const values = (s: Sums): Values => ({
  bookings: s.bookings,
  hours: hoursOf(s.minutes),
  noShows: s.noShows,
  cancelled: s.cancelled,
  cancellationRate: ratio(s.cancelled, s.bookings + s.cancelled),
});

/**
 * Reservas e horas reservadas do espaço (docs/14-mcp.md 8.4), por data de início no fuso do
 * espaço. Uma consulta agregada; as quadras ativas completam as linhas por quadra.
 */
@Injectable()
export class BookingAnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async bookings(spaceId: string, query: BookingAnalyticsQuery): Promise<BookingAnalytics> {
    const { timeZone } = await this.spaces.load(spaceId);
    const period = resolvePeriod(query, timeZone);
    const { groupBy } = query;
    const counts = bookingCounts();

    const [rows, buckets] = await Promise.all([
      this.db
        .select({
          key: groupKey(groupBy, timeZone),
          label: groupLabel(groupBy),
          bookings: sql<number>`(count(*) FILTER (WHERE ${counts}))::int`,
          minutes: sql<string>`coalesce(sum(${bookings.durationMin}) FILTER (WHERE ${counts}), 0)::bigint`,
          noShows: sql<number>`(count(*) FILTER (WHERE ${bookings.status} = 'NO_SHOW'))::int`,
          cancelled: sql<number>`(count(*) FILTER (WHERE ${bookings.status} = 'CANCELLED'))::int`,
        })
        .from(bookings)
        .innerJoin(courts, eq(courts.id, bookings.courtId))
        .innerJoin(sports, eq(sports.id, bookings.sportId))
        .where(
          and(
            eq(bookings.spaceId, spaceId),
            inPeriod(bookings.startsAt, period),
            query.courtId ? eq(bookings.courtId, query.courtId) : undefined,
            query.sportId ? eq(bookings.sportId, query.sportId) : undefined,
            bookingCountsOrCancelled(),
          ),
        )
        .groupBy(sql`1`),
      this.buckets(groupBy, period, spaceId, query.courtId),
    ]);

    const sums = new Map<string, Sums>();
    const labels = new Map<string, string>();
    for (const row of rows) {
      sums.set(row.key, {
        bookings: row.bookings,
        minutes: num(row.minutes),
        noShows: row.noShows,
        cancelled: row.cancelled,
      });
      if (row.label) labels.set(row.key, row.label);
    }
    const total = [...sums.values()].reduce(
      (acc, s) => ({
        bookings: acc.bookings + s.bookings,
        minutes: acc.minutes + s.minutes,
        noShows: acc.noShows + s.noShows,
        cancelled: acc.cancelled + s.cancelled,
      }),
      { bookings: 0, minutes: 0, noShows: 0, cancelled: 0 },
    );

    return {
      period: { from: period.from, to: period.to },
      groupBy,
      timezone: timeZone,
      columns: columnsOf(BOOKING_ANALYTICS_COLUMNS),
      rows: fillRows(
        buckets,
        new Map([...sums].map(([key, s]) => [key, values(s)])),
        () => values({ bookings: 0, minutes: 0, noShows: 0, cancelled: 0 }),
        (key) => labels.get(key) ?? key,
      ),
      totals: values(total),
    };
  }

  private async buckets(
    groupBy: BookingAnalyticsGroupBy,
    period: { from: string; to: string },
    spaceId: string,
    courtId: string | undefined,
  ): Promise<Bucket[]> {
    if (isTimeBucket(groupBy)) return timeBuckets(groupBy, period);
    switch (groupBy) {
      case 'court':
        return (await activeCourts(this.db, spaceId, courtId)).map((c) => ({
          key: c.id,
          label: c.name,
        }));
      case 'source':
        return enumBuckets(BOOKING_SOURCE_LABELS);
      case 'channel':
        return enumBuckets(BOOKING_CHANNEL_LABELS);
      case 'status':
        return enumBuckets(STATUS_LABELS as Record<string, string>);
      default:
        // Esporte: só os que aparecem nos dados.
        return [];
    }
  }
}

function groupKey(groupBy: BookingAnalyticsGroupBy, timeZone: string): SQL<string> {
  if (isTimeBucket(groupBy)) return timeBucketSql(groupBy, bookings.startsAt, timeZone);
  const column = {
    court: bookings.courtId,
    sport: bookings.sportId,
    source: bookings.source,
    channel: bookings.channel,
    status: bookings.status,
  }[groupBy];
  return sql<string>`${column}::text`;
}

function groupLabel(groupBy: BookingAnalyticsGroupBy): SQL<string | null> {
  if (groupBy === 'court') return sql<string>`max(${courts.name})`;
  if (groupBy === 'sport') return sql<string>`max(${sports.name})`;
  return sql<null>`NULL`;
}
