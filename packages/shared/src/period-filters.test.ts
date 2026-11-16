import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { adReportQuerySchema } from './ads';
import {
  classAttendancesQuerySchema,
  classGroupFrequencyQuerySchema,
  myClassSessionsQuerySchema,
} from './attendance';
import { availabilityQuerySchema, localDateSchema, periodDateSchema } from './booking';
import { classSessionsQuerySchema } from './classes';
import { monthlyFeeReportQuerySchema, platformRevenueQuerySchema } from './payments';
import { auditLogQuerySchema, financeQuerySchema, superMetricsQuerySchema } from './super';

// BUG-MCP2-2 (revisão da MCP2.9): todo `from`/`to` de query com data vai de 2000-01-01 a 2100-12-31.

const OUT_OF_RANGE = ['0000-01-01', '0001-01-05', '1999-12-31', '2101-01-01', '9999-12-31'];

describe('periodDateSchema', () => {
  it('aceita de 2000-01-01 a 2100-12-31 e recusa fora disso', () => {
    expect(periodDateSchema.safeParse('2000-01-01').success).toBe(true);
    expect(periodDateSchema.safeParse('2026-11-12').success).toBe(true);
    expect(periodDateSchema.safeParse('2100-12-31').success).toBe(true);
    for (const date of OUT_OF_RANGE)
      expect(periodDateSchema.safeParse(date).success, date).toBe(false);
    expect(periodDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('o localDateSchema (nascimento etc.) segue sem a faixa', () => {
    expect(localDateSchema.safeParse('1930-05-01').success).toBe(true);
  });
});

describe('queries com período usam a faixa', () => {
  const schemas: Record<string, z.ZodType> = {
    classSessions: classSessionsQuerySchema,
    myClassSessions: myClassSessionsQuerySchema,
    classAttendances: classAttendancesQuerySchema,
    classGroupFrequency: classGroupFrequencyQuerySchema,
    adReport: adReportQuerySchema,
    platformRevenue: platformRevenueQuerySchema,
    finance: financeQuerySchema,
    superMetrics: superMetricsQuerySchema,
    auditLogs: auditLogQuerySchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(name, () => {
      expect(schema.safeParse({ from: '2000-01-01', to: '2000-01-05' }).success).toBe(true);
      expect(schema.safeParse({ from: '2100-12-25', to: '2100-12-31' }).success).toBe(true);
      for (const date of OUT_OF_RANGE) {
        expect(schema.safeParse({ from: date }).success, `from=${date}`).toBe(false);
        expect(schema.safeParse({ to: date }).success, `to=${date}`).toBe(false);
      }
    });
  }

  it('disponibilidade: `date` na faixa', () => {
    const query = { durationMin: '60', sportId: '00000000-0000-4000-8000-000000000000' };
    expect(availabilityQuerySchema.safeParse({ ...query, date: '2026-11-12' }).success).toBe(true);
    for (const date of OUT_OF_RANGE) {
      expect(availabilityQuerySchema.safeParse({ ...query, date }).success, date).toBe(false);
    }
  });

  it('relatório mensal do Super: `month` de 2000-01 a 2100-12', () => {
    for (const month of ['2000-01', '2026-11', '2100-12']) {
      expect(monthlyFeeReportQuerySchema.safeParse({ month }).success, month).toBe(true);
    }
    for (const month of ['0000-01', '1999-12', '2101-01', '9999-12']) {
      expect(monthlyFeeReportQuerySchema.safeParse({ month }).success, month).toBe(false);
    }
  });
});
