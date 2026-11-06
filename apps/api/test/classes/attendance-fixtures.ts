import { addMinutes } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import {
  attendances,
  auditLogs,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  courtOccupations,
} from '../../src/db/schema/index.js';
import type { Space } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';

// Lista de presença (tarefa 2.3): turmas e sessões inseridas direto no banco, com o horário que
// o teste precisa (o job de geração não entra aqui).

let nextMinute = 0;

/** Turma sem sessões geradas; horário semanal único para não colidir entre testes. */
export async function insertGroup(
  db: Database,
  space: Space,
  teacherMemberId: string,
  overrides: Partial<typeof classGroups.$inferInsert> = {},
) {
  const hour = nextMinute++ % 24;
  return db.transaction(async (tx) => {
    const group = first(
      await tx
        .insert(classGroups)
        .values({
          spaceId: space.id,
          sportId: space.sportId,
          courtId: space.courtA,
          name: `Turma ${crypto.randomUUID().slice(0, 6)}`,
          weekday: 1,
          startTime: `${String(hour).padStart(2, '0')}:00`,
          durationMin: 60,
          capacity: 10,
          ...overrides,
        })
        .returning(),
    );
    await tx
      .insert(classGroupTeachers)
      .values({ classGroupId: group.id, spaceId: group.spaceId, teacherMemberId });
    return group;
  });
}

/**
 * Sessão da turma começando daqui a `minutesFromNow` (60 min de aula). Cada chamada desloca
 * alguns segundos para não repetir `(turma, starts_at)`. Copia os professores da turma, sem
 * ocupar a agenda deles nem a quadra (as sessões dos testes se sobrepõem); `occupy` cria a ocupação
 * CLASS, como o job de geração faria.
 */
export async function insertSession(
  db: Database,
  group: typeof classGroups.$inferSelect,
  minutesFromNow: number,
  overrides: Partial<typeof classSessions.$inferInsert> = {},
  { occupy = false } = {},
) {
  const startsAt = new Date(Date.now() + minutesFromNow * 60_000 + nextMinute++ * 1000);
  const session = await db.transaction(async (tx) => {
    const row = first(
      await tx
        .insert(classSessions)
        .values({
          classGroupId: group.id,
          spaceId: group.spaceId,
          courtId: group.courtId,
          startsAt,
          endsAt: addMinutes(startsAt, 60),
          capacity: group.capacity,
          ...overrides,
        })
        .returning(),
    );
    const teachers = await tx
      .select({ teacherMemberId: classGroupTeachers.teacherMemberId })
      .from(classGroupTeachers)
      .where(eq(classGroupTeachers.classGroupId, group.id));
    await tx
      .insert(classSessionTeachers)
      .values(
        teachers.map((teacher) => ({ ...teacher, classSessionId: row.id, spaceId: row.spaceId })),
      );
    return row;
  });
  if (occupy) {
    await db.insert(courtOccupations).values({
      courtId: group.courtId,
      period: { start: session.startsAt, end: session.endsAt },
      kind: 'CLASS',
      refId: session.id,
    });
  }
  return session;
}

export const sessionById = async (db: Database, id: string) =>
  first(await db.select().from(classSessions).where(eq(classSessions.id, id)));

/** Lista da sessão por usuário. */
export async function listOf(db: Database, sessionId: string) {
  const rows = await db.select().from(attendances).where(eq(attendances.sessionId, sessionId));
  return new Map(rows.map((row) => [row.userId, row]));
}

export const auditOf = (db: Database, sessionId: string, action?: string) =>
  db
    .select()
    .from(auditLogs)
    .where(
      and(eq(auditLogs.entityId, sessionId), action ? eq(auditLogs.action, action) : undefined),
    );
