import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros do pagamento online (RF-ONPAY, RN-ONPAY).

const error = (status: HttpStatus, code: string, message: string, details?: unknown) =>
  new AppException({ status, code, message, details });

/** `PAYMENTS_PROVIDER=none` (RN-ONPAY-09). */
export const onlinePaymentsDisabled = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'ONLINE_PAYMENTS_DISABLED',
    'O pagamento online não está disponível.',
  );

/** O modo em vigor não oferece a forma escolhida (sem cadastro aprovado, modo `ON_SITE`…). */
export const onlinePaymentUnavailable = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'ONLINE_PAYMENT_UNAVAILABLE',
    'Este espaço não aceita pagamento online para este serviço.',
  );

/** Modo `ONLINE_REQUIRED`: a reserva precisa ser paga online (decisão 85). */
export const onlinePaymentRequired = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'ONLINE_PAYMENT_REQUIRED',
    'Este espaço exige o pagamento online para reservar.',
  );

export const merchantNotApproved = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MERCHANT_NOT_APPROVED',
    'Ative o pagamento online depois que o cadastro no gateway for aprovado.',
  );

export const merchantAccountPending = () =>
  error(HttpStatus.CONFLICT, 'MERCHANT_ACCOUNT_PENDING', 'O cadastro está em análise.');

export const merchantAccountApproved = () =>
  error(
    HttpStatus.CONFLICT,
    'MERCHANT_ACCOUNT_APPROVED',
    'O cadastro já foi aprovado. Para mudar os dados, fale com o suporte.',
  );

export const itemNotPayableOnline = (reason: string) =>
  error(HttpStatus.CONFLICT, 'NOT_PAYABLE_ONLINE', 'Este item não pode ser pago online agora.', {
    reason,
  });

export const alreadyPaid = () =>
  error(HttpStatus.CONFLICT, 'ALREADY_PAID', 'Não há valor em aberto para pagar.');

/** O prazo de pagamento da reserva acabou (RN-ONPAY-02). */
export const paymentHoldExpired = () =>
  error(
    HttpStatus.CONFLICT,
    'PAYMENT_HOLD_EXPIRED',
    'O prazo para pagar esta reserva acabou e o horário foi liberado.',
  );

export const onlineChargeNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'ONLINE_CHARGE_NOT_FOUND', 'Cobrança online não encontrada.');

export const chargeNotRefundable = (status: string) =>
  error(HttpStatus.CONFLICT, 'CHARGE_NOT_REFUNDABLE', 'Esta cobrança não pode ser estornada.', {
    status,
  });

/** RN-ONPAY-05: até o valor ainda não estornado. */
export const refundExceedsBalance = (refundableCents: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'REFUND_EXCEEDS_BALANCE',
    'O valor passa do que ainda pode ser estornado.',
    { refundableCents },
  );

export const chargebackNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'CHARGEBACK_NOT_FOUND', 'Chargeback não encontrado.');

export const disputeClosed = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'DISPUTE_CLOSED',
    'A contestação deste chargeback já foi respondida ou encerrada.',
    { status },
  );

export const disputeDeadlinePassed = () =>
  error(HttpStatus.CONFLICT, 'DISPUTE_DEADLINE_PASSED', 'O prazo para responder acabou.');

/** Decisão 82: a taxa paga pelo jogador depende de decisão futura. */
export const feePayerNotAllowed = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'FEE_PAYER_NOT_ALLOWED',
    'Por enquanto a taxa de serviço é paga pelo espaço.',
  );

/**
 * Falha de comunicação com o gateway. `details.verification = 'PENDING'`: a cobrança `chargeId`
 * ficou pendente de verificação (o gateway pode tê-la criado); a consulta da cobrança mostra o
 * resultado quando a reconciliação resolver.
 */
export const gatewayUnavailable = (details?: { chargeId: string; verification: 'PENDING' }) =>
  error(
    HttpStatus.BAD_GATEWAY,
    'PAYMENT_GATEWAY_UNAVAILABLE',
    'Não foi possível falar com o gateway de pagamento. Tente de novo em instantes.',
    details,
  );

/** Outra operação de pagamento no mesmo item ainda não terminou (trava por item, RN-ONPAY-03). */
export const paymentInProgress = () =>
  error(
    HttpStatus.CONFLICT,
    'PAYMENT_IN_PROGRESS',
    'Já existe um pagamento em andamento para este item. Aguarde alguns segundos e confira.',
  );

/** RN-ONPAY-02: a reserva começa cedo demais para o pagamento antecipado obrigatório. */
export const bookingTooSoonForOnlinePayment = (minLeadMin: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT',
    'Este horário começa em menos de 5 minutos e o espaço exige o pagamento antecipado. Escolha outro horário.',
    { minLeadMin },
  );

export const webhookSignatureInvalid = () =>
  error(HttpStatus.UNAUTHORIZED, 'WEBHOOK_SIGNATURE_INVALID', 'Assinatura do webhook inválida.');

/** Assinatura válida, mas o corpo não é um JSON legível (vazio ou outro formato). */
export const webhookPayloadInvalid = () =>
  error(HttpStatus.BAD_REQUEST, 'INVALID_WEBHOOK_PAYLOAD', 'Corpo do webhook ilegível.');

export const webhookProviderNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'WEBHOOK_PROVIDER_NOT_FOUND', 'Provedor de pagamento desconhecido.');

export const merchantAccountNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'MERCHANT_ACCOUNT_NOT_FOUND', 'Cadastro no gateway não encontrado.');

/**
 * Decisão 96: o registro manual no local é recusado porque a cobrança online aberta acabou de ser
 * paga (a reserva ou a mensalidade já foi atualizada).
 */
export const onlineChargeAlreadyPaid = () =>
  error(
    HttpStatus.CONFLICT,
    'ONLINE_CHARGE_ALREADY_PAID',
    'O cliente acabou de pagar pelo app. O item foi atualizado.',
  );

/** Decisão 95: cadastro e conta de recebimento só pelo próprio Dono, fora do modo suporte. */
export const supportModeForbidden = () =>
  error(
    HttpStatus.FORBIDDEN,
    'SUPPORT_MODE_FORBIDDEN',
    'No modo suporte, o cadastro e a conta de recebimento não podem ser alterados.',
  );
