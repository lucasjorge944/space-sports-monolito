import {
  type PlayerBookingDetailDto,
  type SubscriptionCharge,
  type SubscriptionDetail,
  useGetMyBooking,
  useGetMySubscription,
  useGetSpaceBySlug,
} from '@space-sports/api-client';
import { formatBookingWhen, formatMonthYear } from '@/lib/datetime';
import type { PaymentEnvironmentLike } from './card-form';
import { type BookingContext, bookingPayableKind, type PayableKind } from './charge-state';
import { responseOffset } from './countdown';
import { bookingOnlineOptions, classOnlineOptions, type OnlineOption } from './options';
import type { Payable } from './payable';

/** Saldo em aberto da reserva inteira (`preço − abatimento − pago`, RN-ONPAY-03). */
export function bookingDueCents(
  booking: Pick<PlayerBookingDetailDto, 'priceCents' | 'discountCents' | 'paidCents'>,
): number {
  return Math.max(booking.priceCents - (booking.discountCents ?? 0) - (booking.paidCents ?? 0), 0);
}

export interface PayableContext {
  kind: PayableKind;
  booking: BookingContext | null;
  /** Valor a pagar agora (sem cobrança criada). */
  dueCents: number;
  /** Nada a pagar: quitada (no local ou online), dispensada ou sem saldo. */
  settled: boolean;
  /** "Reserva · Arena Beira-Mar" ou "Mensalidade de nov 2026 · Plano 2x". */
  title: string;
  /** Quando: "Sáb, 08/11/2026 · 18:00 – 19:30" (só na reserva). */
  subtitle: string | null;
  /** Prazo do hold da reserva obrigatória. */
  holdDeadline: string | null;
  /** Diferença servidor − aparelho da reserva (`serverTime`), para a contagem do hold. */
  clockOffsetMs: number | null;
  timeZone: string | undefined;
  spaceSlug: string;
  spaceName: string;
  /** Ambiente do espaço (para os cartões de teste antes da primeira cobrança). */
  spaceEnvironment: PaymentEnvironmentLike | null;
  /**
   * Formas online que o espaço aceita neste serviço e que o app consegue usar (o cartão só com o
   * tokenizador do ambiente). Enquanto o espaço carrega, só o Pix.
   */
  onlineOptions: OnlineOption[];
}

function fromBooking(
  booking: PlayerBookingDetailDto,
): Omit<PayableContext, 'spaceEnvironment' | 'onlineOptions' | 'clockOffsetMs'> {
  const due = bookingDueCents(booking);
  return {
    kind: bookingPayableKind(booking),
    booking: {
      status: booking.status,
      cancelReason: booking.cancelReason,
      paymentDueAt: booking.paymentDueAt,
      fullyPaid: booking.paymentStatus === 'PAID' || (due === 0 && booking.priceCents > 0),
    },
    dueCents: due,
    settled: booking.paymentStatus === 'PAID' || (due === 0 && booking.priceCents > 0),
    title: `Reserva · ${booking.space.name}`,
    subtitle: formatBookingWhen(booking.startsAt, booking.endsAt, booking.space.timeZone),
    holdDeadline: booking.status === 'PENDING_PAYMENT' ? booking.paymentDueAt : null,
    timeZone: booking.space.timeZone,
    spaceSlug: booking.space.slug,
    spaceName: booking.space.name,
  };
}

function fromSubscription(
  subscription: SubscriptionDetail,
  charge: SubscriptionCharge,
): Omit<PayableContext, 'spaceEnvironment' | 'onlineOptions' | 'clockOffsetMs'> {
  return {
    kind: 'subscription',
    booking: null,
    dueCents: charge.dueCents,
    settled: charge.status === 'PAID' || charge.status === 'WAIVED' || charge.dueCents === 0,
    title: `Mensalidade de ${formatMonthYear(charge.periodStart)} · ${subscription.plan.name}`,
    subtitle: null,
    holdDeadline: null,
    timeZone: subscription.space.timeZone,
    spaceSlug: subscription.space.slug,
    spaceName: subscription.space.name,
  };
}

/** O item sendo pago (reserva ou mensalidade), com o que a tela de pagamento mostra. */
export function usePayableContext(payable: Payable) {
  const isBooking = payable.type === 'BOOKING';
  const bookingQuery = useGetMyBooking(isBooking ? payable.bookingId : '', {
    query: { enabled: isBooking },
  });
  const subscriptionQuery = useGetMySubscription(isBooking ? '' : payable.subscriptionId, {
    query: { enabled: !isBooking },
  });
  const query = isBooking ? bookingQuery : subscriptionQuery;

  let base: Omit<PayableContext, 'spaceEnvironment' | 'onlineOptions' | 'clockOffsetMs'> | null =
    null;
  let missing = false;
  if (isBooking && bookingQuery.data) base = fromBooking(bookingQuery.data);
  if (!isBooking && subscriptionQuery.data) {
    const charge = subscriptionQuery.data.charges.find((c) => c.id === payable.chargeId);
    if (charge) base = fromSubscription(subscriptionQuery.data, charge);
    else missing = true;
  }

  const space = useGetSpaceBySlug(base?.spaceSlug ?? '', {
    query: { enabled: Boolean(base?.spaceSlug), staleTime: 60_000 },
  });
  const context: PayableContext | null = base
    ? {
        ...base,
        clockOffsetMs: isBooking
          ? responseOffset(bookingQuery.data?.serverTime, bookingQuery.dataUpdatedAt)
          : null,
        spaceEnvironment: space.data?.paymentEnvironment ?? null,
        onlineOptions: space.data
          ? isBooking
            ? bookingOnlineOptions(space.data)
            : classOnlineOptions(space.data)
          : ['ONLINE_PIX'],
      }
    : null;

  return {
    context,
    isPending: query.isPending,
    isError: query.isError || missing,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
