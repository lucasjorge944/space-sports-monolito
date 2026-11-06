import {
  DEFAULT_TIME_ZONE,
  OPEN_SUBSCRIPTION_STATUSES,
  zonedWeeklySlotsOverlap,
} from '@space-sports/shared';
import { and, asc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../bookings/db-utils.js';
import {
  attendances,
  cities,
  classGroups,
  classSessions,
  enrollments,
  spaces,
  subscriptions,
} from '../db/schema/index.js';
import { classSessionOverlap, type SessionOverlapConflict } from './attendance.errors.js';
import { classScheduleOverlap } from './subscriptions.errors.js';

// Choque de horário do aluno (RN-CLASS-01, decisão 37): duas aulas no mesmo horário não, em
// qualquer esporte, plano ou espaço. Na matrícula compara o horário semanal das turmas (cada uma
// no fuso do seu espaço); na lista de presença, o intervalo real das sessões.

type GroupRow = typeof classGroups.$inferSelect;

/** Na lista da aula, ocupa o horário do aluno: confirmado, na espera ou já presente. */
export const SCHEDULE_HOLDING_STATUSES = ['CONFIRMED', 'WAITLIST', 'PRESENT'] as const;

/**
 * Serializa, até o fim da transação, o que muda a agenda do aluno (matrícula e lista de
 * presença), além das travas de assinatura, turma e sessão: duas confirmações simultâneas em
 * espaços diferentes no mesmo horário não passam as duas. Pegue antes das travas de turma e de
 * sessão (a de assinatura pode vir antes).
 */
export async function lockStudentSchedule(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`student-schedule:${userId}`}, 0))`,
  );
}

/**
 * Recusa (409 `CLASS_SCHEDULE_OVERLAP`) a turma de `targets` cujo horário semanal coincide com
 * outra turma ativa em que o aluno está matriculado ou pediu matrícula, em qualquer assinatura em
 * aberto fora `exceptSubscriptionId` (a própria assinatura é conferida à parte, entre as turmas
 * escolhidas).
 */
export async function assertNoScheduleOverlap(
  tx: DbOrTx,
  userId: string,
  targets: GroupRow[],
  exceptSubscriptionId?: string,
  now: Date = new Date(),
): Promise<void> {
  if (!targets.length) return;
  const held = await tx
    .select({
      id: classGroups.id,
      name: classGroups.name,
      weekday: classGroups.weekday,
      startTime: classGroups.startTime,
      durationMin: classGroups.durationMin,
      spaceName: spaces.name,
      timeZone: cities.timezone,
    })
    .from(enrollments)
    .innerJoin(subscriptions, eq(subscriptions.id, enrollments.subscriptionId))
    .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
    .innerJoin(spaces, eq(spaces.id, classGroups.spaceId))
    .innerJoin(cities, eq(cities.id, spaces.cityId))
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...OPEN_SUBSCRIPTION_STATUSES]),
        exceptSubscriptionId ? ne(subscriptions.id, exceptSubscriptionId) : undefined,
        inArray(enrollments.status, ['PENDING', 'ACTIVE']),
        eq(classGroups.active, true),
      ),
    )
    .orderBy(asc(classGroups.weekday), asc(classGroups.startTime));
  if (!held.length) return;

  const zones = await tx
    .select({ spaceId: spaces.id, timeZone: cities.timezone })
    .from(spaces)
    .innerJoin(cities, eq(cities.id, spaces.cityId))
    .where(inArray(spaces.id, [...new Set(targets.map((group) => group.spaceId))]));
  const zoneOf = new Map(zones.map((row) => [row.spaceId, row.timeZone || DEFAULT_TIME_ZONE]));
  for (const target of targets) {
    const slot = { ...target, timeZone: zoneOf.get(target.spaceId) ?? DEFAULT_TIME_ZONE };
    for (const other of held) {
      if (other.id === target.id) continue;
      const timeZone = other.timeZone || DEFAULT_TIME_ZONE;
      if (zonedWeeklySlotsOverlap(slot, { ...other, timeZone }, now)) {
        throw classScheduleOverlap(target.id, {
          classGroupName: other.name,
          spaceName: other.spaceName,
          weekday: other.weekday,
          startTime: other.startTime.slice(0, 5),
          durationMin: other.durationMin,
          timeZone,
        });
      }
    }
  }
}

/** Aula da agenda do aluno (está na lista dela) que ocupa algum instante de um intervalo. */
interface HeldSession extends SessionOverlapConflict {
  sessionId: string;
}

/**
 * Aulas não canceladas em que o aluno está confirmado, na espera ou presente e que se sobrepõem
 * ao intervalo `[from, to)`.
 */
export async function heldSessions(
  db: DbOrTx,
  userId: string,
  from: Date,
  to: Date,
): Promise<HeldSession[]> {
  const rows = await db
    .select({
      sessionId: classSessions.id,
      classGroupName: classGroups.name,
      spaceName: spaces.name,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
    })
    .from(attendances)
    .innerJoin(classSessions, eq(classSessions.id, attendances.sessionId))
    .innerJoin(classGroups, eq(classGroups.id, classSessions.classGroupId))
    .innerJoin(spaces, eq(spaces.id, classSessions.spaceId))
    .where(
      and(
        eq(attendances.userId, userId),
        inArray(attendances.status, [...SCHEDULE_HOLDING_STATUSES]),
        ne(classSessions.status, 'CANCELLED'),
        lt(classSessions.startsAt, to),
        gt(classSessions.endsAt, from),
      ),
    )
    .orderBy(asc(classSessions.startsAt));
  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
}

/** A outra aula da agenda do aluno que se sobrepõe à sessão, se houver. */
export function sessionOverlap(
  held: HeldSession[],
  session: { id: string; startsAt: Date; endsAt: Date },
): SessionOverlapConflict | null {
  const found = held.find(
    (other) =>
      other.sessionId !== session.id &&
      new Date(other.startsAt) < session.endsAt &&
      session.startsAt < new Date(other.endsAt),
  );
  if (!found) return null;
  const { sessionId: _, ...conflict } = found;
  return conflict;
}

/**
 * Recusa (409 `CLASS_SESSION_OVERLAP`) entrar na lista de uma aula que se sobrepõe a outra em que
 * o aluno já está confirmado ou na espera. Chame com a trava `lockStudentSchedule`.
 */
export async function assertNoSessionOverlap(
  tx: Tx,
  userId: string,
  session: { id: string; startsAt: Date; endsAt: Date },
): Promise<void> {
  const held = await heldSessions(tx, userId, session.startsAt, session.endsAt);
  const conflict = sessionOverlap(held, session);
  if (conflict) throw classSessionOverlap(conflict);
}
