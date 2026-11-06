import { describe, expect, it } from 'vitest';
import {
  defaultReportMonth,
  feeLiveExample,
  feeToForm,
  grossFeeShare,
  invoiceBase,
  monthLabel,
  nfseCsvFilename,
  parseDefaultFees,
  parseSpaceFees,
  parseSuperPaymentTab,
  recentMonths,
  revenueCsvFilename,
  sortRevenue,
} from './online-payments';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('taxas no Super (pontos-base como %, centavos como R$)', () => {
  it('converte para os campos', () => {
    expect(feeToForm({ pixFeeBps: 400, cardFeeBps: 450, minFeeCents: 100 })).toEqual({
      pix: '4',
      card: '4,5',
      min: '1,00',
    });
    expect(feeToForm({ pixFeeBps: null, cardFeeBps: 99, minFeeCents: null })).toEqual({
      pix: '',
      card: '0,99',
      min: '',
    });
  });

  it('lê a taxa padrão', () => {
    expect(parseDefaultFees({ pix: '4', card: '6,00', min: '1,00' })).toEqual({
      values: { pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100 },
      errors: {},
    });
    expect(parseDefaultFees({ pix: '101', card: '', min: '' }).errors).toEqual({
      pix: 'Informe um percentual entre 0% e 100%',
      card: 'Informe um percentual entre 0% e 100%',
      min: 'Informe um valor de R$ 0,00 ou mais',
    });
  });

  it('condição do espaço: vazio volta ao padrão (null)', () => {
    expect(parseSpaceFees({ pix: '3', card: '', min: '0,50' })).toEqual({
      values: { pixFeeBps: 300, cardFeeBps: null, minFeeCents: 50 },
      errors: {},
    });
    expect(parseSpaceFees({ pix: 'abc', card: '', min: '' }).errors.pix).toBeDefined();
  });

  it('exemplo ao vivo', () => {
    expect(nbsp(feeLiveExample({ pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100 }))).toBe(
      'R$ 100,00 no Pix → taxa R$ 4,00 · no cartão → taxa R$ 6,00',
    );
    // Calculado por meio: o Pix em 0% fica no mínimo, o cartão segue no percentual.
    expect(nbsp(feeLiveExample({ pixFeeBps: 0, cardFeeBps: 600, minFeeCents: 100 }))).toBe(
      'R$ 100,00 no Pix → taxa R$ 1,00 · no cartão → taxa R$ 6,00',
    );
    // Mínimo acima do percentual vale no meio em que ele é maior.
    expect(nbsp(feeLiveExample({ pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 500 }))).toBe(
      'R$ 100,00 no Pix → taxa R$ 5,00 · no cartão → taxa R$ 6,00',
    );
  });
});

describe('receita', () => {
  const row = (net: number, volume = 0) => ({
    chargesCount: 1,
    volumeCents: volume,
    grossFeeCents: 0,
    gatewayCostCents: 0,
    feeRefundedCents: 0,
    feeRechargedCents: 0,
    netRevenueCents: net,
  });

  it('ordena pela coluna', () => {
    const rows = [row(10), row(30), row(20)];
    expect(sortRevenue(rows, 'netRevenueCents', 'desc').map((r) => r.netRevenueCents)).toEqual([
      30, 20, 10,
    ]);
    expect(sortRevenue(rows, 'netRevenueCents', 'asc')[0]?.netRevenueCents).toBe(10);
  });

  it('taxa bruta sobre o volume e base da nota com a taxa recobrada', () => {
    expect(grossFeeShare({ volumeCents: 4_821_000, grossFeeCents: 234_460 })).toBe(
      '4,9% do volume',
    );
    expect(grossFeeShare({ volumeCents: 0, grossFeeCents: 0 })).toBe('—');
    expect(
      invoiceBase({ grossFeeCents: 1_000, feeRefundedCents: 200, feeRechargedCents: 50 }),
    ).toBe(850);
  });

  it('arquivos, meses e aba', () => {
    expect(revenueCsvFilename('2026-10-01', '2026-10-31')).toBe(
      'receita-pagamentos-2026-10-01_2026-10-31.csv',
    );
    expect(nfseCsvFilename('2026-10')).toBe('taxas-nfse-2026-10.csv');
    expect(monthLabel('2026-10')).toBe('out 2026');
    const now = new Date('2026-01-15T15:00:00Z');
    expect(recentMonths(3, now)).toEqual(['2026-01', '2025-12', '2025-11']);
    expect(defaultReportMonth(now)).toBe('2025-12');
    expect(parseSuperPaymentTab('simulador', false)).toBe('receita');
    expect(parseSuperPaymentTab('simulador', true)).toBe('simulador');
    expect(parseSuperPaymentTab('taxas', false)).toBe('taxas');
  });
});
