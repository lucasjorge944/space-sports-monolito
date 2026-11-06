import {
  addDays,
  addMinutes,
  DEFAULT_TIME_ZONE,
  type Teacher,
  type TeacherRef,
  timeToMinutes,
  utcToZoned,
  type WeeklySlot,
  weekdayDates,
  zonedToUtc,
  zonedWeeklySlotsOverlap,
} from '@space-sports/shared';
import { and, asc, eq, gt, inArray, ne, not, type SQL, sql } from 'drizzle-orm';
import { type DbOrTx, isTeacherOverlapViolation, type Tx } from '../bookings/db-utils.js';
import type { SpaceContext } from '../bookings/space-context.js';
import {
  cities,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  spaceMembers,
  spaces,
  teacherOccupations,
  users,
} from '../db/schema/index.js';
import { teacherHasClassGroups } from '../team/team.errors.js';
import { UPCOMING_STATUSES } from './attendance-core.js';
import { teacherNotFound, teacherScheduleConflict } from './classes.errors.js';

// Professores das turmas e aulas (decisão 47). A turma define a lista padrão, que as sessões
// copiam, e a aula pode ter a própria. A agenda é por usuário, porque o vínculo TEACHER é por
// espaço: `teacher_occupations` recusa no banco a sobreposição entre espaços; no mesmo espaço pode.

type SessionPeriod = Pick<typeof classSessions.$inferSelect, 'startsAt' | 'endsAt'>;
type SessionRef = SessionPeriod & Pick<typeof classSessions.$inferSelect, 'id' | 'spaceId'>;
type GroupRef = Pick<typeof classGroups.$inferSelect, 'id' | 'spaceId'>;

const teacherFields = {
  memberId: spaceMembers.id,
  userId: users.id,
  name: users.name,
  avatarUrl: users.avatarUrl,
};

/** Só nome e foto: app do jogador, matrículas, visão de equipe e página pública. */
export const teacherRef = ({ name, avatarUrl }: Teacher): TeacherRef => ({ name, avatarUrl });

function byOwner(rows: (Teacher & { ownerId: string })[]): Map<string, Teacher[]> {
  const result = new Map<string, Teacher[]>();
  for (const { ownerId, ...teacher } of rows) {
    result.set(ownerId, [...(result.get(ownerId) ?? []), teacher]);
  }
  return result;
}

/** Professores por turma, por nome. */
export async function groupTeachers(
  db: DbOrTx,
  groupIds: string[],
): Promise<Map<string, Teacher[]>> {
  if (!groupIds.length) return new Map();
  return byOwner(
    await db
      .select({ ownerId: classGroupTeachers.classGroupId, ...teacherFields })
      .from(classGroupTeachers)
      .innerJoin(spaceMembers, eq(spaceMembers.id, classGroupTeachers.teacherMemberId))
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(inArray(classGroupTeachers.classGroupId, groupIds))
      .orderBy(asc(users.name), asc(spaceMembers.id)),
  );
}

/** Professores por aula, por nome. */
export async function sessionTeachers(
  db: DbOrTx,
  sessionIds: string[],
): Promise<Map<string, Teacher[]>> {
  if (!sessionIds.length) return new Map();
  return byOwner(
    await db
      .select({ ownerId: classSessionTeachers.classSessionId, ...teacherFields })
      .from(classSessionTeachers)
      .innerJoin(spaceMembers, eq(spaceMembers.id, classSessionTeachers.teacherMemberId))
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(inArray(classSessionTeachers.classSessionId, sessionIds))
      .orderBy(asc(users.name), asc(spaceMembers.id)),
  );
}

/**
 * Lista da turma para gerar aulas, com as linhas dos vínculos travadas. Lê de novo depois da trava:
 * quem saiu da equipe enquanto ela esperava (`releaseTeacher`) não entra na aula gerada.
 */
export async function lockGroupTeachers(tx: Tx, groupId: string): Promise<Teacher[]> {
  const listed = (await groupTeachers(tx, [groupId])).get(groupId) ?? [];
  await tx
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      inArray(
        spaceMembers.id,
        listed.map((teacher) => teacher.memberId),
      ),
    )
    .orderBy(asc(spaceMembers.id))
    .for('share');
  return (await groupTeachers(tx, [groupId])).get(groupId) ?? [];
}

/** A lista tem exatamente esses vínculos, em qualquer ordem? */
export function sameTeachers(teachers: readonly Teacher[], memberIds: readonly string[]): boolean {
  const ids = new Set(memberIds);
  return teachers.length === ids.size && teachers.every((teacher) => ids.has(teacher.memberId));
}

