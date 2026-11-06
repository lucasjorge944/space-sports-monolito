import type { ClassGroup, SubscriptionCharge } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/format';
import {
  canAddEnrollment,
  canCancelSubscription,
  cancelEffect,
  cancelledAccessLabel,
  canReceiveCharge,
  canResumeCancel,
  canWaiveCharge,
  chargeMonth,
  chargesCsvRows,
  classCountRule,
  defaultMonthRange,
  delinquentsCsvRows,
  eligibleClassGroups,
  formatRate,
  frequencyCsvRows,
  isClassSelectionValid,
  isFutureDate,
  lastDaysRange,
  occupancyRate,
  occupancyTotals,
  paidAtFromDate,
  sameSelection,
  unavailableRequested,
  waiveNote,
} from './subscriptions';

// 28/10/2026 15:00 em São Paulo.
const NOW = new Date('2026-10-28T18:00:00Z');

const sub = (status: string, weeklyFrequency: number | null, active: number) =>
  ({
    status,
    plan: { weeklyFrequency },
    enrollments: Array.from({ length: active }, (_, i) => ({ id: String(i), status: 'ACTIVE' })),
  }) as never;

describe('mensalidades', () => {
  it('formata o mês da mensalidade', () => {
    expect(chargeMonth('2026-10-01')).toBe('10/2026');
  });

  it('só recebe mensalidade em aberto com valor a receber', () => {
    expect(canReceiveCharge({ status: 'PENDING', dueCents: 100 })).toBe(true);
    expect(canReceiveCharge({ status: 'OVERDUE', dueCents: 100 })).toBe(true);
    expect(canReceiveCharge({ status: 'PAID', dueCents: 0 })).toBe(false);
    expect(canReceiveCharge({ status: 'WAIVED', dueCents: 100 })).toBe(false);
    expect(canReceiveCharge({ status: 'PENDING', dueCents: 0 })).toBe(false);
  });

  it('só dispensa mensalidade em aberto e sem pagamento', () => {
    expect(canWaiveCharge({ status: 'OVERDUE', paidCents: 0 })).toBe(true);
    expect(canWaiveCharge({ status: 'PENDING', paidCents: 5000 })).toBe(false);
    expect(canWaiveCharge({ status: 'PAID', paidCents: 18000 })).toBe(false);
    expect(canWaiveCharge({ status: 'WAIVED', paidCents: 0 })).toBe(false);
  });
});

describe('data do pagamento', () => {
  it('hoje ou vazio deixa a API usar o instante atual', () => {
    expect(paidAtFromDate('2026-10-28', NOW)).toBeUndefined();
    expect(paidAtFromDate('', NOW)).toBeUndefined();
  });

  it('data passada vira meio-dia de São Paulo em UTC', () => {
    expect(paidAtFromDate('2026-10-20', NOW)).toBe('2026-10-20T15:00:00.000Z');
  });

  it('detecta data futura pelo dia local (23h em SP ainda é hoje)', () => {
    const lateNight = new Date('2026-10-29T02:30:00Z'); // 28/10 23:30 em SP
    expect(isFutureDate('2026-10-28', lateNight)).toBe(false);
    expect(isFutureDate('2026-10-29', lateNight)).toBe(true);
  });
});

