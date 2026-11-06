import type { SpaceBookingDetailDto } from '@space-sports/api-client';

/**
 * Quanto falta receber da reserva inteira: preço − abatimento (estorno online sem "cobrar de novo",
 * decisão 93) − recebido.
 */
export function bookingDue(
  booking: Pick<SpaceBookingDetailDto, 'priceCents' | 'paidCents'> & {
    discountCents?: number | null;
  },
): number {
  return Math.max(
    0,
    (booking.priceCents ?? 0) - (booking.discountCents ?? 0) - (booking.paidCents ?? 0),
  );
}