/**
 * RF-CLASS-01: todos são vínculos TEACHER ativos deste espaço. As linhas ficam travadas até o fim
 * da transação: a equipe trava a mesma linha antes de tirar alguém das listas, então as duas
 * operações não passam ao mesmo tempo.
 */
export async function assertTeachers(
  tx: Tx,
  spaceId: string,
  memberIds: readonly string[],
): Promise<Teacher[]> {
  const rows = await tx
    .select(teacherFields)
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(
      and(
        inArray(spaceMembers.id, [...memberIds]),
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.role, 'TEACHER'),
        eq(spaceMembers.status, 'ACTIVE'),
      ),
    )
    .orderBy(asc(spaceMembers.id))
    .for('share', { of: spaceMembers });
  if (rows.length !== memberIds.length) throw teacherNotFound();
  return rows;
}

/**
 * Serializa, até o fim da transação, o que muda a agenda de um professor em qualquer espaço: duas
 * edições simultâneas não esperam uma pela outra na constraint (deadlock) e a checagem do horário
 * semanal, que só existe na aplicação, enxerga a turma que acabou de entrar. Em ordem de id; chame
 * uma vez por transação com todos os professores que ela pode pôr em aulas.
 */
export async function lockTeacherSchedule(tx: Tx, userIds: readonly string[]): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`teacher-schedule:${userId}`}, 0))`,
    );
  }
}

/** Quem tem aula ativa em outro espaço em algum instante de `[startsAt, endsAt)`. */
export async function busyElsewhere(
  tx: Tx,
  spaceId: string,
  teachers: readonly Teacher[],
  { startsAt, endsAt }: SessionPeriod,
): Promise<Set<string>> {
  if (!teachers.length) return new Set();
  const rows = await tx
    .selectDistinct({ userId: teacherOccupations.userId })
    .from(teacherOccupations)
    .where(
      and(
        inArray(
          teacherOccupations.userId,
          teachers.map((teacher) => teacher.userId),
        ),
        ne(teacherOccupations.spaceId, spaceId),
        eq(teacherOccupations.active, true),
        sql`${teacherOccupations.period} && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)')`,
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/** Próxima data do horário semanal: é a que a mensagem de conflito mostra. */
function nextOccurrence(slot: WeeklySlot, timeZone: string, now: Date): SessionPeriod {
  const today = utcToZoned(now, timeZone).date;
  const [date] = weekdayDates(slot.weekday, addDays(today, 1), addDays(today, 7));
  if (!date) throw new Error('Próxima data da turma não encontrada.');
  const startsAt = zonedToUtc(date, timeToMinutes(slot.startTime), timeZone);
  return { startsAt, endsAt: addMinutes(startsAt, slot.durationMin) };
}

/**
 * Recusa (409 `TEACHER_SCHEDULE_CONFLICT`) o horário semanal que coincide com uma turma ativa do
 * professor em outro espaço, cada uma no fuso do seu espaço. As aulas já geradas são conferidas
 * na geração. Chame com a trava `lockTeacherSchedule`.
 */
export async function assertTeachersWeeklyFree(
  tx: Tx,
  space: SpaceContext,
  slot: WeeklySlot,
  teachers: readonly Teacher[],
  now: Date = new Date(),
): Promise<void> {
  if (!teachers.length) return;
  const others = await tx
    .select({
      userId: spaceMembers.userId,
      weekday: classGroups.weekday,
      startTime: classGroups.startTime,
      durationMin: classGroups.durationMin,
      timeZone: cities.timezone,
    })
    .from(classGroupTeachers)
    .innerJoin(spaceMembers, eq(spaceMembers.id, classGroupTeachers.teacherMemberId))
    .innerJoin(classGroups, eq(classGroups.id, classGroupTeachers.classGroupId))
    .innerJoin(spaces, eq(spaces.id, classGroups.spaceId))
    .innerJoin(cities, eq(cities.id, spaces.cityId))
    .where(
      and(
        inArray(
          spaceMembers.userId,
          teachers.map((teacher) => teacher.userId),
        ),
        ne(classGroups.spaceId, space.id),
        eq(classGroups.active, true),
      ),
    );
  const mine = { ...slot, timeZone: space.timeZone };
  const teacher = teachers.find((candidate) =>
    others.some(
      (other) =>
        other.userId === candidate.userId &&
        zonedWeeklySlotsOverlap(
          mine,
          { ...other, timeZone: other.timeZone || DEFAULT_TIME_ZONE },
          now,
        ),
    ),
  );
  if (!teacher) return;
  const { startsAt, endsAt } = nextOccurrence(slot, space.timeZone, now);
  throw teacherScheduleConflict(teacher, startsAt, endsAt, space.timeZone);
}