describe('turmas do aluno', () => {
  it('Nx/semana limita as matrículas ativas a N; ilimitado não limita', () => {
    expect(canAddEnrollment(sub('ACTIVE', 2, 1))).toBe(true);
    expect(canAddEnrollment(sub('ACTIVE', 2, 2))).toBe(false);
    expect(canAddEnrollment(sub('ACTIVE', null, 5))).toBe(true);
  });

  it('não matricula assinatura pendente nem cancelada', () => {
    expect(canAddEnrollment(sub('PENDING_APPROVAL', null, 0))).toBe(false);
    expect(canAddEnrollment(sub('CANCELLED', null, 0))).toBe(false);
    expect(canAddEnrollment(sub('PAST_DUE', 3, 1))).toBe(true);
  });

  it('valida a escolha de turmas pela frequência do plano', () => {
    expect(isClassSelectionValid(2, 2)).toBe(true);
    expect(isClassSelectionValid(2, 1)).toBe(false);
    expect(isClassSelectionValid(2, 3)).toBe(false);
    expect(isClassSelectionValid(null, 3)).toBe(true);
    expect(isClassSelectionValid(null, 0)).toBe(false);
    expect(classCountRule(null)).toBe('uma ou mais turmas');
    expect(classCountRule(1)).toBe('exatamente 1 turma');
    expect(classCountRule(2)).toBe('exatamente 2 turmas');
  });

  it('compara seleções sem depender da ordem', () => {
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false);
  });

  it('oferece só turmas ativas do esporte do plano', () => {
    const g = (id: string, sportId: string, active: boolean) =>
      ({ id, sport: { id: sportId }, active }) as unknown as ClassGroup;
    expect(
      eligibleClassGroups([g('1', 's1', true), g('2', 's1', false), g('3', 's2', true)], 's1').map(
        (x) => x.id,
      ),
    ).toEqual(['1']);
  });

  it('separa as turmas pedidas que já não são oferecidas (desativada ou de outro esporte)', () => {
    const requested = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    expect(unavailableRequested(requested, [{ id: '1' }, { id: '9' }])).toEqual([
      { id: '2', name: 'B' },
    ]);
    expect(unavailableRequested(requested, [{ id: '1' }, { id: '2' }])).toEqual([]);
    expect(unavailableRequested(requested, [])).toEqual(requested);
  });
});

