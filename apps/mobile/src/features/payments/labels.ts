import type {
  MyPaymentDetailRefundsItemReasonCode,
  PlayerOnlineChargeMethod,
  PlayerOnlineChargeStatus,
} from '@space-sports/api-client';
import {
  BOOKING_PAYMENT_ABANDONED_REASON,
  BOOKING_PAYMENT_EXPIRED_REASON,
} from '@space-sports/shared';

type Tone = 'muted' | 'success' | 'warning' | 'destructive' | 'info';

/**
 * Status da cobrança online (docs/05, "Pagamento online · Status, rótulos e tons"): o mesmo rótulo
 * no app e no painel, sempre com texto (nunca só a cor).
 */
export const ONLINE_CHARGE_STATUS_LABELS: Record<
  PlayerOnlineChargeStatus,
  { label: string; variant: Tone }
> = {
  PENDING: { label: 'Aguardando pagamento', variant: 'warning' },
  PAID: { label: 'Pago', variant: 'success' },
  EXPIRED: { label: 'Vencido', variant: 'muted' },
  FAILED: { label: 'Recusado', variant: 'destructive' },
  CANCELLED: { label: 'Cancelado', variant: 'muted' },
  PARTIALLY_REFUNDED: { label: 'Estorno parcial', variant: 'info' },
  REFUNDED: { label: 'Estornado', variant: 'info' },
  CHARGEBACK: { label: 'Contestado no cartão', variant: 'destructive' },
};

export const ONLINE_METHOD_LABELS: Record<PlayerOnlineChargeMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão de crédito',
};

/** "Pix", "Cartão" ou "Cartão final 1111". */
export function methodShortLabel(method: PlayerOnlineChargeMethod, last4?: string | null): string {
  if (method === 'PIX') return 'Pix';
  return last4 ? `Cartão final ${last4}` : 'Cartão';
}

/** "Pix" ou "Cartão de crédito final 1111" (comprovante). */
export function methodLongLabel(method: PlayerOnlineChargeMethod, last4?: string | null): string {
  if (method === 'PIX') return 'Pix';
  return last4 ? `Cartão de crédito final ${last4}` : 'Cartão de crédito';
}

/** Para onde volta o estorno, pelo meio. */
export function refundDestination(method: PlayerOnlineChargeMethod): string {
  return method === 'PIX'
    ? 'Volta para o mesmo Pix.'
    : 'No cartão, pode aparecer na fatura seguinte.';
}

/**
 * Motivo do estorno visto pelo jogador. O manual mostra o texto do espaço entre aspas; os
 * automáticos (decisão 96) dizem o porquê.
 */
export function refundReasonText(
  reasonCode: MyPaymentDetailRefundsItemReasonCode,
  reason: string | null,
): string {
  switch (reasonCode) {
    case 'PAID_AFTER_DEADLINE':
      return 'Estorno automático: o pagamento chegou depois do prazo';
    case 'PAID_AFTER_METHOD_CHANGE':
      return 'Estorno automático: o pagamento chegou depois da troca da forma de pagamento';
    case 'ITEM_ALREADY_PAID':
      return 'Estorno automático: o pagamento chegou com o item já pago';
    case 'BOOKING_CANCELLED_BY_PLAYER':
      return 'Reserva cancelada por você';
    case 'BOOKING_CANCELLED_BY_SPACE':
      return 'Reserva cancelada pelo espaço';
    case 'ACCOUNT_DELETED':
      return 'Exclusão da conta';
    case 'CHARGEBACK':
      return 'Contestação no cartão';
    case 'EXTERNAL':
      return reason ? `“${reason}”` : 'Estorno feito pelo parceiro de pagamentos';
    case 'MANUAL':
      return reason ? `“${reason}”` : 'Estorno feito pelo espaço';
  }
}

/** Motivo da reserva cancelada, em PT-BR (os códigos do pagamento online viram texto). */
export function bookingCancelReasonText(cancelReason: string | null): string | null {
  if (cancelReason === BOOKING_PAYMENT_EXPIRED_REASON) return 'Pagamento não feito no prazo';
  if (cancelReason === BOOKING_PAYMENT_ABANDONED_REASON) return 'Você desistiu antes de pagar.';
  return cancelReason;
}