/** Grava a lista da turma: `current` é a que está no banco. */
export async function setGroupTeachers(
  tx: Tx,
  group: GroupRef,
  current: readonly Teacher[],
  next: readonly Teacher[],
): Promise<void> {
  const nextIds = new Set(next.map((teacher) => teacher.memberId));
  const currentIds = new Set(current.map((teacher) => teacher.memberId));
  const removed = current.filter((teacher) => !nextIds.has(teacher.memberId));
  const added = next.filter((teacher) => !currentIds.has(teacher.memberId));
  if (removed.length) {
    await tx.delete(classGroupTeachers).where(
      and(
        eq(classGroupTeachers.classGroupId, group.id),
        inArray(
          classGroupTeachers.teacherMemberId,
          removed.map((teacher) => teacher.memberId),
        ),
      ),
    );
  }
  if (added.length) {
    await tx.insert(classGroupTeachers).values(
      added.map((teacher) => ({
        classGroupId: group.id,
        spaceId: group.spaceId,
        teacherMemberId: teacher.memberId,
      })),
    );
  }
}

/**
 * Põe os professores na aula e ocupa a agenda deles na mesma transação. A trava e a checagem
 * vêm antes; a constraint de exclusão é a garantia se alguém escapar delas.
 */
export async function addSessionTeachers(
  tx: Tx,
  session: SessionRef,
  teachers: readonly Teacher[],
  timeZone: string,
): Promise<void> {
  if (!teachers.length) return;
  await tx.insert(classSessionTeachers).values(
    teachers.map((teacher) => ({
      classSessionId: session.id,
      spaceId: session.spaceId,
      teacherMemberId: teacher.memberId,
    })),
  );
  for (const teacher of teachers) {
    try {
      await tx.insert(teacherOccupations).values({
        userId: teacher.userId,
        spaceId: session.spaceId,
        classSessionId: session.id,
        period: { start: session.startsAt, end: session.endsAt },
      });
    } catch (err) {
      if (!isTeacherOverlapViolation(err)) throw err;
      throw teacherScheduleConflict(teacher, session.startsAt, session.endsAt, timeZone);
    }
  }
}

/**
 * Troca a lista da aula. Só quem entra passa pela agenda (409 `TEACHER_SCHEDULE_CONFLICT`, com a
 * data e o horário da aula): quem fica já estava nela.
 */
export async function replaceSessionTeachers(
  tx: Tx,
  session: SessionRef,
  next: readonly Teacher[],
  timeZone: string,
): Promise<void> {
  const current = (await sessionTeachers(tx, [session.id])).get(session.id) ?? [];
  const nextIds = new Set(next.map((teacher) => teacher.memberId));
  const currentIds = new Set(current.map((teacher) => teacher.memberId));
  const added = next.filter((teacher) => !currentIds.has(teacher.memberId));
  const removed = current.filter((teacher) => !nextIds.has(teacher.memberId));

  await lockTeacherSchedule(
    tx,
    added.map((teacher) => teacher.userId),
  );
  const busy = await busyElsewhere(tx, session.spaceId, added, session);
  const conflicted = added.find((teacher) => busy.has(teacher.userId));
  if (conflicted) {
    throw teacherScheduleConflict(conflicted, session.startsAt, session.endsAt, timeZone);
  }

  if (removed.length) {
    await tx.delete(classSessionTeachers).where(
      and(
        eq(classSessionTeachers.classSessionId, session.id),
        inArray(
          classSessionTeachers.teacherMemberId,
          removed.map((teacher) => teacher.memberId),
        ),
      ),
    );
    await tx.delete(teacherOccupations).where(
      and(
        eq(teacherOccupations.classSessionId, session.id),
        inArray(
          teacherOccupations.userId,
          removed.map((teacher) => teacher.userId),
        ),
      ),
    );
  }
  await addSessionTeachers(tx, session, added, timeZone);
}

/** A aula ainda não terminou nem foi cancelada. */
const notFinished = (now: Date): SQL | undefined =>
  and(inArray(classSessions.status, [...UPCOMING_STATUSES]), gt(classSessions.endsAt, now));

