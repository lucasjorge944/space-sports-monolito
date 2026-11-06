import { bookingPaymentStatus, type PaymentChannel } from '@space-sports/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { bookingParticipants, bookings, paymentRecords } from '../db/schema/index.js';
import { bookingNotPayable, paymentExceedsDue } from './bookings.errors.js';
import { audit, type Tx } from './db-utils.js';

// Registro de pagamento da reserva inteira (RF-PAY-01, decisão 50), compartilhado pelo registro
// manual da gestão e pelo pagamento online (RN-ONPAY-04): mesmas regras de status e de valor em
// aberto, com a reserva já travada pelo chamador.

type BookingRow = typeof bookings.$inferSelect;
export type PaymentRecordRow = typeof paymentRecords.$inferSelect;

/** Reservas que ainda podem ser cobradas (no-show também paga, se o espaço cobrar). */
export const PAYABLE_STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const;

export const isBookingPayable = (status: BookingRow['status']) =>
  (PAYABLE_STATUSES as readonly string[]).includes(status);

/** Pagamentos não estornados da reserva, incluindo os registros antigos por parte. */
export async function bookingPaidTotal(tx: Tx, bookingId: string): Promise<number> {
  const [row] = await tx
    .select({ amount: sql<number>`coalesce(sum(${paymentRecords.amountCents}), 0)::int` })
    .from(paymentRecords)
    .where(
      and(
        isNull(paymentRecords.reversedAt),
        or(
          and(eq(paymentRecords.payableType, 'BOOKING'), eq(paymentRecords.payableId, bookingId)),
          and(
            eq(paymentRecords.payableType, 'BOOKING_PARTICIPANT'),
            inArray(
              paymentRecords.payableId,
              tx
                .select({ id: bookingParticipants.id })
                .from(bookingParticipants)
                .where(eq(bookingParticipants.bookingId, bookingId)),
            ),
          ),
        ),
      ),
    );
  return row?.amount ?? 0;
}

/**
 * Recalcula o `payment_status` da reserva pelo total pago, descontado o abatimento (decisão 93).
 * Relê preço e abatimento: quem chama pode ter mudado o abatimento na mesma transação.
 */
export async function refreshBookingPaymentStatus(
  tx: Tx,
  booking: Pick<BookingRow, 'id'>,
): Promise<void> {
  const [row] = await tx
    .select({ priceCents: bookings.priceCents, discountCents: bookings.discountCents })
    .from(bookings)
    .where(eq(bookings.id, booking.id));
  if (!row) return;
  const paid = await bookingPaidTotal(tx, booking.id);
  await tx
    .update(bookings)
    .set({ paymentStatus: bookingPaymentStatus(row.priceCents - row.discountCents, paid) })
    .where(eq(bookings.id, booking.id));
}

/** Saldo em aberto da reserva: preço − abatimento − pago. */
export async function bookingDue(
  tx: Tx,
  booking: Pick<BookingRow, 'id' | 'priceCents' | 'discountCents'>,
): Promise<number> {
  return Math.max(
    booking.priceCents - booking.discountCents - (await bookingPaidTotal(tx, booking.id)),
    0,
  );
}

export interface NewBookingPayment {
  amountCents: number;
  method: PaymentRecordRow['method'];
  paidAt: Date;
  note: string | null;
  /** Quem registrou; nulo no pagamento online. */
  recordedBy: string | null;
  channel: PaymentChannel;
  onlineChargeId: string | null;
}

/**
 * Registra um pagamento na reserva travada: só em reserva cobrável e até o valor em aberto;
 * recalcula o status e audita (`payment.record`, com o canal no diff).
 */
export async function insertBookingPayment(
  tx: Tx,
  spaceId: string,
  booking: BookingRow,
  payment: NewBookingPayment,
): Promise<PaymentRecordRow> {
  if (!isBookingPayable(booking.status)) throw bookingNotPayable(booking.status);
  const due = await bookingDue(tx, booking);
  if (payment.amountCents > due) throw paymentExceedsDue(due);

  const [record] = await tx
    .insert(paymentRecords)
    .values({
      spaceId,
      payableType: 'BOOKING',
      payableId: booking.id,
      payerUserId: booking.organizerUserId,
      amountCents: payment.amountCents,
      method: payment.method,
      channel: payment.channel,
      onlineChargeId: payment.onlineChargeId,
      paidAt: payment.paidAt,
      recordedBy: payment.recordedBy,
      note: payment.note,
    })
    .returning();
  if (!record) throw new Error('Insert de pagamento sem retorno.');
  await refreshBookingPaymentStatus(tx, booking);
  await audit(tx, {
    actorId: payment.recordedBy,
    spaceId,
    action: 'payment.record',
    entity: 'payment_record',
    entityId: record.id,
    diff: {
      bookingId: booking.id,
      payableType: record.payableType,
      payableId: record.payableId,
      amountCents: record.amountCents,
      method: record.method,
      channel: record.channel,
      onlineChargeId: record.onlineChargeId,
      paidAt: record.paidAt.toISOString(),
    },
  });
  return record;
}
