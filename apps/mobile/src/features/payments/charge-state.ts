import type { BookingStatus, PlayerOnlineCharge } from '@space-sports/api-client';
import {
  BOOKING_PAYMENT_ABANDONED_REASON,
  BOOKING_PAYMENT_EXPIRED_REASON,
} from '@space-sports/shared';

/**
 * O que está sendo pago (docs/05, "App — (2) Tela do Pix"): a reserva no modo obrigatório (o
 * horário fica guardado até `paymentDueAt`), a reserva no modo opcional (já confirmada) ou a
 * mensalidade (Pix de 24 h).
 */
export type PayableKind = 'required' | 'optional' | 'subscription';

export interface BookingContext {
  status: BookingStatus;
  cancelReason: string | null;
  paymentDueAt: string | null;
  /** Já quitada (no local ou online): nada a pagar. */
  fullyPaid: boolean;
}

export function bookingPayableKind(booking: {
  status: BookingStatus;
  cancelReason: string | null;
  paymentDueAt: string | null;
}): PayableKind {
  if (booking.status === 'PENDING_PAYMENT' || booking.paymentDueAt) return 'required';
  if (
    booking.cancelReason === BOOKING_PAYMENT_EXPIRED_REASON ||
    booking.cancelReason === BOOKING_PAYMENT_ABANDONED_REASON
  ) {
    return 'required';
  }
  return 'optional';
}

export type ChargeView =
  | { screen: 'loading' }
  /** Criando a cobrança ou esperando o QR (cobrança pendente de verificação). */
  | { screen: 'generating' }
  /** Pix pendente com o código: a tela de pagar. `checking` quando a contagem chegou a zero. */
  | { screen: 'pix'; charge: PlayerOnlineCharge; checking: boolean }
  /** Cartão em processamento. */
  | { screen: 'processing'; charge: PlayerOnlineCharge }
  /**
   * Formulário do cartão, com a recusa da última tentativa desta tela (`declined`) ou a tentativa
   * que não se concluiu (`interrupted`: a cobrança enviada foi cancelada ou venceu sem cobrar).
   */
  | { screen: 'card-form'; declined: PlayerOnlineCharge | null; interrupted?: boolean }
  | { screen: 'paid'; charge: PlayerOnlineCharge }
  /** Prazo da reserva obrigatória acabou (ou ela foi cancelada antes de pagar). */
  | { screen: 'hold-expired' }
  /** O Pix venceu, mas o item ainda aceita pagamento (opcional, mensalidade ou hold no prazo). */
  | { screen: 'pix-expired'; charge: PlayerOnlineCharge }
  /**
   * Depois da geração automática desta tela, o Pix não está utilizável (cancelado, por exemplo,
   * pela troca de meio em outro aparelho): estado final com "Gerar novo Pix", nunca "Gerando…".
   */
  | { screen: 'pix-closed'; charge: PlayerOnlineCharge | null }
  /** Pago depois do prazo ou numa cobrança trocada: estornado sozinho (decisão 96). */
  | {
      screen: 'late-refund';
      charge: PlayerOnlineCharge;
      /** Motivo do estorno automático (da API); nulo enquanto o estorno não foi registrado. */
      reason: LateRefundReason | null;
      bookingCancelled: boolean;
    }
  /** Estornada ou contestada (fora do fluxo de pagar): o comprovante explica. */
  | { screen: 'refunded'; charge: PlayerOnlineCharge }
  /** Nada a pagar (quitada no local, por exemplo). */
  | { screen: 'nothing-due' }
  /** A cobrança não foi criada (erro ao gerar). */
  | { screen: 'error'; message: string };

export interface ChargeViewInput {
  mode: 'pix' | 'card';
  kind: PayableKind;
  /** Cobrança mais recente do item (`undefined` carregando; `null` sem cobrança, 404). */
  charge: PlayerOnlineCharge | null | undefined;
  booking?: BookingContext | null;
  /** Quanto falta no prazo que vale para a tela (hold ou validade do Pix), no relógio do servidor. */
  remainingMs: number | null;
  /** Uma criação está em andamento. */
  creating: boolean;
  /**
   * O item não tem mais o que pagar: reserva ou mensalidade quitada, dispensada, sem saldo, ou a
   * API respondeu `ALREADY_PAID`.
   */
  settled?: boolean;
  /** A tela já gerou o Pix sozinha uma vez (não gera de novo sem um toque). */
  autoCreateUsed?: boolean;
  /** Erro da última criação (mensagem para o estado de erro). */
  createError: string | null;
  /** Ids das cobranças de cartão enviadas nesta tela (a recusa só aparece para elas). */
  submittedCardIds: readonly string[];
  /**
   * Estornos da cobrança (de Meus pagamentos), quando ela foi paga e fechada ou estornada:
   * `undefined` enquanto carregam. O motivo (`reasonCode`) diz se foi o estorno automático.
   */
  refunds?: readonly { reasonCode: string }[];
}

/** Estornos automáticos de pagamento que chegou tarde (decisão 96). */
export const LATE_REFUND_REASONS = [
  'PAID_AFTER_DEADLINE',
  'PAID_AFTER_METHOD_CHANGE',
  'ITEM_ALREADY_PAID',
] as const;
export type LateRefundReason = (typeof LATE_REFUND_REASONS)[number];

const CLOSED_UNPAID = new Set(['EXPIRED', 'CANCELLED']);

