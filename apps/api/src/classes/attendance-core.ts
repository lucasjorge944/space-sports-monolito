import type { AttendanceStatus, ClassSessionStatus } from '@space-sports/shared';
import { and, asc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm';
import type { Tx } from '../bookings/db-utils.js';
import { attendances, classSessions } from '../db/schema/index.js';

export type SessionRow = typeof classSessions.$inferSelect;
export type AttendanceRow = typeof attendances.$inferSelect;

/** Sessões que ainda vão acontecer: a lista pode mudar (o job leva a DONE depois do fim). */
export const UPCOMING_STATUSES: readonly ClassSessionStatus[] = ['SCHEDULED', 'OPEN', 'CLOSED'];

/**
 * Status que ocupam vaga: o confirmado e quem já teve a presença marcada (presente ou faltoso).
 * Depois da chamada, o confirmado vira `PRESENT`/`ABSENT` e a vaga continua dele.
 */
export const OCCUPYING_STATUSES: readonly AttendanceStatus[] = ['CONFIRMED', 'PRESENT', 'ABSENT'];

/** Presença real já marcada (RF-CLASS-09). */
export const MARKED_STATUSES: readonly AttendanceStatus[] = ['PRESENT', 'ABSENT'];

/**
 * Trava a linha da sessão (`FOR UPDATE`). Toda mudança na lista e no status da sessão passa por
 * aqui: a contagem de confirmados e as posições da espera são lidas e gravadas com a linha
 * travada, então duas confirmações simultâneas na última vaga não passam as duas (RN-CLASS-03).
 */
export async function lockSession(tx: Tx, where: SQL | undefined): Promise<SessionRow | undefined> {
  const [row] = await tx.select().from(classSessions).where(where).for('update');
  return row;
}

/** Vagas ocupadas da sessão (`OCCUPYING_STATUSES`). */
export async function occupiedCount(tx: Tx, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(attendances)
    .where(
      and(
        eq(attendances.sessionId, sessionId),
        inArray(attendances.status, [...OCCUPYING_STATUSES]),
      ),
    );
  return row?.count ?? 0;
}

async function lastWaitlistPosition(tx: Tx, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${attendances.waitlistPosition}), 0)::int` })
    .from(attendances)
    .where(and(eq(attendances.sessionId, sessionId), eq(attendances.status, 'WAITLIST')));
  return row?.max ?? 0;
}

export async function attendanceOf(
  tx: Tx,
  sessionId: string,
  userId: string,
): Promise<AttendanceRow | undefined> {
  const [row] = await tx
    .select()
    .from(attendances)
    .where(and(eq(attendances.sessionId, sessionId), eq(attendances.userId, userId)));
  return row;
}

/**
 * Põe o aluno na lista (sessão já travada): confirmado se há vaga, senão no fim da espera
 * (RN-CLASS-03). Reaproveita a linha de quem tinha desistido (`UNIQUE(session_id, user_id)`).
 */
export async function placeAttendee(
  tx: Tx,
  session: SessionRow,
  userId: string,
  addedByStaff: boolean,
): Promise<AttendanceRow> {
  const occupied = await occupiedCount(tx, session.id);
  const values =
    occupied < session.capacity
      ? { status: 'CONFIRMED' as const, waitlistPosition: null }
      : {
          status: 'WAITLIST' as const,
          waitlistPosition: (await lastWaitlistPosition(tx, session.id)) + 1,
        };
  const [row] = await tx
    .insert(attendances)
    .values({ sessionId: session.id, userId, addedByStaff, ...values })
    .onConflictDoUpdate({
      target: [attendances.sessionId, attendances.userId],
      set: { ...values, addedByStaff },
    })
    .returning();
  if (!row) throw new Error('Upsert de presença sem retorno.');
  return row;
}

/**
 * Tira o aluno da lista (desistência ou remoção pela gestão). A vaga liberada vai para a espera
 * (RN-CLASS-05, RF-CLASS-10). Devolve os promovidos.
 */
export async function releaseAttendee(
  tx: Tx,
  session: SessionRow,
  row: AttendanceRow,
): Promise<string[]> {
  await tx
    .update(attendances)
    .set({ status: 'CANCELLED', waitlistPosition: null })
    .where(eq(attendances.id, row.id));
  if (row.status === 'WAITLIST') {
    await renumberWaitlist(tx, session.id);
    return [];
  }
  return promoteWaitlist(tx, session);
}

/**
 * Tira o aluno das aulas que ainda não começaram (confirmado ou na espera), só das que `filter`
 * seleciona, e passa a vaga para a espera. Em ordem de sessão, a mesma trava das confirmações (sem
 * deadlock entre elas). Devolve quantas saíram e quem saiu da espera, para avisar depois do commit.
 */
export async function releaseUpcomingAttendances(
  tx: Tx,
  userId: string,
  now: Date,
  filter?: SQL,
): Promise<{ released: number; promoted: { sessionId: string; userId: string }[] }> {
  const listed = await tx
    .selectDistinct({ sessionId: attendances.sessionId })
    .from(attendances)
    .innerJoin(classSessions, eq(classSessions.id, attendances.sessionId))
    .where(
      and(
        eq(attendances.userId, userId),
        inArray(attendances.status, ['CONFIRMED', 'WAITLIST']),
        inArray(classSessions.status, [...UPCOMING_STATUSES]),
        gt(classSessions.startsAt, now),
        filter,
      ),
    )
    .orderBy(asc(attendances.sessionId));
  const promoted: { sessionId: string; userId: string }[] = [];
  let released = 0;
  for (const { sessionId } of listed) {
    const session = await lockSession(tx, eq(classSessions.id, sessionId));
    const row = session && (await attendanceOf(tx, sessionId, userId));
    if (!session || !row || (row.status !== 'CONFIRMED' && row.status !== 'WAITLIST')) continue;
    released++;
    for (const promotedId of await releaseAttendee(tx, session, row)) {
      promoted.push({ sessionId, userId: promotedId });
    }
  }
  return { released, promoted };
}

/**
 * Promove a espera, por ordem, enquanto houver vaga (desistência, remoção ou aumento da
 * capacidade). Só em sessão que ainda não começou: com a aula em andamento ninguém sai da espera
 * (seria avisado de uma vaga que não dá mais para usar). Devolve os promovidos.
 */
export async function promoteWaitlist(
  tx: Tx,
  session: SessionRow,
  now: Date = new Date(),
): Promise<string[]> {
  if (!UPCOMING_STATUSES.includes(session.status) || session.startsAt <= now) return [];
  const free = session.capacity - (await occupiedCount(tx, session.id));
  if (free <= 0) return [];
  const next = await tx
    .select({ id: attendances.id, userId: attendances.userId })
    .from(attendances)
    .where(and(eq(attendances.sessionId, session.id), eq(attendances.status, 'WAITLIST')))
    .orderBy(asc(attendances.waitlistPosition))
    .limit(free);
  for (const { id } of next) {
    await tx
      .update(attendances)
      .set({ status: 'CONFIRMED', waitlistPosition: null })
      .where(eq(attendances.id, id));
  }
  if (next.length) await renumberWaitlist(tx, session.id);
  return next.map((row) => row.userId);
}

/** Refaz as posições da espera (1, 2, 3…) mantendo a ordem. */
export async function renumberWaitlist(tx: Tx, sessionId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE ${attendances} AS a
    SET waitlist_position = ranked.position, updated_at = now()
    FROM (
      SELECT id, row_number() OVER (ORDER BY waitlist_position, id)::int AS position
      FROM ${attendances}
      WHERE session_id = ${sessionId} AND status = 'WAITLIST'
    ) AS ranked
    WHERE a.id = ranked.id AND a.waitlist_position IS DISTINCT FROM ranked.position
  `);
}
