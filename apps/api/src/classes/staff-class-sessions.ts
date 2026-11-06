import type { SpaceRole, StaffTodayClassSession } from '@space-sports/shared';
import { and, eq, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import { classSessions } from '../db/schema/index.js';
import { attendeesOf } from './attendance.service.js';
import { sessionRows } from './class-sessions.service.js';
import { teacherRef } from './class-teachers.js';
import { classesScope, sessionScope } from './classes-scope.js';

/** Dia local de um espaço em UTC, `[from, to)`, e os papéis do usuário nele. */
export interface StaffDay {
  spaceId: string;
  roles: readonly SpaceRole[];
  from: Date;
  to: Date;
}

/**
 * Aulas do dia na visão de equipe do app (RF-CLASS-07, decisão 21: só leitura, sem valores),
 * com a lista de cada uma. Quem é só Professor vê as dele (matriz de docs/02). Devolve por
 * espaço.
 */
export async function staffTodayClassSessions(
  db: DbOrTx,
  userId: string,
  days: StaffDay[],
): Promise<Map<string, StaffTodayClassSession[]>> {
  const result = new Map<string, StaffTodayClassSession[]>(days.map((d) => [d.spaceId, []]));
  if (!days.length) return result;
  const filters: SQL[] = [];
  for (const day of days) {
    const scope = await classesScope(db, day.spaceId, userId, day.roles);
    const filter = and(
      eq(classSessions.spaceId, day.spaceId),
      gte(classSessions.startsAt, day.from),
      lt(classSessions.startsAt, day.to),
      sessionScope(scope),
    );
    if (filter) filters.push(filter);
  }
  const ids = await db
    .select({ id: classSessions.id, spaceId: classSessions.spaceId })
    .from(classSessions)
    .where(or(...filters));
  if (!ids.length) return result;
  const spaceOf = new Map(ids.map((row) => [row.id, row.spaceId]));
  const sessions = await sessionRows(
    db,
    inArray(
      classSessions.id,
      ids.map((row) => row.id),
    ),
  );
  const lists = await attendeesOf(db, [...spaceOf.keys()]);
  for (const session of sessions) {
    const spaceId = spaceOf.get(session.id);
    if (!spaceId) continue;
    result.get(spaceId)?.push({
      id: session.id,
      classGroup: session.classGroup,
      sportName: session.sport.name,
      court: session.court,
      teachers: session.teachers.map(teacherRef),
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      capacity: session.capacity,
      confirmedCount: session.confirmedCount,
      waitlistCount: session.waitlistCount,
      attendees: lists
        .filter((row) => row.sessionId === session.id)
        .map(({ sessionId: _, addedByStaff: __, ...attendee }) => attendee),
    });
  }
  return result;
}
