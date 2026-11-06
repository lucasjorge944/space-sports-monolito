import { z } from 'zod';
import { centsSchema } from './money';

// Núcleo do pagamento online (decisões 80 a 92; RF-ONPAY e RN-ONPAY; docs/13-pagamentos-online.md):
// enums, a taxa da plataforma e a cobrança vista pelo jogador. Não depende de `booking.ts`, que
// importa daqui; o restante (configurações, carteira, Super) fica em `payments.ts`.

/** Meios do pagamento online (decisão 88: Pix e cartão de crédito à vista). */
export const ONLINE_PAYMENT_METHODS = ['PIX', 'CARD'] as const;
export const onlinePaymentMethodSchema = z.enum(ONLINE_PAYMENT_METHODS);
export type OnlinePaymentMethod = z.infer<typeof onlinePaymentMethodSchema>;

/** Canal do `payment_record`: registrado pela gestão no espaço ou pago online pelo app. */
export const PAYMENT_CHANNELS = ['ON_SITE', 'ONLINE'] as const;
export const paymentChannelSchema = z.enum(PAYMENT_CHANNELS);
export type PaymentChannel = z.infer<typeof paymentChannelSchema>;

/** Itens pagos online (decisão 88): a reserva inteira e a mensalidade de aula. */
export const ONLINE_PAYABLE_TYPES = ['BOOKING', 'SUBSCRIPTION_CHARGE'] as const;
export const onlinePayableTypeSchema = z.enum(ONLINE_PAYABLE_TYPES);
export type OnlinePayableType = z.infer<typeof onlinePayableTypeSchema>;

/**
 * Status da cobrança online (RN-ONPAY-07). Só avança: `PENDING → PAID → PARTIALLY_REFUNDED →
 * REFUNDED | CHARGEBACK` e `PENDING → EXPIRED | FAILED | CANCELLED`. Um pagamento confirmado pelo
 * gateway depois de `EXPIRED`/`CANCELLED` ainda é registrado (o dinheiro entrou) e estornado.
 */
export const ONLINE_CHARGE_STATUSES = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CHARGEBACK',
] as const;
export const onlineChargeStatusSchema = z.enum(ONLINE_CHARGE_STATUSES);
export type OnlineChargeStatus = z.infer<typeof onlineChargeStatusSchema>;

/** Ordem do ciclo de vida: uma transição só vale para um posto maior (RN-ONPAY-07). */
export const ONLINE_CHARGE_STATUS_RANK: Readonly<Record<OnlineChargeStatus, number>> = {
  PENDING: 0,
  EXPIRED: 1,
  FAILED: 1,
  CANCELLED: 1,
  PAID: 2,
  PARTIALLY_REFUNDED: 3,
  REFUNDED: 4,
  CHARGEBACK: 4,
};

/** Status em que o dinheiro entrou (pagas, com ou sem estorno). */
export const ONLINE_CHARGE_PAID_STATUSES = [
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CHARGEBACK',
] as const satisfies OnlineChargeStatus[];

/** Estorno pedido pela plataforma (`REFUND`) ou contestação no cartão (`CHARGEBACK`). */
export const ONLINE_REFUND_KINDS = ['REFUND', 'CHARGEBACK'] as const;
export const onlineRefundKindSchema = z.enum(ONLINE_REFUND_KINDS);
export type OnlineRefundKind = z.infer<typeof onlineRefundKindSchema>;

export const ONLINE_REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export const onlineRefundStatusSchema = z.enum(ONLINE_REFUND_STATUSES);
export type OnlineRefundStatus = z.infer<typeof onlineRefundStatusSchema>;

/**
 * Contestação do chargeback pelo espaço (RF-ONPAY-09): aguardando a resposta do espaço,
 * respondida e o resultado (`WON`/`LOST`, informado pelo gateway).
 */
