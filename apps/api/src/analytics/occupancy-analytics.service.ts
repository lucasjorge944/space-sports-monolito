import { Inject, Injectable } from '@nestjs/common';
import {
  type Interval,
  OCCUPANCY_ANALYTICS_COLUMNS,
  type OccupancyAnalytics,
  type OccupancyAnalyticsQuery,
  openingPeriods,
  utcToZoned,
} from '@space-sports/shared';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import { bookings, courtOccupations } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { activeCourts, bookingCounts } from './analytics-common.js';
import { eachHour, intersectIntervals, subtractIntervals } from './intervals.js';
import {
  type Bucket,
  columnsOf,
  fillRows,
  hoursOf,
  type ResolvedPeriod,
  ratio,
  resolvePeriod,
  timeBuckets,
  zonedBucketKey,
} from './period.js';

type Minutes = { open: number; blocked: number; booked: number; classes: number };
const zero = (): Minutes => ({ open: 0, blocked: 0, booked: 0, classes: 0 });

const values = (m: Minutes): OccupancyAnalytics['totals'] => {
  const available = m.open - m.blocked;
  return {
    openHours: hoursOf(m.open),
    blockedHours: hoursOf(m.blocked),
    availableHours: hoursOf(available),
    bookedHours: hoursOf(m.booked),
    classHours: hoursOf(m.classes),
    occupancyRate: ratio(m.booked, available),
    utilizationRate: ratio(m.booked + m.classes, available),
  };
};

/**
 * Ocupação das quadras ativas (docs/14-mcp.md 8.4): horas reservadas ÷ horas disponíveis, em que
 * disponível = funcionamento do espaço (o mesmo `space_opening_hours` da grade de horários,
 * `openingPeriods`) menos os bloqueios. Reservas e aulas contam só dentro do tempo disponível. As
 * ocupações vêm de `court_occupations` numa consulta; o recorte por hora é feito aqui.
 */
@Injectable()
export class OccupancyAnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async occupancy(spaceId: string, query: OccupancyAnalyticsQuery): Promise<OccupancyAnalytics> {
    const space = await this.spaces.load(spaceId);
    const period = resolvePeriod(query, space.timeZone);
    const courtList = await activeCourts(this.db, spaceId, query.courtId);
    const occupations = courtList.length
      ? await this.occupations(
          courtList.map((c) => c.id),
          period,
        )
      : [];

    const open = openingPeriods(period.from, period.to, space.openingHours, space.timeZone);
    const hourFilter = this.hourFilter(query, space.timeZone);
    const byGroup = new Map<string, Minutes>();
    const total = zero();

    for (const court of courtList) {
      const mine = occupations.filter((o) => o.courtId === court.id);
      const of = (kind: string) => mine.filter((o) => o.kind === kind).map((o) => o.period);
      const blocks = intersectIntervals(open, of('BLOCK'));
      const available = subtractIntervals(open, blocks);
      const pieces: [keyof Minutes, Interval[]][] = [
        ['open', open],
        ['blocked', blocks],
        ['booked', intersectIntervals(available, of('BOOKING'))],
        ['classes', intersectIntervals(available, of('CLASS'))],
      ];
      for (const [field, intervals] of pieces) {
        eachHour(intervals, (hourStart, minutes) => {
          const slot = hourFilter(hourStart);
          if (slot === null) return;
          const key = query.groupBy === 'court' ? court.id : slot;
          const acc = byGroup.get(key) ?? zero();
          acc[field] += minutes;
          byGroup.set(key, acc);
          total[field] += minutes;
        });
      }
    }

    return {
      period: { from: period.from, to: period.to },
      groupBy: query.groupBy,
      timezone: space.timeZone,
      columns: columnsOf(OCCUPANCY_ANALYTICS_COLUMNS),
      rows: fillRows(
        this.buckets(query, period, courtList),
        new Map([...byGroup].map(([key, m]) => [key, values(m)])),
        () => values(zero()),
      ),
      totals: values(total),
    };
  }

  /** Reservas que contam, aulas não canceladas e bloqueios ativos das quadras no período. */
  private occupations(courtIds: string[], period: ResolvedPeriod) {
    return this.db
      .select({
        courtId: courtOccupations.courtId,
        kind: courtOccupations.kind,
        period: courtOccupations.period,
      })
      .from(courtOccupations)
      .leftJoin(
        bookings,
        and(eq(courtOccupations.kind, 'BOOKING'), eq(bookings.id, courtOccupations.refId)),
      )
      .where(
        and(
          inArray(courtOccupations.courtId, courtIds),
          eq(courtOccupations.active, true),
          sql`${courtOccupations.period} && tstzrange(${period.start.toISOString()}::timestamptz, ${period.end.toISOString()}::timestamptz, '[)')`,
          or(ne(courtOccupations.kind, 'BOOKING'), bookingCounts()),
        ),
      );
  }

  /**
   * Hora cheia → chave do grupo de data (vazia no agrupamento por quadra), ou nulo se a hora está
   * fora dos filtros de dia da semana e faixa horária (datas e horas locais). Memorizado: cada hora
   * do período é convertida uma vez, e nenhuma quando não há filtro nem agrupamento por data.
   */
  private hourFilter(query: OccupancyAnalyticsQuery, timeZone: string) {
    const weekdays = query.weekday?.length ? new Set(query.weekday) : null;
    const from = query.hourFrom ?? 0;
    const to = query.hourTo ?? 24;
    const { groupBy } = query;
    if (groupBy === 'court' && !weekdays && from === 0 && to === 24) return () => '';
    const cache = new Map<number, string | null>();
    return (hourStart: number): string | null => {
      const cached = cache.get(hourStart);
      if (cached !== undefined) return cached;
      const local = utcToZoned(new Date(hourStart), timeZone);
      const hour = Math.floor(local.minuteOfDay / 60);
      const inside = (!weekdays || weekdays.has(local.weekday)) && hour >= from && hour < to;
      const key = !inside ? null : groupBy === 'court' ? '' : zonedBucketKey(groupBy, local);
      cache.set(hourStart, key);
      return key;
    };
  }

  /** Linhas: quadras ativas, ou o calendário do período restrito aos filtros de dia e hora. */
  private buckets(
    query: OccupancyAnalyticsQuery,
    period: { from: string; to: string },
    courtList: { id: string; name: string }[],
  ): Bucket[] {
    if (query.groupBy === 'court') return courtList.map((c) => ({ key: c.id, label: c.name }));
    const list = timeBuckets(query.groupBy, period);
    const weekdays = query.weekday?.length ? new Set(query.weekday) : null;
    if (query.groupBy === 'weekday' && weekdays) {
      return list.filter((b) => weekdays.has(Number(b.key)));
    }
    if (query.groupBy === 'hour') {
      return list.filter(
        (b) => Number(b.key) >= (query.hourFrom ?? 0) && Number(b.key) < (query.hourTo ?? 24),
      );
    }
    if (query.groupBy === 'day' && weekdays) {
      return list.filter((b) => weekdays.has(new Date(`${b.key}T12:00:00Z`).getUTCDay()));
    }
    return list;
  }
}
