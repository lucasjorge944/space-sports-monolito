import { DEFAULT_TIME_ZONE, utcToZoned } from '@space-sports/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../bookings/db-utils.js';
import { releaseUpcomingAttendances } from '../classes/attendance-core.js';
import { unlinkTeacher } from '../classes/class-teachers.js';
import { dropUnbilledCharges, endEnrollments } from '../classes/subscription-billing.js';
import {
  bookings,
  cities,
  courtOccupations,
  enrollments,
  recurringBookings,
  spaceMembers,
  spaces,
  subscriptionCharges,
  subscriptions,
} from '../db/schema/index.js';
import { cancelUpcomingOccurrences } from '../recurring/occurrences.service.js';
import { lockSpace } from '../team/team.service.js';

/** Motivo gravado nas reservas, mensalistas e assinaturas encerrados pela exclusão. */
export const ACCOUNT_DELETED_REASON = 'Conta excluída a pedido do titular';

export type DeletionCleanup = {
  /** Reservas avulsas canceladas (para avisar os participantes da conta dividida). */
  cancelledBookingIds: string[];
  /**
   * Todas as reservas futuras canceladas, ocorrências de mensalista inclusive: o pagamento online
   * delas é estornado (RN-ONPAY-05).
   */
  allCancelledBookingIds: string[];
  /** Quem saiu da espera com a vaga liberada (RF-CLASS-10). */
  promoted: { sessionId: string; userId: string }[];
  /** Contagens para a auditoria. */
  counts: {
    bookings: number;
    occurrences: number;
    recurringBookings: number;
    subscriptions: number;
    attendances: number;
  };
};

/**
 * Atendimento do pedido de exclusão (decisão 40), antes da anonimização e na mesma transação:
 * encerra os mensalistas do titular (as ocorrências futuras são canceladas), cancela as reservas
 * futuras em que ele é o organizador, sempre liberando a ocupação da quadra, encerra as
 * assinaturas de aula (as mensalidades de ciclos futuros sem pagamento são apagadas; as do ciclo
 * atual e as vencidas ficam em aberto no espaço), tira o titular das aulas que ainda não
 * começaram, promovendo a espera, e das listas de professores em que há outro professor. Na aula
 * sem outro professor ele fica, já anonimizado: a pendência não impede a exclusão. Os pagamentos no
 * local não são tocados; o online é estornado por quem chama (`OnlineChargesService.onAccountDeleted`).
 * Quem chama trava a linha do usuário.
 */
