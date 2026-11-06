import {
  isMinFeeApplied,
  type OnlineCharge,
  type OnlinePayableType,
  type OnlineRefund,
  type OpenOnlineCharge,
  onlineChargeFailureMessage,
  type PaymentEnvironment,
  type PlayerOnlineCharge,
} from '@space-sports/shared';
import type { onlineCharges, onlineRefunds } from '../db/schema/index.js';

// Linhas de `online_charges`/`online_refunds` no formato da API (packages/shared).

export type ChargeRow = typeof onlineCharges.$inferSelect;
export type RefundRow = typeof onlineRefunds.$inferSelect;

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** Cobrança na visão do jogador; o Pix só enquanto pendente (RF-ONPAY-03). */
export function toPlayerCharge(
  charge: ChargeRow,
  environment: PaymentEnvironment,
): PlayerOnlineCharge {
  const pending = charge.status === 'PENDING';
  return {
    id: charge.id,
    payableType: charge.payableType as OnlinePayableType,
    payableId: charge.payableId,
    method: charge.method,
    status: charge.status,
    amountCents: charge.amountCents,
    refundedCents: charge.refundedCents,
    pix:
      pending && charge.pixCopyPaste && charge.pixQrSvg && charge.expiresAt
        ? {
            copyPaste: charge.pixCopyPaste,
            qrSvg: charge.pixQrSvg,
            expiresAt: charge.expiresAt.toISOString(),
          }
        : null,
    cardBrand: charge.cardBrand,
    cardLast4: charge.cardLast4,
    expiresAt: iso(charge.expiresAt),
    paidAt: iso(charge.paidAt),
    failureCode: charge.failureReason,
    failureReason: onlineChargeFailureMessage(charge.failureReason),
    paymentEnvironment: environment,
    serverTime: new Date().toISOString(),
    createdAt: charge.createdAt.toISOString(),
  };
}

export function toOpenCharge(
  charge: Pick<ChargeRow, 'id' | 'method' | 'expiresAt' | 'createdAt'>,
): OpenOnlineCharge {
  return {
    id: charge.id,
    method: charge.method,
    expiresAt: iso(charge.expiresAt),
    createdAt: charge.createdAt.toISOString(),
  };
}

export function toRefund(refund: RefundRow, requestedByName: string | null): OnlineRefund {
  return {
    id: refund.id,
    chargeId: refund.chargeId,
    kind: refund.kind,
    status: refund.status,
    amountCents: refund.amountCents,
    feeRefundCents: refund.feeRefundCents,
    reason: refund.reason,
    reasonCode: refund.reasonCode,
    chargeAgain: refund.chargeAgain,
    itemDiscountCents: refund.itemDiscountCents,
    requestedBy: refund.requestedBy,
    requestedByName,
    createdAt: refund.createdAt.toISOString(),
    dispute: refund.disputeStatus
      ? {
          status: refund.disputeStatus,
          respondBy: iso(refund.disputeRespondBy),
          responseText: refund.disputeResponseText,
          attachmentUrls: refund.disputeAttachmentUrls,
          respondedAt: iso(refund.disputeRespondedAt),
          resolvedAt: iso(refund.disputeResolvedAt),
        }
      : null,
  };
}

/** Cobrança na visão da gestão (Dono/Admin): valor, taxa gravada, líquido e estornos (RF-ONPAY-08). */
export function toStaffCharge(
  charge: ChargeRow,
  extra: {
    payerName: string;
    refunds: { refund: RefundRow; requestedByName: string | null }[];
    availableAt: Date | null;
    environment: PaymentEnvironment;
  },
): OnlineCharge {
  // Paga, com estorno parcial ou contestada com a contestação ganha; descontados os pendentes.
  const wonDispute = extra.refunds.some(
    ({ refund }) => refund.kind === 'CHARGEBACK' && refund.disputeStatus === 'WON',
  );
  const pending = extra.refunds
    .filter(({ refund }) => refund.status === 'PENDING' && !refund.appliedAt)
    .reduce((sum, { refund }) => sum + refund.amountCents, 0);
  const refundable =
    ['PAID', 'PARTIALLY_REFUNDED'].includes(charge.status) ||
    (charge.status === 'CHARGEBACK' && wonDispute)
      ? Math.max(charge.amountCents - charge.refundedCents - pending, 0)
      : 0;
  return {
    id: charge.id,
    spaceId: charge.spaceId,
    payableType: charge.payableType as OnlinePayableType,
    payableId: charge.payableId,
    payer: { userId: charge.payerUserId, name: extra.payerName },
    method: charge.method,
    status: charge.status,
    amountCents: charge.amountCents,
    serviceAmountCents: charge.serviceAmountCents,
    platformFeeCents: charge.platformFeeCents,
    spaceNetCents: charge.spaceNetCents,
    feePayer: charge.feePayer,
    feeBps: charge.feeBps,
    minFeeCents: charge.minFeeCents,
    minFeeApplied: isMinFeeApplied(charge.serviceAmountCents, {
      bps: charge.feeBps,
      minFeeCents: charge.minFeeCents,
    }),
    refundedCents: charge.refundedCents,
    feeRefundedCents: charge.feeRefundedCents,
    refundableCents: refundable,
    cardBrand: charge.cardBrand,
    cardLast4: charge.cardLast4,
    expiresAt: iso(charge.expiresAt),
    paidAt: iso(charge.paidAt),
    availableAt: iso(extra.availableAt),
    transactionId: charge.providerChargeId,
    failureCode: charge.failureReason,
    failureReason: onlineChargeFailureMessage(charge.failureReason),
    paymentEnvironment: extra.environment,
    createdAt: charge.createdAt.toISOString(),
    refunds: extra.refunds.map(({ refund, requestedByName }) => toRefund(refund, requestedByName)),
  };
}