/** A cobrança foi paga e depois fechada ou estornada: os estornos dizem o porquê. */
export function needsRefundReasons(charge: PlayerOnlineCharge | null | undefined): boolean {
  return Boolean(
    charge?.paidAt &&
      (CLOSED_UNPAID.has(charge.status) ||
        charge.status === 'REFUNDED' ||
        charge.status === 'PARTIALLY_REFUNDED'),
  );
}

/** O motivo do estorno automático, pelo `reasonCode` da API. */
export function lateRefundReason(
  refunds: readonly { reasonCode: string }[] | undefined,
): LateRefundReason | null {
  const late = (refunds ?? []).find((r) =>
    (LATE_REFUND_REASONS as readonly string[]).includes(r.reasonCode),
  );
  return (late?.reasonCode as LateRefundReason | undefined) ?? null;
}

/** A reserva obrigatória perdeu o horário (cancelada pelo prazo ou por desistência). */
function holdLost(booking: BookingContext | null | undefined): boolean {
  return (
    booking?.status === 'CANCELLED' &&
    (booking.cancelReason === BOOKING_PAYMENT_EXPIRED_REASON ||
      booking.cancelReason === BOOKING_PAYMENT_ABANDONED_REASON)
  );
}

/**
 * Estado da tela de pagamento (Pix ou cartão) a partir da cobrança e do item. Puro: a tela só
 * desenha o que sair daqui.
 */
export function deriveChargeView(input: ChargeViewInput): ChargeView {
  const { charge, booking, kind, mode } = input;
  if (charge === undefined)
    return input.creating ? { screen: 'generating' } : { screen: 'loading' };

  if (charge && needsRefundReasons(charge)) {
    // Paga e fechada ou estornada: o motivo vem dos estornos (espera carregá-los).
    if (input.refunds === undefined) return { screen: 'loading' };
    const reason = lateRefundReason(input.refunds);
    // Paga numa cobrança fechada é sempre estornada sozinha, mesmo antes do estorno aparecer.
    if (reason || CLOSED_UNPAID.has(charge.status)) {
      return {
        screen: 'late-refund',
        charge,
        reason,
        bookingCancelled: booking?.status === 'CANCELLED',
      };
    }
  }

  if (charge) {
    if (charge.status === 'PAID') return { screen: 'paid', charge };
    if (
      charge.status === 'REFUNDED' ||
      charge.status === 'PARTIALLY_REFUNDED' ||
      charge.status === 'CHARGEBACK'
    ) {
      return { screen: 'refunded', charge };
    }
  }

  // Reserva obrigatória que perdeu o horário: nada mais a pagar.
  if (kind === 'required' && holdLost(booking)) return { screen: 'hold-expired' };
  // Quitada por outro caminho (no local), dispensada, sem saldo ou reserva cancelada/encerrada.
  if (
    input.settled ||
    (booking &&
      (booking.fullyPaid ||
        booking.status === 'CANCELLED' ||
        booking.status === 'COMPLETED' ||
        booking.status === 'NO_SHOW'))
  ) {
    return { screen: 'nothing-due' };
  }

  const holdOver =
    kind === 'required' && booking?.status === 'PENDING_PAYMENT' && input.remainingMs === 0;

  if (charge?.status === 'PENDING') {
    if (charge.method === 'CARD') return { screen: 'processing', charge };
    if (mode === 'pix') {
      if (!charge.pix) return { screen: 'generating' };
      // Contagem em zero: "Conferindo…" até a API dizer se pagou ou venceu.
      return { screen: 'pix', charge, checking: input.remainingMs === 0 };
    }
  }

  if (holdOver) {
    // A leitura da reserva vence o hold (RN-ONPAY-02): até a resposta, "Conferindo…".
    return charge?.status === 'PENDING' && charge.method === 'PIX'
      ? { screen: 'pix', charge, checking: true }
      : { screen: 'hold-expired' };
  }

  if (input.creating)
    return mode === 'pix' ? { screen: 'generating' } : { screen: 'card-form', declined: null };

  if (mode === 'card') {
    const mine = charge && input.submittedCardIds.includes(charge.id) ? charge : null;
    const declined = mine?.status === 'FAILED' ? mine : null;
    const interrupted = mine?.status === 'CANCELLED' || mine?.status === 'EXPIRED';
    return interrupted
      ? { screen: 'card-form', declined, interrupted: true }
      : { screen: 'card-form', declined };
  }

  // Pix: vencido mostra o estado com "Gerar novo Pix"; sem Pix utilizável, a tela cria um (uma vez).
  if (charge?.status === 'EXPIRED' && charge.method === 'PIX')
    return { screen: 'pix-expired', charge };
  if (input.createError) return { screen: 'error', message: input.createError };
  if (input.autoCreateUsed) return { screen: 'pix-closed', charge: charge ?? null };
  return { screen: 'generating' };
}

/** A tela do Pix precisa criar uma cobrança (sem Pix utilizável e sem estado final). */
export function needsNewPix(input: ChargeViewInput): boolean {
  if (input.mode !== 'pix' || input.creating || input.createError || input.autoCreateUsed)
    return false;
  const view = deriveChargeView(input);
  if (view.screen !== 'generating') return false;
  const { charge } = input;
  // Pendente sem QR ainda (verificação): espera, não cria outra.
  return (
    !charge ||
    charge.status === 'FAILED' ||
    charge.status === 'CANCELLED' ||
    charge.method === 'CARD'
  );
}