export async function cancelUserCommitments(
  tx: Tx,
  userId: string,
  actorId: string,
  now: Date = new Date(),
): Promise<DeletionCleanup> {
  const today = await spaceTodays(tx, userId, now);

  // Mensalistas: como o encerramento pela gestão, com o fim registrado hoje (no fuso do espaço).
  const openRecurring = await tx
    .select({ id: recurringBookings.id, spaceId: recurringBookings.spaceId })
    .from(recurringBookings)
    .where(
      and(
        eq(recurringBookings.userId, userId),
        inArray(recurringBookings.status, ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED']),
      ),
    )
    .orderBy(asc(recurringBookings.id))
    .for('update');
  let occurrences = 0;
  for (const recurring of openRecurring) {
    await tx
      .update(recurringBookings)
      .set({
        status: 'ENDED',
        statusReason: ACCOUNT_DELETED_REASON,
        // Nunca antes do início (constraint recurring_bookings_dates_valid).
        endsOn: sql`greatest(${today(recurring.spaceId)}::date, ${recurringBookings.startsOn})`,
      })
      .where(eq(recurringBookings.id, recurring.id));
    occurrences += await cancelUpcomingOccurrences(tx, recurring.id, actorId, 'END', now);
  }

  // Reservas futuras restantes em que ele é o organizador (avulsas e alguma ocorrência solta).
  const cancelled = await tx
    .update(bookings)
    .set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: actorId,
      cancelReason: ACCOUNT_DELETED_REASON,
    })
    .where(
      and(
        eq(bookings.organizerUserId, userId),
        inArray(bookings.status, ['CONFIRMED', 'PENDING_PAYMENT']),
        gt(bookings.startsAt, now),
      ),
    )
    .returning({ id: bookings.id, recurringBookingId: bookings.recurringBookingId });
  if (cancelled.length) {
    // O pagamento online dessas reservas (cobrança aberta e estorno) fica com quem chama
    // (OnlineChargesService.onAccountDeleted), na mesma transação.
    await tx
      .update(courtOccupations)
      .set({ active: false })
      .where(
        and(
          eq(courtOccupations.kind, 'BOOKING'),
          inArray(
            courtOccupations.refId,
            cancelled.map((b) => b.id),
          ),
        ),
      );
  }
  const single = cancelled.filter((b) => !b.recurringBookingId).map((b) => b.id);
  occurrences += cancelled.length - single.length;

  // Assinaturas: encerradas na hora (a vaga nas turmas é liberada hoje).
  const openSubscriptions = await tx
    .select({ id: subscriptions.id, spaceId: subscriptions.spaceId, status: subscriptions.status })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ['PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE']),
      ),
    )
    .orderBy(asc(subscriptions.id))
    .for('update');
  for (const sub of openSubscriptions) {
    const day = today(sub.spaceId);
    await tx
      .delete(enrollments)
      .where(and(eq(enrollments.subscriptionId, sub.id), eq(enrollments.status, 'PENDING')));
    await endEnrollments(tx, sub.id, day);
    await tx
      .update(subscriptions)
      .set({
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: actorId,
        statusReason: ACCOUNT_DELETED_REASON,
      })
      .where(eq(subscriptions.id, sub.id));
    await dropUnbilledCharges(tx, sub.id, gt(subscriptionCharges.periodStart, day));
  }

  // Aulas que ainda não começaram: sai da lista (e da espera); a vaga vai para a espera.
  const { released, promoted } = await releaseUpcomingAttendances(tx, userId, now);

  await leaveTeacherLists(tx, userId, now);

  return {
    cancelledBookingIds: single,
    allCancelledBookingIds: cancelled.map((b) => b.id),
    promoted,
    counts: {
      bookings: single.length,
      occurrences,
      recurringBookings: openRecurring.length,
      subscriptions: openSubscriptions.length,
      attendances: released,
    },
  };
}

/**
 * Sai das listas de professores de cada espaço, em ordem. Trava o espaço e o vínculo, como a saída
 * pela equipe: duas saídas simultâneas não deixam a mesma aula sem ninguém.
 */
async function leaveTeacherLists(tx: Tx, userId: string, now: Date): Promise<void> {
  const members = await tx
    .select({ id: spaceMembers.id, spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.role, 'TEACHER'),
        eq(spaceMembers.status, 'ACTIVE'),
      ),
    )
    .orderBy(asc(spaceMembers.spaceId));
  for (const member of members) {
    await lockSpace(tx, member.spaceId);
    await tx
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(eq(spaceMembers.id, member.id))
      .for('update');
    await unlinkTeacher(tx, { id: member.id, userId }, now);
  }
}

/** "Hoje" no fuso de cada espaço em que o usuário tem mensalista ou assinatura. */
async function spaceTodays(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<(spaceId: string) => string> {
  const rows = await tx
    .select({ id: spaces.id, timeZone: cities.timezone })
    .from(spaces)
    .innerJoin(cities, eq(cities.id, spaces.cityId))
    .where(
      sql`${spaces.id} IN (
        SELECT space_id FROM recurring_bookings WHERE user_id = ${userId}
        UNION SELECT space_id FROM subscriptions WHERE user_id = ${userId}
      )`,
    );
  const zones = new Map(rows.map((row) => [row.id, row.timeZone || DEFAULT_TIME_ZONE]));
  return (spaceId) => utcToZoned(now, zones.get(spaceId) ?? DEFAULT_TIME_ZONE).date;
}