/** A turma da linha de `class_group_teachers` tem outro professor além do vínculo. */
const groupHasOther = (memberId: string) =>
  sql`EXISTS (SELECT 1 FROM ${classGroupTeachers} AS other WHERE other.class_group_id = ${classGroupTeachers.classGroupId} AND other.teacher_member_id <> ${memberId})`;

/** A aula da linha de `class_session_teachers` tem outro professor além do vínculo. */
const sessionHasOther = (memberId: string) =>
  sql`EXISTS (SELECT 1 FROM ${classSessionTeachers} AS other WHERE other.class_session_id = ${classSessionTeachers.classSessionId} AND other.teacher_member_id <> ${memberId})`;

/** Turmas ativas e aulas por acontecer que ficariam sem professor sem este vínculo. */
export interface SoleTeacherAssignments {
  classGroups: { id: string; name: string }[];
  classSessions: { id: string; classGroup: { id: string; name: string }; startsAt: string }[];
}

async function soleAssignments(
  tx: Tx,
  memberId: string,
  now: Date,
): Promise<SoleTeacherAssignments> {
  const groups = await tx
    .select({ id: classGroups.id, name: classGroups.name })
    .from(classGroupTeachers)
    .innerJoin(classGroups, eq(classGroups.id, classGroupTeachers.classGroupId))
    .where(
      and(
        eq(classGroupTeachers.teacherMemberId, memberId),
        eq(classGroups.active, true),
        not(groupHasOther(memberId)),
      ),
    )
    .orderBy(asc(classGroups.name), asc(classGroups.id));
  const sessions = await tx
    .select({
      id: classSessions.id,
      groupId: classGroups.id,
      groupName: classGroups.name,
      startsAt: classSessions.startsAt,
    })
    .from(classSessionTeachers)
    .innerJoin(classSessions, eq(classSessions.id, classSessionTeachers.classSessionId))
    .innerJoin(classGroups, eq(classGroups.id, classSessions.classGroupId))
    .where(
      and(
        eq(classSessionTeachers.teacherMemberId, memberId),
        notFinished(now),
        not(sessionHasOther(memberId)),
      ),
    )
    .orderBy(asc(classSessions.startsAt), asc(classSessions.id));
  return {
    classGroups: groups,
    classSessions: sessions.map((row) => ({
      id: row.id,
      classGroup: { id: row.groupId, name: row.groupName },
      startsAt: row.startsAt.toISOString(),
    })),
  };
}

/**
 * Tira o vínculo das listas em que há outro professor e libera a agenda dele nessas aulas. As
 * aulas já encerradas ficam como histórico. Quem chama trava a linha do vínculo.
 */
export async function unlinkTeacher(
  tx: Tx,
  member: { id: string; userId: string },
  now: Date = new Date(),
): Promise<void> {
  await tx
    .delete(classGroupTeachers)
    .where(and(eq(classGroupTeachers.teacherMemberId, member.id), groupHasOther(member.id)));
  const removed = await tx
    .delete(classSessionTeachers)
    .where(
      and(
        eq(classSessionTeachers.teacherMemberId, member.id),
        inArray(
          classSessionTeachers.classSessionId,
          tx.select({ id: classSessions.id }).from(classSessions).where(notFinished(now)),
        ),
        sessionHasOther(member.id),
      ),
    )
    .returning({ sessionId: classSessionTeachers.classSessionId });
  if (!removed.length) return;
  await tx.delete(teacherOccupations).where(
    and(
      eq(teacherOccupations.userId, member.userId),
      inArray(
        teacherOccupations.classSessionId,
        removed.map((row) => row.sessionId),
      ),
    ),
  );
}

/**
 * Saída do Professor do espaço (RF-CLASS-01): recusa (409 `TEACHER_HAS_CLASS_GROUPS`) se ele é o
 * único de uma turma ativa ou de uma aula por acontecer; senão, sai das listas. Na turma inativa
 * em que é o único ele fica: reativá-la exige outro professor. Trava a linha do vínculo antes de
 * contar: quem grava uma lista trava a mesma linha (`assertTeachers`), então a turma criada ou
 * editada ao mesmo tempo ou entra na contagem ou encontra o vínculo removido.
 */
export async function releaseTeacher(
  tx: Tx,
  spaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const [member] = await tx
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.role, 'TEACHER'),
        eq(spaceMembers.status, 'ACTIVE'),
      ),
    )
    .for('update');
  if (!member) return;
  const sole = await soleAssignments(tx, member.id, now);
  if (sole.classGroups.length || sole.classSessions.length) throw teacherHasClassGroups(sole);
  await unlinkTeacher(tx, { id: member.id, userId }, now);
}