export const CHARGEBACK_DISPUTE_STATUSES = [
  'AWAITING_RESPONSE',
  'RESPONDED',
  'WON',
  'LOST',
] as const;
export const chargebackDisputeStatusSchema = z.enum(CHARGEBACK_DISPUTE_STATUSES);
export type ChargebackDisputeStatus = z.infer<typeof chargebackDisputeStatusSchema>;

/** Quem paga a taxa (decisão 82). Só `SPACE` é aceito por enquanto; `PLAYER` é decisão futura. */
export const FEE_PAYERS = ['SPACE', 'PLAYER'] as const;
export const feePayerSchema = z.enum(FEE_PAYERS);
export type FeePayer = z.infer<typeof feePayerSchema>;

/** Modos de pagamento do espaço (decisão 84; RF-ONPAY-02). */
export const BOOKING_PAYMENT_MODES = ['ON_SITE', 'ONLINE_OPTIONAL', 'ONLINE_REQUIRED'] as const;
export const bookingPaymentModeSchema = z.enum(BOOKING_PAYMENT_MODES);
export type BookingPaymentMode = z.infer<typeof bookingPaymentModeSchema>;

export const CLASS_PAYMENT_MODES = ['ON_SITE', 'ONLINE_OPTIONAL'] as const;
export const classPaymentModeSchema = z.enum(CLASS_PAYMENT_MODES);
export type ClassPaymentMode = z.infer<typeof classPaymentModeSchema>;

/** Forma escolhida pelo jogador na etapa de pagamento (RF-ONPAY-03). */
export const PAYMENT_OPTIONS = ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'] as const;
export const paymentOptionSchema = z.enum(PAYMENT_OPTIONS);
export type PaymentOption = z.infer<typeof paymentOptionSchema>;

/** Formas que o modo oferece (a ordem é a da tela). */
export function paymentOptionsFor(mode: BookingPaymentMode | ClassPaymentMode): PaymentOption[] {
  switch (mode) {
    case 'ON_SITE':
      return ['ON_SITE'];
    case 'ONLINE_OPTIONAL':
      return ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'];
    case 'ONLINE_REQUIRED':
      return ['ONLINE_PIX', 'ONLINE_CARD'];
  }
}

/**
 * Decisão 85: a reserva com pagamento obrigatório segura o horário por 15 minutos, no máximo até o
 * início (`payment_due_at = min(início, agora + 15 min)`).
 */
export const BOOKING_PAYMENT_HOLD_MIN = 15;
/**
 * Com menos que isso até o início, o modo obrigatório recusa a reserva
 * (`BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT`): não dá tempo de pagar.
 */
export const BOOKING_ONLINE_PAYMENT_MIN_LEAD_MIN = 5;
/** Validade do Pix da reserva no modo opcional (até o início, se vier antes). */
export const BOOKING_PIX_VALIDITY_MIN = 15;
/** RF-ONPAY-05 / docs/13 §6: o Pix da mensalidade vale 24 h. */
export const SUBSCRIPTION_PIX_VALIDITY_HOURS = 24;

/** `cancel_reason` da reserva cancelada pelo prazo do pagamento (RN-ONPAY-02). */
export const BOOKING_PAYMENT_EXPIRED_REASON = 'PAYMENT_EXPIRED';
/** `cancel_reason` da reserva `PENDING_PAYMENT` de que o organizador desistiu (decisão 96). */
export const BOOKING_PAYMENT_ABANDONED_REASON = 'PAYMENT_ABANDONED';

/**
 * Motivo do estorno, para o app e o painel distinguirem os automáticos (decisões 86 e 96):
 * manual pela gestão; cancelamento pelo organizador (no prazo) ou pelo espaço; exclusão da conta
 * do pagador (reservas futuras e mensalidades de meses ainda não começados); pagamento que chegou
 * depois do prazo ou depois da troca da forma de pagamento; item já quitado; chargeback; feito
 * direto no gateway.
 */
