import { BOOKING_PAYMENT_EXPIRED_REASON } from '@space-sports/shared';
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { PAYABLE_STATUSES } from '../bookings/booking-payments.js';
import type { DbOrTx } from '../bookings/db-utils.js';
import { bookings, courts } from '../db/schema/index.js';

/**
 * Reserva que conta nas métricas: confirmada, concluída ou no-show (a quadra ficou com o
 * cliente). São os mesmos status que podem ser cobrados (`PAYABLE_STATUSES`) e os das métricas do
 * Super: `PENDING_PAYMENT` ainda segura o horário à espera do pagamento online (RN-ONPAY-02) e
 * não conta; `CANCELLED` não conta.
 */
export const COUNTED_BOOKING_STATUSES = PAYABLE_STATUSES;

export const bookingCounts = (): SQL => inArray(bookings.status, [...COUNTED_BOOKING_STATUSES]);

/**
 * Reservas que entram na métrica de reservas: as que contam e as canceladas, menos as que
 * venceram sem pagamento online (`PAYMENT_EXPIRED`), que nunca chegaram a ser confirmadas.
 */
export const bookingCountsOrCancelled = (): SQL =>
  or(
    bookingCounts(),
    and(
      eq(bookings.status, 'CANCELLED'),
      sql`${bookings.cancelReason} IS DISTINCT FROM ${BOOKING_PAYMENT_EXPIRED_REASON}`,
    ),
  ) as SQL;

/** Quadras ativas do espaço, por nome (base das linhas por quadra e da ocupação). */
export function activeCourts(db: DbOrTx, spaceId: string, courtId?: string) {
  return db
    .select({ id: courts.id, name: courts.name })
    .from(courts)
    .where(
      and(
        eq(courts.spaceId, spaceId),
        eq(courts.status, 'ACTIVE'),
        courtId ? eq(courts.id, courtId) : undefined,
      ),
    )
    .orderBy(asc(courts.name), asc(courts.id));
}
