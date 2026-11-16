import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_MAX_RANGE_DAYS,
  analyticsDays,
  bookingAnalyticsQuerySchema,
  classAnalyticsQuerySchema,
  customerAnalyticsQuerySchema,
  occupancyAnalyticsQuerySchema,
  platformAnalyticsQuerySchema,
  previousAnalyticsPeriod,
  resolveAnalyticsPeriod,
  revenueAnalyticsQuerySchema,
  spacesAnalyticsQuerySchema,
} from './analytics';

describe('período das métricas (RN-MCP-09)', () => {
  it('padrão: os últimos 30 dias até hoje', () => {
    expect(resolveAnalyticsPeriod({}, '2026-11-12')).toEqual({
      from: '2026-10-14',
      to: '2026-11-12',
    });
    expect(resolveAnalyticsPeriod({ to: '2026-03-31' }, '2026-11-12')).toEqual({
      from: '2026-03-02',
      to: '2026-03-31',
    });
    expect(resolveAnalyticsPeriod({ from: '2026-11-01' }, '2026-11-12')).toEqual({
      from: '2026-11-01',
      to: '2026-11-12',
    });
  });

  it('aceita até 366 dias e recusa mais', () => {
    expect(analyticsDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(resolveAnalyticsPeriod({ from: '2025-11-12', to: '2026-11-12' }, '2026-11-12')).toEqual({
      from: '2025-11-12',
      to: '2026-11-12',
    });
    expect(analyticsDays('2025-11-12', '2026-11-12')).toBe(ANALYTICS_MAX_RANGE_DAYS);
    expect(resolveAnalyticsPeriod({ from: '2025-11-11', to: '2026-11-12' }, '2026-11-12')).toEqual({
      problem: 'PERIOD_TOO_LONG',
    });
    // Só `from`: o fim padrão é hoje, e o período também tem limite.
    expect(resolveAnalyticsPeriod({ from: '2024-01-01' }, '2026-11-12')).toEqual({
      problem: 'PERIOD_TOO_LONG',
    });
    expect(resolveAnalyticsPeriod({ from: '2026-12-01' }, '2026-11-12')).toEqual({
      problem: 'PERIOD_INVERTED',
    });
  });

  it('período anterior com a mesma duração', () => {
    expect(previousAnalyticsPeriod({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-10-02',
      to: '2026-10-31',
    });
  });

  it('valida a query: datas, agrupamento fechado e faixa horária', () => {
    expect(bookingAnalyticsQuerySchema.parse({})).toEqual({ groupBy: 'day' });
    expect(bookingAnalyticsQuerySchema.safeParse({ groupBy: 'sql' }).success).toBe(false);
    expect(bookingAnalyticsQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(
      bookingAnalyticsQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success,
    ).toBe(false);
    expect(
      occupancyAnalyticsQuerySchema.parse({ weekday: '2', hourFrom: '18', hourTo: '23' }),
    ).toEqual({
      groupBy: 'court',
      weekday: [2],
      hourFrom: 18,
      hourTo: 23,
    });
    expect(occupancyAnalyticsQuerySchema.safeParse({ hourFrom: '20', hourTo: '18' }).success).toBe(
      false,
    );
  });

  it('datas de 2000-01-01 a 2100-12-31 em todas as métricas (BUG-MCP2-2)', () => {
    const schemas = {
      bookings: bookingAnalyticsQuerySchema,
      occupancy: occupancyAnalyticsQuerySchema,
      classes: classAnalyticsQuerySchema,
      customers: customerAnalyticsQuerySchema,
      revenue: revenueAnalyticsQuerySchema,
      platform: platformAnalyticsQuerySchema,
      spaces: spacesAnalyticsQuerySchema,
    };
    for (const [name, schema] of Object.entries(schemas)) {
      const ok = (query: Record<string, string>) => schema.safeParse(query).success;
      expect(ok({ from: '2000-01-01', to: '2000-01-05' }), name).toBe(true);
      expect(ok({ from: '2100-12-25', to: '2100-12-31' }), name).toBe(true);
      const outOfRange: Record<string, string>[] = [
        { from: '0000-01-01', to: '0000-01-05' },
        { from: '0001-01-01', to: '0001-01-05' },
        { from: '1999-12-31' },
        { to: '1999-12-31' },
        { from: '2101-01-01' },
        { from: '9999-12-25', to: '9999-12-31' },
      ];
      for (const query of outOfRange) {
        expect(ok(query), `${name} ${JSON.stringify(query)}`).toBe(false);
      }
    }
  });
});
