import { describe, expect, it } from 'vitest';
import {
  cancellationAccessUntil,
  chargePeriod,
  chargePeriodsToGenerate,
  daysBetween,
  isPastDue,
  isPeriodBillable,
  projectedDueDate,
  subscriptionChargeStatus,
} from './subscriptions';

const sub = (overrides: Partial<Parameters<typeof isPeriodBillable>[0]> = {}) => ({
  startsOn: '2026-11-05',
  endsOn: null,
  ...overrides,
});

describe('ciclo da mensalidade (decisão 25)', () => {
  it('é o mês do calendário, com vencimento no dia fixo', () => {
    expect(chargePeriod('2026-02-17', 10)).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      dueDate: '2026-02-10',
    });
    expect(chargePeriod('2026-12-31', 28).periodEnd).toBe('2026-12-31');
  });

  it('aprovado até o vencimento paga o mês cheio; depois, só a partir do mês seguinte', () => {
    expect(isPeriodBillable(sub({ startsOn: '2026-11-10' }), chargePeriod('2026-11-01', 10))).toBe(
      true,
    );
    expect(isPeriodBillable(sub({ startsOn: '2026-11-11' }), chargePeriod('2026-11-01', 10))).toBe(
      false,
    );
    expect(isPeriodBillable(sub({ startsOn: '2026-11-11' }), chargePeriod('2026-12-01', 10))).toBe(
      true,
    );
  });

  it('não cobra ciclo depois do fim (RN-CLASS-08)', () => {
    const december = chargePeriod('2026-12-01', 10);
    expect(isPeriodBillable(sub({ endsOn: '2026-11-30' }), december)).toBe(false);
    expect(isPeriodBillable(sub({ endsOn: '2026-12-31' }), december)).toBe(true);
  });

  it('gera o mês corrente e, com vencimento no começo do mês, o seguinte antes', () => {
    const s = sub({ startsOn: '2026-10-01' });
    expect(chargePeriodsToGenerate(s, 3, '2026-10-27').map((p) => p.dueDate)).toEqual([
      '2026-10-03',
    ]);
    expect(chargePeriodsToGenerate(s, 3, '2026-10-29').map((p) => p.dueDate)).toEqual([
      '2026-10-03',
      '2026-11-03',
    ]);
    expect(chargePeriodsToGenerate(s, 20, '2026-10-29').map((p) => p.dueDate)).toEqual([
      '2026-10-20',
    ]);
  });

  it('prevê o próximo vencimento ainda não gerado', () => {
    const s = sub({ startsOn: '2026-11-05' });
    expect(projectedDueDate(s, 10, '2026-11-05', new Set())).toBe('2026-11-10');
    expect(projectedDueDate(s, 10, '2026-11-05', new Set(['2026-11-01']))).toBe('2026-12-10');
    expect(projectedDueDate({ ...s, endsOn: '2026-11-30' }, 10, '2026-11-20', new Set())).toBe(
      null,
    );
  });
});

describe('status e atraso', () => {
  it('quitada é PAID; em aberto depois do vencimento é OVERDUE', () => {
    const charge = { amountCents: 100, dueDate: '2026-11-10' };
    expect(subscriptionChargeStatus(charge, 100, '2026-11-20')).toBe('PAID');
    expect(subscriptionChargeStatus(charge, 50, '2026-11-10')).toBe('PENDING');
    expect(subscriptionChargeStatus(charge, 50, '2026-11-11')).toBe('OVERDUE');
  });

  it('PAST_DUE só depois de X dias de atraso e com a regra ligada (RN-CLASS-06)', () => {
    const rule = { enabled: true, days: 7 };
    expect(daysBetween('2026-11-10', '2026-11-17')).toBe(7);
    expect(isPastDue('2026-11-10', '2026-11-17', rule)).toBe(false);
    expect(isPastDue('2026-11-10', '2026-11-18', rule)).toBe(true);
    expect(isPastDue('2026-11-10', '2026-11-18', { ...rule, enabled: false })).toBe(false);
    expect(isPastDue(null, '2026-11-18', rule)).toBe(false);
  });
});

describe('acesso de quem cancela (RN-CLASS-08, decisão 45)', () => {
  const november = { periodEnd: '2026-11-30', status: 'PAID' as const };
  const december = { periodEnd: '2026-12-31', status: 'PENDING' as const };

  it('vai até o fim do último mês pago ou dispensado, corrente ou futuro', () => {
    expect(cancellationAccessUntil([november, december], '2026-11-15')).toBe('2026-11-30');
    expect(cancellationAccessUntil([{ ...november, status: 'WAIVED' }], '2026-11-30')).toBe(
      '2026-11-30',
    );
    expect(
      cancellationAccessUntil(
        [
          { ...november, status: 'OVERDUE' },
          { ...december, status: 'PAID' },
        ],
        '2026-11-29',
      ),
    ).toBe('2026-12-31');
  });

  it('termina no ato sem mês coberto, inclusive na virada do mês', () => {
    expect(cancellationAccessUntil([], '2026-11-15')).toBeNull();
    expect(cancellationAccessUntil([december], '2026-12-05')).toBeNull();
    expect(cancellationAccessUntil([{ ...november, status: 'PENDING' }], '2026-11-15')).toBeNull();
    expect(cancellationAccessUntil([november], '2026-12-01')).toBeNull();
  });
});
