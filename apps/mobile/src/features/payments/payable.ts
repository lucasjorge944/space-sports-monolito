import {
  getGetMyBookingPaymentQueryKey,
  getGetMyBookingQueryKey,
  getGetMySubscriptionChargePaymentQueryKey,
  getGetMySubscriptionQueryKey,
  getMyBookingPayment,
  getMySubscriptionChargePayment,
  isApiError,
  type PayOnlineInput,
  type PlayerOnlineCharge,
  payMyBooking,
  payMySubscriptionCharge,
} from '@space-sports/api-client';
import type { QueryClient } from '@tanstack/react-query';
import { idempotencyHeaders } from './idempotency';

/** Item pago online: a reserva inteira ou a mensalidade (RN-ONPAY-03). */
export type Payable =
  | { type: 'BOOKING'; bookingId: string }
  | { type: 'SUBSCRIPTION_CHARGE'; subscriptionId: string; chargeId: string };

export function chargeQueryKey(payable: Payable) {
  return payable.type === 'BOOKING'
    ? getGetMyBookingPaymentQueryKey(payable.bookingId)
    : getGetMySubscriptionChargePaymentQueryKey(payable.subscriptionId, payable.chargeId);
}

/** Cobrança mais recente do item (a aberta ou a última); `null` quando ainda não há (404). */
export async function fetchCharge(
  payable: Payable,
  signal?: AbortSignal,
): Promise<PlayerOnlineCharge | null> {
  try {
    return payable.type === 'BOOKING'
      ? await getMyBookingPayment(payable.bookingId, { signal })
      : await getMySubscriptionChargePayment(payable.subscriptionId, payable.chargeId, { signal });
  } catch (error) {
    if (isApiError(error) && error.status === 404 && error.code === 'ONLINE_CHARGE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/** Cria a cobrança (Pix ou cartão) com a chave da tentativa. */
export function createCharge(
  payable: Payable,
  input: PayOnlineInput,
  idempotencyKey: string,
): Promise<PlayerOnlineCharge> {
  const options = idempotencyHeaders(idempotencyKey);
  return payable.type === 'BOOKING'
    ? payMyBooking(payable.bookingId, input, options)
    : payMySubscriptionCharge(payable.subscriptionId, payable.chargeId, input, options);
}

/** Depois de pagar (ou de mudar a cobrança), o item e as listas mudam. */
export function invalidateAfterPayment(
  queryClient: QueryClient,
  payable: Payable,
  { charge = true }: { charge?: boolean } = {},
) {
  if (charge) void queryClient.invalidateQueries({ queryKey: chargeQueryKey(payable) });
  void queryClient.invalidateQueries({ queryKey: ['/v1/me/payments'] });
  if (payable.type === 'BOOKING') {
    void queryClient.invalidateQueries({ queryKey: getGetMyBookingQueryKey(payable.bookingId) });
    void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
  } else {
    void queryClient.invalidateQueries({
      queryKey: getGetMySubscriptionQueryKey(payable.subscriptionId),
    });
    void queryClient.invalidateQueries({ queryKey: ['/v1/me/subscriptions'] });
  }
}

/** Rota da tela de pagamento do item. */
export function paymentHref(
  payable: Payable,
  params: { forma: 'pix' | 'cartao'; cobranca?: string; falha?: '1' },
) {
  const extra = {
    forma: params.forma,
    ...(params.cobranca ? { cobranca: params.cobranca } : {}),
    ...(params.falha ? { falha: params.falha } : {}),
  };
  return payable.type === 'BOOKING'
    ? { pathname: '/reserva/pagar/[id]' as const, params: { id: payable.bookingId, ...extra } }
    : {
        pathname: '/planos/pagar/[id]' as const,
        params: { id: payable.chargeId, plano: payable.subscriptionId, ...extra },
      };
}
