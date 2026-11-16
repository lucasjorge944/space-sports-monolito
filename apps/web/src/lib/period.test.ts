import { describe, expect, it } from 'vitest';
import { clampPeriodDate, periodDateParam } from './period';

describe('periodDateParam', () => {
  it('aceita datas dentro da faixa da API', () => {
    expect(periodDateParam('2026-11-12', '2026-01-01')).toBe('2026-11-12');
    expect(periodDateParam('2000-01-01', '2026-01-01')).toBe('2000-01-01');
    expect(periodDateParam('2100-12-31', '2026-01-01')).toBe('2100-12-31');
  });

  it('cai no padrão fora da faixa, em datas inexistentes e em lixo', () => {
    for (const raw of [
      '9999-12-31',
      '1999-12-31',
      '2101-01-01',
      '2026-02-30',
      'ontem',
      '',
      null,
      undefined,
    ]) {
      expect(periodDateParam(raw, '2026-01-01'), String(raw)).toBe('2026-01-01');
    }
  });
});

describe('clampPeriodDate', () => {
  it('prende nos limites e mantém o que está dentro', () => {
    expect(clampPeriodDate('2101-01-03')).toBe('2100-12-31');
    expect(clampPeriodDate('1999-12-30')).toBe('2000-01-01');
    expect(clampPeriodDate('2026-11-12')).toBe('2026-11-12');
  });
});