describe('relatórios', () => {
  it('formata a taxa de frequência', () => {
    expect(formatRate(0.8571)).toBe('86%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(null)).toBe('—');
  });

  it('usa o mês corrente e os últimos dias no fuso do espaço', () => {
    expect(defaultMonthRange(NOW)).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(lastDaysRange(30, NOW)).toEqual({ from: '2026-09-29', to: '2026-10-28' });
    // 01:00Z do dia 1º ainda é o último dia do mês anterior em São Paulo.
    expect(defaultMonthRange(new Date('2026-11-01T01:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('calcula a ocupação por turma e no total (só ativas)', () => {
    const g = (over: Partial<ClassGroup>) =>
      ({ capacity: 12, enrolledCount: 4, availableSpots: 8, active: true, ...over }) as ClassGroup;
    expect(occupancyRate(g({}))).toBeCloseTo(1 / 3);
    expect(occupancyRate(g({ capacity: 0 }))).toBeNull();
    const totals = occupancyTotals([
      g({}),
      g({ capacity: 8, enrolledCount: 8, availableSpots: 0 }),
      g({ active: false, capacity: 50, enrolledCount: 0, availableSpots: 50 }),
    ]);
    expect(totals).toMatchObject({ groups: 2, capacity: 20, enrolled: 12, spots: 8, full: 1 });
    expect(totals.rate).toBeCloseTo(0.6);
  });

  it('monta o CSV de mensalidades em reais', () => {
    const { header, rows } = chargesCsvRows(
      [
        {
          student: { name: 'Ana' },
          plan: { name: 'Plano 2x' },
          periodStart: '2026-10-01',
          dueDate: '2026-10-10',
          amountCents: 18000,
          paidCents: 5000,
          dueCents: 13000,
          status: 'OVERDUE',
        } as never,
      ],
      () => 'Vencida',
    );
    expect(header).toHaveLength(rows[0]?.length ?? 0);
    expect(rows[0]).toEqual([
      'Ana',
      'Plano 2x',
      '10/2026',
      '10/10/2026',
      '180,00',
      '50,00',
      '130,00',
      'Vencida',
    ]);
  });

  it('monta o CSV de inadimplentes e de frequência', () => {
    const d = delinquentsCsvRows([
      {
        student: { name: 'Bia' },
        plan: { name: 'Plano' },
        overdueCount: 2,
        overdueCents: 36000,
        oldestDueDate: '2026-09-10',
        daysOverdue: 48,
      } as never,
    ]);
    expect(d.rows[0]).toEqual(['Bia', 'Plano', 2, '360,00', '10/09/2026', 48]);
    const f = frequencyCsvRows([
      { name: 'Caio', enrolled: false, present: 3, absent: 1, unmarked: 0, attendanceRate: 0.75 },
    ]);
    expect(f.rows[0]).toEqual(['Caio', 'Não', 3, 1, 0, '75%']);
    expect(f.header).toHaveLength(6);
  });
});

describe('cancelamento (decisão 45)', () => {
  const running = { status: 'ACTIVE', cancelAtPeriodEnd: false, accessUntil: null } as const;
  const leaving = { status: 'ACTIVE', cancelAtPeriodEnd: true, accessUntil: '2026-11-30' } as const;

  it('cancela só o que está em curso e ainda não foi cancelado', () => {
    expect(canCancelSubscription(running)).toBe(true);
    expect(canCancelSubscription({ ...running, status: 'PAST_DUE' })).toBe(true);
    expect(canCancelSubscription(leaving)).toBe(false);
    expect(canCancelSubscription({ ...running, status: 'CANCELLED' })).toBe(false);
    expect(canCancelSubscription({ ...running, status: 'PENDING_APPROVAL' })).toBe(false);
  });

  it('desfaz enquanto o acesso vale', () => {
    expect(canResumeCancel(leaving, '2026-11-30')).toBe(true);
    expect(canResumeCancel(leaving, '2026-12-01')).toBe(false);
    expect(canResumeCancel(running, '2026-11-01')).toBe(false);
    expect(canResumeCancel({ ...leaving, status: 'CANCELLED' }, '2026-11-01')).toBe(false);
  });

  it('rotula o acesso restante só enquanto a assinatura está em curso', () => {
    expect(cancelledAccessLabel(leaving)).toBe('Cancelado, com acesso até 30/11/2026');
    expect(cancelledAccessLabel(running)).toBeNull();
    expect(cancelledAccessLabel({ ...leaving, status: 'CANCELLED' })).toBeNull();
  });

  it('nulo em accessUntilIfCancelled significa que o acesso termina agora', () => {
    const none = { charges: [], overdueCents: 0 };
    expect(cancelEffect('Ana', { ...none, accessUntilIfCancelled: '2026-11-30' })).toContain(
      'Ana continua com acesso até 30/11/2026',
    );
    expect(cancelEffect('Ana', { ...none, accessUntilIfCancelled: null })).toContain(
      'O acesso de Ana termina agora',
    );
  });

  describe('cancelEffect com o acesso terminando agora (decisão 45)', () => {
    const now = new Date('2026-11-10T15:00:00Z');
    const charge = (over: Partial<SubscriptionCharge>) =>
      ({
        status: 'PENDING',
        periodStart: '2026-11-01',
        paidCents: 0,
        ...over,
      }) as SubscriptionCharge;
    const effect = (charges: SubscriptionCharge[], overdueCents = 0) =>
      cancelEffect('Ana', { accessUntilIfCancelled: null, charges, overdueCents }, now);

    it('dispensa a mensalidade do mês sem pagamento nenhum', () => {
      expect(effect([charge({})])).toContain('A mensalidade deste mês é dispensada.');
    });

    it('não promete dispensa com pagamento parcial: fica em aberto com o espaço', () => {
      const text = effect([charge({ paidCents: 5_000 })]);
      expect(text).toContain('pagamento parcial e fica em aberto');
      expect(text).not.toContain('dispensada');
    });

    it('sem mensalidade em aberto no mês, não fala de dispensa', () => {
      expect(effect([charge({ periodStart: '2026-10-01' })])).not.toContain('dispensada');
      expect(effect([charge({ status: 'PAID' })])).not.toContain('dispensada');
    });

    it('a mensalidade vencida continua devida, com o valor', () => {
      expect(effect([], 15_000)).toContain(
        `A mensalidade em atraso (${formatMoney(15_000)}) continua devida.`,
      );
    });
  });

  it('mostra o motivo só da mensalidade dispensada', () => {
    expect(waiveNote({ status: 'WAIVED', waiveReason: 'Bolsa' })).toBe('Motivo: Bolsa');
    expect(waiveNote({ status: 'WAIVED', waiveReason: null })).toBeNull();
    expect(waiveNote({ status: 'PENDING', waiveReason: 'Bolsa' })).toBeNull();
  });
});