export const ONLINE_REFUND_REASON_CODES = [
  'MANUAL',
  'BOOKING_CANCELLED_BY_PLAYER',
  'BOOKING_CANCELLED_BY_SPACE',
  'ACCOUNT_DELETED',
  'PAID_AFTER_DEADLINE',
  'PAID_AFTER_METHOD_CHANGE',
  'ITEM_ALREADY_PAID',
  'CHARGEBACK',
  'EXTERNAL',
] as const;
export const onlineRefundReasonCodeSchema = z.enum(ONLINE_REFUND_REASON_CODES);
export type OnlineRefundReasonCode = z.infer<typeof onlineRefundReasonCodeSchema>;

/** Texto dos estornos automáticos (o `reason` gravado); o manual leva o motivo da gestão. */
export const AUTO_REFUND_REASONS = {
  BOOKING_CANCELLED_BY_PLAYER: 'Estorno automático (cancelamento dentro do prazo).',
  BOOKING_CANCELLED_BY_SPACE: 'Estorno automático (cancelado pelo espaço).',
  ACCOUNT_DELETED: 'Estorno automático: a conta foi excluída a pedido do titular.',
  PAID_AFTER_DEADLINE: 'Estorno automático: o pagamento chegou depois do prazo.',
  PAID_AFTER_METHOD_CHANGE:
    'Estorno automático: o pagamento chegou depois da troca da forma de pagamento.',
  ITEM_ALREADY_PAID: 'Estorno automático: o item já estava pago.',
} as const satisfies Partial<Record<OnlineRefundReasonCode, string>>;
export type AutoRefundReasonCode = keyof typeof AUTO_REFUND_REASONS;

// ---------------------------------------------------------------------------------------------
// Taxa da plataforma (RN-ONPAY-01)

/** Pontos-base (1 bp = 0,01%): inteiro de 0 a 10000. */
export const feeBpsSchema = z.number().int().min(0).max(10_000);

/** Regra da taxa para um meio de pagamento. */
export interface FeeRule {
  bps: number;
  minFeeCents: number;
}

/** Arredonda `numerator / denominator` meio para cima, só com inteiros não negativos. */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('Divisão inválida.');
  }
  if (numerator < 0) throw new RangeError('Valor negativo.');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * RN-ONPAY-01: `min(valor, max(arredondar(valor × bps ÷ 10000), mínimo))`, em centavos, com
 * arredondamento meio para cima. Valor zero não tem taxa.
 */
export function calculatePlatformFee(amountCents: number, rule: FeeRule): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError('Valor em centavos inválido.');
  }
  if (amountCents === 0) return 0;
  const percentage = divideRoundHalfUp(amountCents * rule.bps, 10_000);
  return Math.min(amountCents, Math.max(percentage, rule.minFeeCents));
}

/** Regras da taxa já resolvidas (padrão do Super ou do espaço) para os dois meios. */
export interface FeeSettings {
  pixFeeBps: number;
  cardFeeBps: number;
  minFeeCents: number;
  feePayer: FeePayer;
}

/** Taxa do espaço: cada campo do espaço, quando definido, vence o padrão (RF-ONPAY-10). */
export function resolveFeeSettings(
  defaults: FeeSettings,
  space: Partial<{ [K in keyof FeeSettings]: FeeSettings[K] | null }> | null | undefined,
): FeeSettings {
  return {
    pixFeeBps: space?.pixFeeBps ?? defaults.pixFeeBps,
    cardFeeBps: space?.cardFeeBps ?? defaults.cardFeeBps,
    minFeeCents: space?.minFeeCents ?? defaults.minFeeCents,
    feePayer: space?.feePayer ?? defaults.feePayer,
  };
}

/** Snapshot da cobrança: o que o jogador paga, a taxa e o líquido do espaço. */
export interface ChargeSplit {
  /** Preço do serviço (o saldo em aberto do item). */
  serviceAmountCents: number;
  /** Valor cobrado do jogador. */
  amountCents: number;
  platformFeeCents: number;
  /** O que vai para a subconta do espaço. */
  spaceNetCents: number;
  feeBps: number;
  minFeeCents: number;
  feePayer: FeePayer;
}

