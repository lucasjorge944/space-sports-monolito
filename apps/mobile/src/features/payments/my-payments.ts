import type { ListMyPaymentsStatusItem, MyPaymentPageItemsItem } from '@space-sports/api-client';
import { DEFAULT_TIME_ZONE, utcToZoned, weekdayOf } from '@space-sports/shared';
import { formatMonthYear, WEEKDAY_SHORT } from '@/lib/datetime';
import { methodShortLabel, refundReasonText } from './labels';

/** Filtros de Meus pagamentos (docs/05, "App — (6)"): a escolha vai para a API. */
export type PaymentsFilter = 'all' | 'paid' | 'refunds' | 'pending';

export const PAYMENT_FILTERS: { value: PaymentsFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'paid', label: 'Pagos' },
  { value: 'refunds', label: 'Estornos' },
  { value: 'pending', label: 'Aguardando' },
];

export function filterStatuses(filter: PaymentsFilter): ListMyPaymentsStatusItem[] | undefined {
  switch (filter) {
    case 'all':
      return undefined;
    case 'paid':
      return ['PAID', 'PARTIALLY_REFUNDED'];
    case 'refunds':
      return ['PARTIALLY_REFUNDED', 'REFUNDED'];
    case 'pending':
      return ['PENDING'];
  }
}

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const zonedDate = (iso: string) => utcToZoned(new Date(iso), DEFAULT_TIME_ZONE).date;

/** "Novembro de 2026" (mês da cobrança, em America/Sao_Paulo). */
export function monthTitle(iso: string): string {
  const date = zonedDate(iso);
  return `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} de ${date.slice(0, 4)}`;
}

/** "Reserva · Arena Beira-Mar" ou "Mensalidade nov · Arena Beira-Mar". */
export function paymentTitle(payment: Pick<MyPaymentPageItemsItem, 'item' | 'space'>): string {
  if (payment.item.type === 'SUBSCRIPTION_CHARGE' && payment.item.periodStart) {
    return `Mensalidade ${formatMonthYear(payment.item.periodStart).split(' ')[0]} · ${payment.space.name}`;
  }
  return `${payment.item.type === 'BOOKING' ? 'Reserva' : 'Mensalidade'} · ${payment.space.name}`;
}

/** "Sáb, 08/11 · Pix" (reserva: o dia do jogo) ou "05/11 · Cartão" (o dia do pagamento). */
export function paymentSubtitle(
  payment: Pick<MyPaymentPageItemsItem, 'item' | 'method' | 'cardLast4' | 'paidAt' | 'createdAt'>,
): string {
  const method = methodShortLabel(payment.method);
  if (payment.item.type === 'BOOKING' && payment.item.startsAt) {
    const date = zonedDate(payment.item.startsAt);
    return `${WEEKDAY_SHORT[weekdayOf(date)]}, ${date.slice(8, 10)}/${date.slice(5, 7)} · ${method}`;
  }
  const date = zonedDate(payment.paidAt ?? payment.createdAt);
  return `${date.slice(8, 10)}/${date.slice(5, 7)} · ${method}`;
}

/**
 * Motivo do estorno mais recente que não foi feito à mão pelo espaço (os automáticos, decisão 96,
 * e os de cancelamento): uma linha a mais na lista. O manual fica no comprovante.
 */
export function automaticRefundNote(
  payment: Pick<MyPaymentPageItemsItem, 'refunds'>,
): string | null {
  const refunds = payment.refunds ?? [];
  for (let i = refunds.length - 1; i >= 0; i--) {
    const refund = refunds[i];
    if (refund && refund.kind === 'REFUND' && refund.reasonCode !== 'MANUAL') {
      return refundReasonText(refund.reasonCode, refund.reason);
    }
  }
  return null;
}

export type PaymentRow =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'item'; key: string; payment: MyPaymentPageItemsItem; first: boolean; last: boolean };

/** Linhas da lista: um cabeçalho por mês e as cobranças do mês (já em ordem da API). */
export function groupByMonth(payments: MyPaymentPageItemsItem[]): PaymentRow[] {
  const rows: PaymentRow[] = [];
  let current: string | null = null;
  payments.forEach((payment, index) => {
    const title = monthTitle(payment.createdAt);
    if (title !== current) {
      current = title;
      rows.push({ kind: 'header', key: `h-${title}`, title });
    }
    const next = payments[index + 1];
    rows.push({
      kind: 'item',
      key: payment.id,
      payment,
      first: rows[rows.length - 1]?.kind === 'header',
      last: !next || monthTitle(next.createdAt) !== title,
    });
  });
  return rows;
}
