import type { DeletionSpacePending } from '@space-sports/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import { UPCOMING_STATUSES } from '../classes/attendance-core.js';

type PendingRow = {
  user_id: string;
  space_id: string;
  space_name: string;
  upcoming_bookings: number;
  upcoming_occurrences: number;
  open_recurring: number;
  open_subscriptions: number;
  upcoming_attendances: number;
  open_charges: number;
  open_charges_cents: number;
  bookings_due_cents: number;
};

const list = (values: readonly string[]): SQL =>
  sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;

/**
 * Pendências das contas por espaço (decisão 40): o que a exclusão cancela e o que fica em aberto
 * no espaço. Uma consulta para a página inteira de pedidos; espaços sem nenhuma pendência ficam
 * de fora. Os valores em aberto descontam os pagamentos não estornados.
 */
export async function deletionPendingByUser(
  db: DbOrTx,
  userIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, DeletionSpacePending[]>> {
  const result = new Map<string, DeletionSpacePending[]>();
  if (!userIds.length) return result;
  const ids = list(userIds);
  const { rows } = await db.execute<PendingRow>(sql`
    WITH items AS (
      SELECT b.organizer_user_id AS user_id, b.space_id,
        count(*) FILTER (WHERE b.recurring_booking_id IS NULL)::int AS upcoming_bookings,
        count(*) FILTER (WHERE b.recurring_booking_id IS NOT NULL)::int AS upcoming_occurrences,
        0 AS open_recurring, 0 AS open_subscriptions, 0 AS upcoming_attendances,
        0 AS open_charges, 0::bigint AS open_charges_cents, 0::bigint AS bookings_due_cents
      FROM bookings b
      WHERE b.organizer_user_id IN ${ids} AND b.status IN ('CONFIRMED', 'PENDING_PAYMENT') AND b.starts_at > ${now}
      GROUP BY 1, 2
      UNION ALL
      SELECT r.user_id, r.space_id, 0, 0, count(*)::int, 0, 0, 0, 0, 0
      FROM recurring_bookings r
      WHERE r.user_id IN ${ids} AND r.status IN ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED')
      GROUP BY 1, 2
      UNION ALL
      SELECT s.user_id, s.space_id, 0, 0, 0, count(*)::int, 0, 0, 0, 0
      FROM subscriptions s
      WHERE s.user_id IN ${ids} AND s.status IN ('PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE')
      GROUP BY 1, 2
      UNION ALL
      SELECT a.user_id, cs.space_id, 0, 0, 0, 0, count(*)::int, 0, 0, 0
      FROM attendances a
      JOIN class_sessions cs ON cs.id = a.session_id
      WHERE a.user_id IN ${ids} AND a.status IN ('CONFIRMED', 'WAITLIST')
        AND cs.status IN ${list(UPCOMING_STATUSES)} AND cs.starts_at > ${now}
      GROUP BY 1, 2
      UNION ALL
      SELECT s.user_id, s.space_id, 0, 0, 0, 0, 0, count(*)::int,
        sum(greatest(c.amount_cents - coalesce((
          SELECT sum(pr.amount_cents) FROM payment_records pr
          WHERE pr.payable_type = 'SUBSCRIPTION_CHARGE' AND pr.payable_id = c.id
            AND pr.reversed_at IS NULL
        ), 0), 0))::bigint,
        0
      FROM subscription_charges c
      JOIN subscriptions s ON s.id = c.subscription_id
      WHERE s.user_id IN ${ids} AND c.status IN ('PENDING', 'OVERDUE')
      GROUP BY 1, 2
      UNION ALL
      SELECT r.user_id, r.space_id, 0, 0, 0, 0, 0, count(*)::int,
        sum(greatest(c.amount_cents - coalesce((
          SELECT sum(pr.amount_cents) FROM payment_records pr
          WHERE pr.payable_type = 'RECURRING_BOOKING_CHARGE' AND pr.payable_id = c.id
            AND pr.reversed_at IS NULL
        ), 0), 0))::bigint,
        0
      FROM recurring_booking_charges c
      JOIN recurring_bookings r ON r.id = c.recurring_booking_id
      WHERE r.user_id IN ${ids} AND c.status IN ('PENDING', 'OVERDUE')
      GROUP BY 1, 2
      UNION ALL
      -- Reservas que já começaram (as futuras são canceladas) e ainda não foram quitadas.
      SELECT b.organizer_user_id, b.space_id, 0, 0, 0, 0, 0, 0, 0,
        sum(greatest(b.price_cents - coalesce((
          SELECT sum(pr.amount_cents) FROM payment_records pr
          WHERE pr.reversed_at IS NULL AND (
            (pr.payable_type = 'BOOKING' AND pr.payable_id = b.id)
            OR (pr.payable_type = 'BOOKING_PARTICIPANT' AND pr.payable_id IN (
              SELECT bp.id FROM booking_participants bp WHERE bp.booking_id = b.id
            ))
          )
        ), 0), 0))::bigint
      FROM bookings b
      WHERE b.organizer_user_id IN ${ids} AND b.price_cents > 0 AND b.payment_status <> 'PAID'
        AND (b.status IN ('COMPLETED', 'NO_SHOW') OR (b.status = 'CONFIRMED' AND b.starts_at <= ${now}))
      GROUP BY 1, 2
    )
    SELECT i.user_id, i.space_id, sp.name AS space_name,
      sum(i.upcoming_bookings)::int AS upcoming_bookings,
      sum(i.upcoming_occurrences)::int AS upcoming_occurrences,
      sum(i.open_recurring)::int AS open_recurring,
      sum(i.open_subscriptions)::int AS open_subscriptions,
      sum(i.upcoming_attendances)::int AS upcoming_attendances,
      sum(i.open_charges)::int AS open_charges,
      sum(i.open_charges_cents)::int AS open_charges_cents,
      sum(i.bookings_due_cents)::int AS bookings_due_cents
    FROM items i
    JOIN spaces sp ON sp.id = i.space_id
    GROUP BY i.user_id, i.space_id, sp.name
    ORDER BY sp.name, i.space_id`);

  for (const row of rows) {
    const pending: DeletionSpacePending = {
      spaceId: row.space_id,
      spaceName: row.space_name,
      upcomingBookings: row.upcoming_bookings,
      upcomingRecurringOccurrences: row.upcoming_occurrences,
      openRecurringBookings: row.open_recurring,
      openSubscriptions: row.open_subscriptions,
      upcomingClassAttendances: row.upcoming_attendances,
      openCharges: row.open_charges,
      openChargesCents: row.open_charges_cents,
      bookingsDueCents: row.bookings_due_cents,
    };
    // Mensalidade e reserva já quitadas não entram: só o que deixa algo para o espaço tratar.
    if (Object.values(pending).every((value) => typeof value === 'string' || value === 0)) continue;
    result.set(row.user_id, [...(result.get(row.user_id) ?? []), pending]);
  }
  return result;
}