/**
 * Split da cobrança. Com `SPACE` (decisão 82), o jogador paga o preço e o espaço recebe
 * `valor − taxa`; com `PLAYER` (futuro), a taxa vem destacada por cima do preço.
 */
export function splitCharge(
  serviceAmountCents: number,
  method: OnlinePaymentMethod,
  settings: FeeSettings,
): ChargeSplit {
  const rule = {
    bps: method === 'PIX' ? settings.pixFeeBps : settings.cardFeeBps,
    minFeeCents: settings.minFeeCents,
  };
  const fee = calculatePlatformFee(serviceAmountCents, rule);
  const player = settings.feePayer === 'PLAYER';
  return {
    serviceAmountCents,
    amountCents: player ? serviceAmountCents + fee : serviceAmountCents,
    platformFeeCents: fee,
    spaceNetCents: player ? serviceAmountCents : serviceAmountCents - fee,
    feeBps: rule.bps,
    minFeeCents: rule.minFeeCents,
    feePayer: settings.feePayer,
  };
}

/**
 * Taxa devolvida num estorno (decisões 86 e 94), pela regra acumulada: cada estorno devolve
 * `arredondar(taxa × estornado_acumulado ÷ pago) − taxa_já_devolvida` (meio para cima), e o que
 * zera o pago devolve exatamente o restante. Assim a soma nunca passa da taxa nem depende de como
 * o valor foi fatiado.
 */
export function proportionalFeeRefund(
  charge: {
    amountCents: number;
    platformFeeCents: number;
    refundedCents: number;
    feeRefundedCents: number;
  },
  refundCents: number,
): number {
  const remaining = charge.amountCents - charge.refundedCents;
  if (!Number.isSafeInteger(refundCents) || refundCents <= 0 || refundCents > remaining) {
    throw new RangeError('Valor de estorno inválido.');
  }
  const feeLeft = charge.platformFeeCents - charge.feeRefundedCents;
  if (refundCents === remaining) return feeLeft;
  const cumulative = divideRoundHalfUp(
    charge.platformFeeCents * (charge.refundedCents + refundCents),
    charge.amountCents,
  );
  return Math.min(feeLeft, Math.max(cumulative - charge.feeRefundedCents, 0));
}

/** A taxa caiu no mínimo (o percentual daria menos): o painel mostra o aviso. */
export function isMinFeeApplied(serviceAmountCents: number, rule: FeeRule): boolean {
  return (
    serviceAmountCents > 0 &&
    divideRoundHalfUp(serviceAmountCents * rule.bps, 10_000) < rule.minFeeCents
  );
}

// ---------------------------------------------------------------------------------------------
// Ambiente de pagamento (decisão 92): vem do adaptador, nada fixo no web ou no app

export const SANDBOX_CARD_OUTCOMES = ['APPROVED', 'DECLINED', 'CHARGEBACK'] as const;

/** Cartões de teste e dicas do gateway simulado (selo "Ambiente de teste"). */
export const paymentsSandboxSchema = z.object({
  label: z.string(),
  testCards: z.array(
    z.object({
      /** Rótulo do chip ("Aprova", "Recusa", "Aprova e contesta"). */
      label: z.string(),
      /** Número formatado para digitar. */
      number: z.string(),
      outcome: z.enum(SANDBOX_CARD_OUTCOMES),
      holderName: z.string(),
      /** `MM/AA`, no futuro. */
      expiry: z.string(),
      cvc: z.string(),
      description: z.string(),
    }),
  ),
  /** Dica do documento que força a recusa do cadastro. */
  rejectedDocument: z.object({
    hint: z.string(),
    examples: z.array(z.object({ type: z.enum(['CPF', 'CNPJ']), document: z.string() })),
  }),
  notes: z.array(z.string()),
});
export type PaymentsSandbox = z.infer<typeof paymentsSandboxSchema>;

