import {
  bpsToInput,
  calculatePlatformFee,
  centsToInput,
  parseMoneyToCents,
  parsePercentToBps,
} from '@space-sports/shared';
import { formatMoney, todayLocal } from '@/lib/format';

// Pagamento online no /super (RF-ONPAY-10 a 12): abas, taxas em pontos-base e receita.

export const SUPER_PAYMENT_TABS = ['receita', 'taxas', 'cadastros', 'simulador'] as const;
export type SuperPaymentTab = (typeof SUPER_PAYMENT_TABS)[number];

/** Aba da URL (`?aba=`); o simulador só vale quando a API expõe as rotas. */
export function parseSuperPaymentTab(
  value: string | null | undefined,
  simulator: boolean,
): SuperPaymentTab {
  const tab = SUPER_PAYMENT_TABS.includes(value as SuperPaymentTab)
    ? (value as SuperPaymentTab)
    : 'receita';
  return tab === 'simulador' && !simulator ? 'receita' : tab;
}

// ---------------------------------------------------------------------------------------------
// Taxas

export type FeeForm = { pix: string; card: string; min: string };
export type FeeValues = { pixFeeBps: number; cardFeeBps: number; minFeeCents: number };
export type FeeFormErrors = Partial<Record<keyof FeeForm, string>>;

const PERCENT_ERROR = 'Informe um percentual entre 0% e 100%';
const MONEY_ERROR = 'Informe um valor de R$ 0,00 ou mais';

/** Pontos-base e centavos → campos (`450` → `4,5`; `100` → `1,00`). */
export function feeToForm(fee: {
  pixFeeBps: number | null;
  cardFeeBps: number | null;
  minFeeCents: number | null;
}): FeeForm {
  return {
    pix: bpsToInput(fee.pixFeeBps),
    card: bpsToInput(fee.cardFeeBps),
    min: fee.minFeeCents === null ? '' : centsToInput(fee.minFeeCents),
  };
}

const parsePercent = parsePercentToBps;

/** Taxa padrão: os três campos obrigatórios. */
export function parseDefaultFees(form: FeeForm): { values?: FeeValues; errors: FeeFormErrors } {
  const pix = parsePercent(form.pix);
  const card = parsePercent(form.card);
  const min = form.min.trim() ? parseMoneyToCents(form.min) : null;
  const errors: FeeFormErrors = {};
  if (pix === null) errors.pix = PERCENT_ERROR;
  if (card === null) errors.card = PERCENT_ERROR;
  if (min === null || min < 0) errors.min = MONEY_ERROR;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    values: { pixFeeBps: pix as number, cardFeeBps: card as number, minFeeCents: min as number },
    errors,
  };
}

/** Condição do espaço: campo vazio = taxa padrão (`null` na API). */
export function parseSpaceFees(form: FeeForm): {
  values?: { pixFeeBps: number | null; cardFeeBps: number | null; minFeeCents: number | null };
  errors: FeeFormErrors;
} {
  const errors: FeeFormErrors = {};
  const read = (key: keyof FeeForm, parse: (t: string) => number | null, message: string) => {
    const text = form[key].trim();
    if (!text) return null;
    const value = parse(text);
    if (value === null || value < 0) errors[key] = message;
    return value;
  };
  const pixFeeBps = read('pix', parsePercent, PERCENT_ERROR);
  const cardFeeBps = read('card', parsePercent, PERCENT_ERROR);
  const minFeeCents = read('min', parseMoneyToCents, MONEY_ERROR);
  if (Object.keys(errors).length > 0) return { errors };
  return { values: { pixFeeBps, cardFeeBps, minFeeCents }, errors };
}

/**
 * Exemplo ao vivo da taxa padrão, calculado por meio com a regra da API (percentual com o mínimo,
 * até o valor): "R$ 100,00 no Pix → taxa R$ 4,00 · no cartão → taxa R$ 6,00". Um meio em 0% mostra
 * o mínimo daquele meio.
 */
export function feeLiveExample(values: FeeValues): string {
  const base = 10_000;
  const fee = (bps: number) =>
    formatMoney(calculatePlatformFee(base, { bps, minFeeCents: values.minFeeCents }));
  return `${formatMoney(base)} no Pix → taxa ${fee(values.pixFeeBps)} · no cartão → taxa ${fee(values.cardFeeBps)}`;
}

// ---------------------------------------------------------------------------------------------
// Receita

export type RevenueRow = {
  chargesCount: number;
  volumeCents: number;
  grossFeeCents: number;
  gatewayCostCents: number;
  feeRefundedCents: number;
  feeRechargedCents: number;
  netRevenueCents: number;
};

export type RevenueSortKey = keyof RevenueRow;

/** Ordena as linhas por uma coluna numérica (padrão da tela: líquida decrescente). */
export function sortRevenue<T extends RevenueRow>(
  rows: T[],
  key: RevenueSortKey,
  direction: 'asc' | 'desc',
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (a[key] - b[key]));
}

/** "4,9% do volume" (taxa bruta sobre o volume, uma casa). */
export function grossFeeShare(totals: { volumeCents: number; grossFeeCents: number }): string {
  if (totals.volumeCents <= 0) return '—';
  const tenths = Math.round((totals.grossFeeCents * 1000) / totals.volumeCents);
  return `${Math.trunc(tenths / 10)},${tenths % 10}% do volume`;
}

/** Base da NFS-e (decisão 91): taxa bruta − devolvida + recobrada. */
export function invoiceBase(row: {
  grossFeeCents: number;
  feeRefundedCents: number;
  feeRechargedCents: number;
}): number {
  return row.grossFeeCents - row.feeRefundedCents + row.feeRechargedCents;
}

export function revenueCsvFilename(from: string, to: string): string {
  return `receita-pagamentos-${from}_${to}.csv`;
}

export function nfseCsvFilename(month: string): string {
  return `taxas-nfse-${month}.csv`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-10` → `out 2026`. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${year}`;
}

/** Os últimos `count` meses (o atual primeiro), em `AAAA-MM`, para o relatório da NFS-e. */
export function recentMonths(count = 12, now: Date = new Date()): string[] {
  const [y, m] = todayLocal(now).split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const index = y * 12 + (m - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

/** O mês anterior é o padrão do relatório (a nota sai depois do mês fechado). */
export function defaultReportMonth(now: Date = new Date()): string {
  return recentMonths(2, now)[1] as string;
}

/** Período padrão da receita: do dia 1º do mês até hoje. */
export function defaultRevenueRange(now: Date = new Date()): { from: string; to: string } {
  const to = todayLocal(now);
  return { from: `${to.slice(0, 8)}01`, to };
}
