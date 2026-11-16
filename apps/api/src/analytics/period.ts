import {
  type AnalyticsColumn,
  addDays,
  resolveAnalyticsPeriod,
  utcToZoned,
  WEEKDAY_LABELS,
  weekdayOf,
  type ZonedTime,
  zonedToUtc,
} from '@space-sports/shared';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { analyticsPeriodInverted, analyticsPeriodTooLong } from './analytics.errors.js';

/** Período resolvido: datas locais (inclusive) e os instantes UTC [start, end). */
export interface ResolvedPeriod {
  from: string;
  to: string;
  start: Date;
  end: Date;
  timeZone: string;
}

/** Período do pedido no fuso (padrão: os últimos 30 dias até hoje); erro 422 fora do limite. */
export function resolvePeriod(
  query: { from?: string | undefined; to?: string | undefined },
  timeZone: string,
  now = new Date(),
): ResolvedPeriod {
  const period = resolveAnalyticsPeriod(query, utcToZoned(now, timeZone).date);
  if ('problem' in period) {
    throw period.problem === 'PERIOD_TOO_LONG'
      ? analyticsPeriodTooLong()
      : analyticsPeriodInverted();
  }
  return withInstants(period, timeZone);
}

export function withInstants(period: { from: string; to: string }, timeZone: string) {
  return {
    ...period,
    start: zonedToUtc(period.from, 0, timeZone),
    end: zonedToUtc(addDays(period.to, 1), 0, timeZone),
    timeZone,
  };
}

/** `column` dentro do período: [start, end). */
export const inPeriod = (column: AnyColumn | SQL, period: Pick<ResolvedPeriod, 'start' | 'end'>) =>
  sql`${column} >= ${period.start.toISOString()}::timestamptz AND ${column} < ${period.end.toISOString()}::timestamptz`;

// ---------------------------------------------------------------------------------------------
// Agrupamento por data local

export type TimeBucket = 'day' | 'week' | 'month' | 'weekday' | 'hour';

export const isTimeBucket = (groupBy: string): groupBy is TimeBucket =>
  ['day', 'week', 'month', 'weekday', 'hour'].includes(groupBy);

/**
 * Chave do grupo de um instante no fuso, em SQL: dia `YYYY-MM-DD`, semana pela segunda-feira
 * `YYYY-MM-DD` (ISO), mês `YYYY-MM`, dia da semana `0`–`6` (domingo = 0) e hora `0`–`23`.
 */
export function timeBucketSql(
  bucket: TimeBucket,
  instant: AnyColumn | SQL,
  timeZone: string,
): SQL<string> {
  const local = sql`(${instant} AT TIME ZONE ${timeZone})`;
  switch (bucket) {
    case 'day':
      return sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
    case 'week':
      return sql<string>`to_char(date_trunc('week', ${local}), 'YYYY-MM-DD')`;
    case 'month':
      return sql<string>`to_char(${local}, 'YYYY-MM')`;
    case 'weekday':
      return sql<string>`extract(dow from ${local})::int::text`;
    case 'hour':
      return sql<string>`extract(hour from ${local})::int::text`;
  }
}

/** Mesma chave de `timeBucketSql`, calculada no TypeScript a partir da data e hora locais. */
export function zonedBucketKey(bucket: TimeBucket, local: ZonedTime): string {
  switch (bucket) {
    case 'day':
      return local.date;
    case 'week':
      return mondayOf(local.date);
    case 'month':
      return local.date.slice(0, 7);
    case 'weekday':
      return String(local.weekday);
    case 'hour':
      return String(Math.floor(local.minuteOfDay / 60));
  }
}

const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const brDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

export interface Bucket {
  key: string;
  label: string;
}

/**
 * Todos os grupos do período, em ordem, para a série sair contínua (grupos sem dado com zero).
 * Semanas e meses podem começar antes de `from` ou terminar depois de `to`: só os dias do
 * período contam.
 */
export function timeBuckets(bucket: TimeBucket, period: { from: string; to: string }): Bucket[] {
  switch (bucket) {
    case 'day': {
      const list: Bucket[] = [];
      for (let day = period.from; day <= period.to; day = addDays(day, 1)) {
        list.push({ key: day, label: brDate(day) });
      }
      return list;
    }
    case 'week': {
      const list: Bucket[] = [];
      for (let day = mondayOf(period.from); day <= period.to; day = addDays(day, 7)) {
        list.push({ key: day, label: `semana de ${brDate(day)}` });
      }
      return list;
    }
    case 'month': {
      const list: Bucket[] = [];
      let [year, month] = period.from.split('-').map(Number) as [number, number];
      const last = period.to.slice(0, 7);
      for (;;) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (key > last) return list;
        list.push({ key, label: `${MONTHS[month - 1]}/${year}` });
        month += 1;
        if (month > 12) [year, month] = [year + 1, 1];
      }
    }
    case 'weekday':
      return WEEKDAY_LABELS.map((label, weekday) => ({ key: String(weekday), label }));
    case 'hour':
      return Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${hour}h` }));
  }
}

/** Grupos de uma lista de valores com rótulo (enum). */
export const enumBuckets = <K extends string>(labels: Record<K, string>): Bucket[] =>
  (Object.entries(labels) as [K, string][]).map(([key, label]) => ({ key, label }));

// ---------------------------------------------------------------------------------------------
// Números

/** Somas e contagens vêm como `bigint`/`numeric` (string no driver). */
export const num = (value: unknown) => Number(value ?? 0);

/** Minutos → horas, com 2 casas. */
export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Razão de 0 a 1 com 4 casas; nula sem denominador. */
export const ratio = (part: number, whole: number) =>
  whole > 0 ? Math.round(Math.min(Math.max(part / whole, 0), 1) * 10_000) / 10_000 : null;

/** Colunas do contrato (sem o `as const` dos rótulos). */
export const columnsOf = (list: readonly AnalyticsColumn[]): AnalyticsColumn[] =>
  list.map((column) => ({ ...column }));

/**
 * Linhas na ordem dos grupos conhecidos (com `empty()` onde não há dado), seguidas dos grupos que
 * só apareceram nos dados (ex.: quadra já removida).
 */
export function fillRows<V extends object>(
  buckets: readonly Bucket[],
  found: ReadonlyMap<string, V>,
  empty: () => V,
  labelOf: (key: string) => string = (key) => key,
): ({ key: string; label: string } & V)[] {
  const known = new Set(buckets.map((bucket) => bucket.key));
  return [
    ...buckets.map((bucket) => ({ ...bucket, ...(found.get(bucket.key) ?? empty()) })),
    ...[...found.entries()]
      .filter(([key]) => !known.has(key))
      .map(([key, values]) => ({ key, label: labelOf(key), ...values })),
  ];
}