/**
 * Ambiente de pagamento nas respostas do app, do painel e do Super: o provedor (`fake`, `none` ou
 * o real) e, só com o fake, as dicas de teste. Com `none`, `enabled` é falso.
 */
export const paymentEnvironmentSchema = z.object({
  provider: z.string(),
  enabled: z.boolean(),
  sandbox: paymentsSandboxSchema.nullable(),
});
export type PaymentEnvironment = z.infer<typeof paymentEnvironmentSchema>;

// ---------------------------------------------------------------------------------------------
// Cobrança na visão do jogador (RF-ONPAY-03 a 06)

const isoString = z.iso.datetime();

/** POST …/payment: pagar online a reserva ou a mensalidade (RN-ONPAY-03, RN-ONPAY-10). */
export const payOnlineSchema = z
  .object({
    method: onlinePaymentMethodSchema,
    /** Token do cartão gerado no app (nenhum dado do cartão passa pela API). Só com `CARD`. */
    cardToken: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => (v.method === 'CARD') === Boolean(v.cardToken), {
    message: 'Envie `cardToken` só (e sempre) com o cartão.',
    path: ['cardToken'],
  });
export type PayOnlineInput = z.infer<typeof payOnlineSchema>;

/** Pix da cobrança pendente: copia e cola e QR (SVG) gerados pelo gateway. */
export const pixInstructionsSchema = z.object({
  copyPaste: z.string(),
  /** Documento SVG do QR Code. */
  qrSvg: z.string(),
  expiresAt: isoString,
});
export type PixInstructions = z.infer<typeof pixInstructionsSchema>;

/** Códigos estáveis da recusa/falha da cobrança e o texto para mostrar (`failureReason`). */
export const ONLINE_CHARGE_FAILURE_MESSAGES = {
  CARD_DECLINED: 'O cartão foi recusado. Confira os dados ou use outro cartão.',
  INVALID_CARD_TOKEN: 'Não foi possível ler os dados do cartão. Tente de novo.',
  GATEWAY_ERROR: 'Não foi possível processar o pagamento agora. Tente de novo em instantes.',
} as const;
export type OnlineChargeFailureCode = keyof typeof ONLINE_CHARGE_FAILURE_MESSAGES;

/** Texto legível da falha; código desconhecido cai no genérico. */
export function onlineChargeFailureMessage(code: string | null): string | null {
  if (!code) return null;
  return (
    ONLINE_CHARGE_FAILURE_MESSAGES[code as OnlineChargeFailureCode] ??
    'O pagamento não foi concluído. Tente de novo.'
  );
}

export const playerOnlineChargeSchema = z.object({
  id: z.uuid(),
  payableType: onlinePayableTypeSchema,
  payableId: z.uuid(),
  method: onlinePaymentMethodSchema,
  status: onlineChargeStatusSchema,
  /** O que o jogador paga (o preço do serviço: a taxa é do espaço, decisão 82). */
  amountCents: centsSchema,
  refundedCents: centsSchema,
  /** Só enquanto a cobrança Pix está pendente. */
  pix: pixInstructionsSchema.nullable(),
  /** Bandeira e últimos 4 dígitos do cartão (comprovante). */
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  /** Prazo da cobrança (Pix: validade; reserva obrigatória: o prazo do horário). */
  expiresAt: isoString.nullable(),
  paidAt: isoString.nullable(),
  /** Código estável da recusa ou falha (`CARD_DECLINED`, `INVALID_CARD_TOKEN`, `GATEWAY_ERROR`). */
  failureCode: z.string().nullable(),
  /** Texto legível da recusa ou falha, para mostrar ao jogador. */
  failureReason: z.string().nullable(),
  /** Provedor e, com o fake, o selo "Ambiente de teste" e os cartões de teste (decisão 92). */
  paymentEnvironment: paymentEnvironmentSchema,
  /** Hora do servidor, para a contagem regressiva não depender do relógio do aparelho. */
  serverTime: isoString,
  createdAt: isoString,
});
export type PlayerOnlineCharge = z.infer<typeof playerOnlineChargeSchema>;

/** Cobrança aberta do item (reserva ou mensalidade): meio e validade ("Pix aberto até 18:47"). */
export const openOnlineChargeSchema = z.object({
  id: z.uuid(),
  method: onlinePaymentMethodSchema,
  expiresAt: isoString.nullable(),
  createdAt: isoString,
});
export type OpenOnlineCharge = z.infer<typeof openOnlineChargeSchema>;

// ---------------------------------------------------------------------------------------------
// Cobrança e estornos na visão da gestão (RF-ONPAY-08, RF-ONPAY-09)

/** Contestação do chargeback (RF-ONPAY-09). O resultado é o próprio status (`WON`/`LOST`). */
export const chargebackDisputeSchema = z.object({
  status: chargebackDisputeStatusSchema,
  /** Prazo para o espaço responder. */
  respondBy: isoString.nullable(),
  /** Texto da resposta enviada pelo espaço. */
  responseText: z.string().nullable(),
  attachmentUrls: z.array(z.string()),
  respondedAt: isoString.nullable(),
  /** Quando o gateway informou o resultado. */
  resolvedAt: isoString.nullable(),
});

export const onlineRefundSchema = z.object({
  id: z.uuid(),
  chargeId: z.uuid(),
  kind: onlineRefundKindSchema,
  status: onlineRefundStatusSchema,
  amountCents: centsSchema,
  /** Taxa devolvida ao espaço (regra acumulada, decisão 94). */
  feeRefundCents: centsSchema,
  /** Motivo escrito (manual) ou o texto do automático. */
  reason: z.string().nullable(),
  reasonCode: onlineRefundReasonCodeSchema,
  /** Estorno manual: o valor volta a ser cobrado (decisão 93); falso = abatimento do item. */
  chargeAgain: z.boolean(),
  /** Parte do estorno que virou abatimento do item. */
  itemDiscountCents: centsSchema,
  /** Quem pediu o estorno; nulo quando automático. */
  requestedBy: z.uuid().nullable(),
  requestedByName: z.string().nullable(),
  createdAt: isoString,
  /** Só no chargeback. */
  dispute: chargebackDisputeSchema.nullable(),
});
export type OnlineRefund = z.infer<typeof onlineRefundSchema>;

/** Cobrança online na visão da gestão (Dono/Admin): valor, taxa gravada, líquido e estornos. */
export const onlineChargeSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  payableType: onlinePayableTypeSchema,
  payableId: z.uuid(),
  payer: z.object({ userId: z.uuid(), name: z.string() }),
  method: onlinePaymentMethodSchema,
  status: onlineChargeStatusSchema,
  amountCents: centsSchema,
  serviceAmountCents: centsSchema,
  platformFeeCents: centsSchema,
  spaceNetCents: centsSchema,
  feePayer: feePayerSchema,
  /** Percentual gravado na cobrança (snapshot), não a taxa atual do espaço. */
  feeBps: feeBpsSchema,
  minFeeCents: centsSchema,
  /** A taxa ficou no mínimo (o percentual daria menos): "Taxa de serviço (mínimo)". */
  minFeeApplied: z.boolean(),
  refundedCents: centsSchema,
  feeRefundedCents: centsSchema,
  /** Quanto ainda pode ser estornado. */
  refundableCents: centsSchema,
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  expiresAt: isoString.nullable(),
  paidAt: isoString.nullable(),
  /** Quando a venda libera (ou liberou) na carteira. */
  availableAt: isoString.nullable(),
  /** Código da transação no gateway (comprovante). */
  transactionId: z.string().nullable(),
  failureCode: z.string().nullable(),
  /** Texto legível da recusa ou falha. */
  failureReason: z.string().nullable(),
  paymentEnvironment: paymentEnvironmentSchema,
  createdAt: isoString,
  refunds: z.array(onlineRefundSchema),
});
export type OnlineCharge = z.infer<typeof onlineChargeSchema>;
