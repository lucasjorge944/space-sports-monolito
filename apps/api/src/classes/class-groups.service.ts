import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  availableSpots,
  type ClassGroup,
  type ClassGroupDetail,
  type ClassGroupsQuery,
  type ClassSessionConflict,
  type CreateClassGroupInput,
  checkBookingTime,
  type Teacher,
  type TeachersResponse,
  timeToMinutes,
  type UpdateClassGroupInput,
  utcToZoned,
  type WeeklySlot,
  weekdayDates,
  weeklySlotsOverlap,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, gte, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import {
  bookingTimeInvalid,
  courtNotFound,
  courtUnavailable,
  slotUnavailable,
  sportNotOffered,
} from '../bookings/bookings.errors.js';
import { audit, type DbOrTx, isSlotConflict, type Tx } from '../bookings/db-utils.js';
import { type SpaceContext, SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import {
  classGroups,
  classGroupTeachers,
  classSessionConflicts,
  classSessions,
  courtSports,
  courts,
  enrollments,
  recurringBookings,
  spaceMembers,
  sports,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { type ClassGroupRow, ClassSessionsService } from './class-sessions.service.js';
import {
  assertTeachers,
  assertTeachersWeeklyFree,
  groupTeachers,
  lockTeacherSchedule,
  sameTeachers,
  setGroupTeachers,
} from './class-teachers.js';
import {
  capacityBelowEnrollments,
  classGroupHasActiveEnrollments,
  classGroupHasHistory,
  classGroupNotFound,
  classGroupSportLocked,
  scheduleConflict,
  sportNotFound,
} from './classes.errors.js';
import { type ClassesScope, groupHasTeacher, groupScope } from './classes-scope.js';

/** Campos do horário semanal: mudar algum regenera as sessões futuras sem confirmações. */
const SLOT_FIELDS: readonly string[] = ['courtId', 'weekday', 'startTime', 'durationMin'];

/**
 * Turmas fixas (RF-CLASS-02, RN-CLASS-02). Criar, editar e reativar validam o horário semanal
 * contra outras turmas e mensalistas da quadra e geram as sessões das próximas 4 semanas em modo
 * estrito (reserva, bloqueio ou aula no horário → 409 CLASS_SCHEDULE_CONFLICT). A linha da quadra
 * é travada para serializar as checagens do horário semanal; a sobreposição real das sessões é
 * garantida pela constraint de exclusão de `court_occupations`. Os professores passam pela mesma
 * validação contra as aulas deles em outros espaços (decisão 47, 409 TEACHER_SCHEDULE_CONFLICT).
 */
@Injectable()
export class ClassGroupsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
    private readonly sessions: ClassSessionsService,
  ) {}

  async list(spaceId: string, scope: ClassesScope, query: ClassGroupsQuery): Promise<ClassGroup[]> {
    const filters: (SQL | undefined)[] = [eq(classGroups.spaceId, spaceId), groupScope(scope)];
    if (query.active !== undefined) filters.push(eq(classGroups.active, query.active));
    if (query.sportId) filters.push(eq(classGroups.sportId, query.sportId));
    if (query.courtId) filters.push(eq(classGroups.courtId, query.courtId));
    if (query.teacherMemberId) filters.push(groupHasTeacher(query.teacherMemberId));
    return classGroupRows(this.db, and(...filters));
  }

  async get(spaceId: string, scope: ClassesScope, id: string): Promise<ClassGroupDetail> {
    const [group] = await classGroupRows(
      this.db,
      and(eq(classGroups.spaceId, spaceId), eq(classGroups.id, id), groupScope(scope)),
    );
    if (!group) throw classGroupNotFound();
    return {
      ...group,
      conflicts: await this.conflicts(spaceId, scope, eq(classGroups.id, id)),
    };
  }

  /** Sessões em aberto que não couberam na agenda (sinalizadas pelo job). */
  conflicts(spaceId: string, scope: ClassesScope, where?: SQL): Promise<ClassSessionConflict[]> {
    return conflictRows(this.db, and(eq(classGroups.spaceId, spaceId), groupScope(scope), where));
  }

  async create(
    spaceId: string,
    actorId: string,
    input: CreateClassGroupInput,
  ): Promise<ClassGroupDetail> {
    const space = await this.spaces.load(spaceId);
    const { teacherMemberIds, ...fields } = input;
    const id = await this.db.transaction(async (tx) => {
      await lockCourts(tx, [input.courtId]);
      await assertSport(tx, input.sportId);
      await assertCourt(tx, spaceId, input.courtId, input.sportId);
      const teachers = await assertTeachers(tx, spaceId, teacherMemberIds);
      assertOpeningHours(space, input);
      if (input.active) {
        await assertWeeklySlotFree(tx, space, input.courtId, input);
        await lockTeacherSchedule(tx, userIds(teachers));
        await assertTeachersWeeklyFree(tx, space, input, teachers);
      }

      const [group] = await tx
        .insert(classGroups)
        .values({ spaceId, ...fields })
        .returning();
      if (!group) throw new Error('Insert de turma sem retorno.');
      await setGroupTeachers(tx, group, [], teachers);
      const generated = group.active
        ? await this.sessions.generateFor(tx, group, space, 'STRICT')
        : null;
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_group.create',
        entity: 'class_group',
        entityId: group.id,
        diff: { ...input, ...generated },
      });
      return group.id;
    });
    return this.get(spaceId, { kind: 'ALL' }, id);
  }

  /**
   * Edição parcial. Mudar quadra, dia, horário ou duração (ou reativar) regenera as sessões
   * futuras sem confirmações em modo estrito. Professores e capacidade vão direto para as sessões
   * futuras sem confirmações, sem regenerar: um bloqueio ou torneio no horário não trava a troca,
   * e a capacidade e os professores ajustados à mão numa sessão são mantidos. Quem entra na lista
   * passa pela agenda dele em outros espaços, e a lista nova também gera, sem travar a troca, as
   * sessões que tinham ficado de fora. Deadlock na disputa pelo horário vira 409 SLOT_UNAVAILABLE.
   */
  async update(
    spaceId: string,
    actorId: string,
    id: string,
    patch: UpdateClassGroupInput,
  ): Promise<ClassGroupDetail> {
    const space = await this.spaces.load(spaceId);
    try {
      await this.db.transaction(async (tx) => {
        const current = await this.lockInSpace(tx, spaceId, id);
        const { teacherMemberIds, ...fields } = patch;
        const next: ClassGroupRow = { ...current, ...fields };
        const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
          (key) =>
            fields[key] !== current[key] && !(key === 'startTime' && sameTime(current, next)),
        );
        const before = (await groupTeachers(tx, [id])).get(id) ?? [];
        const teachersChanged =
          teacherMemberIds !== undefined && !sameTeachers(before, teacherMemberIds);
        if (!changed.length && !teachersChanged) return;
        const reactivated = !current.active && next.active;

        const enrolled = await activeEnrollmentCount(tx, id);
        if (changed.includes('sportId') && enrolled > 0) throw classGroupSportLocked(enrolled);

        await lockCourts(tx, [current.courtId, next.courtId]);
        if (patch.sportId !== undefined) await assertSport(tx, next.sportId);
        if (reactivated || changed.includes('courtId') || changed.includes('sportId')) {
          await assertCourt(tx, spaceId, next.courtId, next.sportId);
        }
        const after =
          reactivated || teachersChanged
            ? await assertTeachers(tx, spaceId, teacherMemberIds ?? memberIds(before))
            : before;

        if (changed.includes('capacity') && next.capacity < enrolled) {
          throw capacityBelowEnrollments(enrolled);
        }
        if (current.active && !next.active && enrolled > 0) {
          throw classGroupHasActiveEnrollments(enrolled);
        }

        const slotChanged = changed.some((key) => SLOT_FIELDS.includes(key));
        if (slotChanged) assertOpeningHours(space, next);
        if (next.active && (slotChanged || reactivated)) {
          await assertWeeklySlotFree(tx, space, next.courtId, next, id);
        }
        if (next.active && (slotChanged || reactivated || teachersChanged)) {
          await lockTeacherSchedule(tx, userIds(after));
          const added = after.filter((teacher) => !memberIds(before).includes(teacher.memberId));
          await assertTeachersWeeklyFree(
            tx,
            space,
            next,
            slotChanged || reactivated ? after : added,
          );
        }

        const [updated] = await tx
          .update(classGroups)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(classGroups.id, id))
          .returning();
        if (!updated) throw classGroupNotFound();
        if (teachersChanged) await setGroupTeachers(tx, updated, before, after);

        let sessions: Record<string, number> | null = null;
        if (slotChanged || changed.includes('active')) {
          const removed = await this.sessions.removeUpcomingUnconfirmed(tx, id);
          const generated = updated.active
            ? await this.sessions.generateFor(tx, updated, space, 'STRICT')
            : { created: 0, conflicts: 0, teachersSkipped: 0 };
          sessions = { removed, ...generated };
        } else if (teachersChanged || changed.includes('capacity')) {
          sessions = {
            updated: changed.includes('capacity')
              ? await this.sessions.updateUpcomingUnconfirmed(tx, current, updated)
              : 0,
            teachersUpdated: teachersChanged
              ? await this.sessions.replaceUpcomingTeachers(tx, id, before, after, space.timeZone)
              : 0,
            // A lista nova pode tirar uma aula do aviso de falta de professor. `FLAG`: acrescentar
            // alguém não pode ser recusado pelo professor em conflito que motivou a troca, nem por
            // um bloqueio da quadra.
            ...(teachersChanged && updated.active
              ? await this.sessions.generateFor(tx, updated, space, 'FLAG')
              : {}),
          };
        }
        await audit(tx, {
          actorId,
          spaceId,
          action: 'class_group.update',
          entity: 'class_group',
          entityId: id,
          diff: {
            before: {
              ...Object.fromEntries(changed.map((key) => [key, current[key]])),
              ...(teachersChanged && { teacherMemberIds: memberIds(before) }),
            },
            after: {
              ...Object.fromEntries(changed.map((key) => [key, next[key]])),
              ...(teachersChanged && { teacherMemberIds: memberIds(after) }),
            },
            ...sessions,
          },
        });
      });
    } catch (err) {
      if (isSlotConflict(err)) throw slotUnavailable();
      throw err;
    }
    return this.get(spaceId, { kind: 'ALL' }, id);
  }

  /**
   * Exclui a turma que nunca teve aula nem matrícula. Com matrículas ativas → 409
   * CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS; com histórico (aulas passadas, confirmações ou matrículas
   * encerradas) → 409 CLASS_GROUP_HAS_HISTORY (desative a turma).
   */
  async remove(spaceId: string, actorId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const group = await this.lockInSpace(tx, spaceId, id);
      const enrolled = await activeEnrollmentCount(tx, id);
      if (enrolled > 0) throw classGroupHasActiveEnrollments(enrolled);
      const [anyEnrollment] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(eq(enrollments.classGroupId, id))
        .limit(1);
      if (anyEnrollment) throw classGroupHasHistory();

      const removed = await this.sessions.removeUpcomingUnconfirmed(tx, id);
      const [remaining] = await tx
        .select({ id: classSessions.id })
        .from(classSessions)
        .where(eq(classSessions.classGroupId, id))
        .limit(1);
      if (remaining) throw classGroupHasHistory();

      await tx.delete(classGroups).where(eq(classGroups.id, id));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_group.delete',
        entity: 'class_group',
        entityId: id,
        diff: { name: group.name, removedSessions: removed },
      });
    });
  }

  /** Professores do espaço (vínculo TEACHER ativo, RF-CLASS-01) com quantas turmas ativas dão. */
  async teachers(spaceId: string): Promise<TeachersResponse> {
    const rows = await this.db
      .select({
        memberId: spaceMembers.id,
        userId: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        activeClassGroupCount: sql<number>`(SELECT count(*)::int FROM ${classGroupTeachers} INNER JOIN ${classGroups} ON ${classGroups.id} = ${classGroupTeachers.classGroupId} WHERE ${classGroupTeachers.teacherMemberId} = ${spaceMembers.id} AND ${classGroups.active})`,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.role, 'TEACHER'),
          eq(spaceMembers.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(users.name), asc(users.id));
    return { items: rows };
  }

  private async lockInSpace(tx: Tx, spaceId: string, id: string): Promise<ClassGroupRow> {
    const group = await this.sessions.lockGroup(
      tx,
      and(eq(classGroups.id, id), eq(classGroups.spaceId, spaceId)),
    );
    if (!group) throw classGroupNotFound();
    return group;
  }
}

const memberIds = (teachers: readonly Teacher[]) => teachers.map((teacher) => teacher.memberId);
const userIds = (teachers: readonly Teacher[]) => teachers.map((teacher) => teacher.userId);

/** `19:00` e `19:00:00` são o mesmo horário. */
function sameTime(a: Pick<ClassGroupRow, 'startTime'>, b: Pick<ClassGroupRow, 'startTime'>) {
  return timeToMinutes(a.startTime) === timeToMinutes(b.startTime);
}

/** Trava as quadras (em ordem, sem deadlock) para serializar as checagens do horário semanal. */
async function lockCourts(tx: Tx, courtIds: string[]): Promise<void> {
  for (const courtId of [...new Set(courtIds)].sort()) {
    await tx.select({ id: courts.id }).from(courts).where(eq(courts.id, courtId)).for('update');
  }
}

async function assertSport(tx: Tx, sportId: string): Promise<void> {
  const [sport] = await tx.select({ id: sports.id }).from(sports).where(eq(sports.id, sportId));
  if (!sport) throw sportNotFound();
}

/** Quadra ativa do espaço que oferece o esporte. A capacidade da aula é a da turma, não a da quadra. */
async function assertCourt(tx: Tx, spaceId: string, courtId: string, sportId: string) {
  const [court] = await tx
    .select({ status: courts.status })
    .from(courts)
    .where(and(eq(courts.id, courtId), eq(courts.spaceId, spaceId)));
  if (!court) throw courtNotFound();
  if (court.status !== 'ACTIVE') throw courtUnavailable();
  const [offered] = await tx
    .select({ id: courtSports.id })
    .from(courtSports)
    .where(and(eq(courtSports.courtId, courtId), eq(courtSports.sportId, sportId)));
  if (!offered) throw sportNotOffered();
}

/**
 * Início em hora cheia/meia hora e dentro do funcionamento do dia da semana (RN-BOOK-02). O
 * funcionamento é por dia da semana: vale validar numa data futura qualquer com o mesmo dia.
 */
function assertOpeningHours(space: SpaceContext, slot: WeeklySlot): void {
  const now = new Date();
  const today = utcToZoned(now, space.timeZone).date;
  const [reference] = weekdayDates(slot.weekday, addDays(today, 1), addDays(today, 7));
  if (!reference) throw new Error('Data de referência da turma não encontrada.');
  const violation = checkBookingTime({
    startsAt: zonedToUtc(reference, timeToMinutes(slot.startTime), space.timeZone),
    durationMin: slot.durationMin,
    openingHours: space.openingHours,
    timeZone: space.timeZone,
    rules: space.rules,
    now,
    actor: 'STAFF',
  });
  if (violation) throw bookingTimeInvalid(violation);
}

/**
 * O horário semanal não pode colidir com outra turma ativa nem com um mensalista ativo ou pausado
 * da mesma quadra (o pausado volta a ocupar o horário). Reservas e bloqueios das próximas 4
 * semanas são checados na geração estrita das sessões.
 */
async function assertWeeklySlotFree(
  tx: Tx,
  space: SpaceContext,
  courtId: string,
  slot: WeeklySlot,
  exceptGroupId?: string,
): Promise<void> {
  const groups = await tx
    .select({
      id: classGroups.id,
      weekday: classGroups.weekday,
      startTime: classGroups.startTime,
      durationMin: classGroups.durationMin,
    })
    .from(classGroups)
    .where(
      and(
        eq(classGroups.courtId, courtId),
        eq(classGroups.active, true),
        exceptGroupId ? ne(classGroups.id, exceptGroupId) : undefined,
      ),
    );
  const group = groups.find((other) => weeklySlotsOverlap(slot, other));
  if (group) throw scheduleConflict({ conflictsWith: 'CLASS_GROUP', refId: group.id });

  const today = utcToZoned(new Date(), space.timeZone).date;
  const recurring = await tx
    .select({
      id: recurringBookings.id,
      weekday: recurringBookings.weekday,
      startTime: recurringBookings.startTime,
      durationMin: recurringBookings.durationMin,
    })
    .from(recurringBookings)
    .where(
      and(
        eq(recurringBookings.courtId, courtId),
        inArray(recurringBookings.status, ['ACTIVE', 'PAUSED']),
        or(isNull(recurringBookings.endsOn), gte(recurringBookings.endsOn, today)),
      ),
    );
  const booking = recurring.find((other) => weeklySlotsOverlap(slot, other));
  if (booking) throw scheduleConflict({ conflictsWith: 'RECURRING_BOOKING', refId: booking.id });
}

async function activeEnrollmentCount(tx: Tx, classGroupId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(eq(enrollments.classGroupId, classGroupId), eq(enrollments.status, 'ACTIVE')));
  return row?.count ?? 0;
}

/** Subconsulta: matrículas ativas da turma (RN-CLASS-02). */
export const enrolledCountSql = sql<number>`(SELECT count(*)::int FROM ${enrollments} WHERE ${enrollments.classGroupId} = ${classGroups.id} AND ${enrollments.status} = 'ACTIVE')`;

export async function classGroupRows(db: DbOrTx, where: SQL | undefined): Promise<ClassGroup[]> {
  const rows = await db
    .select({
      group: classGroups,
      sportName: sports.name,
      sportSlug: sports.slug,
      courtName: courts.name,
      enrolledCount: enrolledCountSql,
    })
    .from(classGroups)
    .innerJoin(sports, eq(sports.id, classGroups.sportId))
    .innerJoin(courts, eq(courts.id, classGroups.courtId))
    .where(where)
    .orderBy(
      asc(classGroups.weekday),
      asc(classGroups.startTime),
      asc(classGroups.name),
      asc(classGroups.id),
    );
  const teachers = await groupTeachers(
    db,
    rows.map((row) => row.group.id),
  );
  return rows.map(({ group, ...row }) => ({
    id: group.id,
    name: group.name,
    sport: { id: group.sportId, name: row.sportName, slug: row.sportSlug },
    level: group.level,
    teachers: teachers.get(group.id) ?? [],
    court: { id: group.courtId, name: row.courtName },
    weekday: group.weekday,
    startTime: group.startTime.slice(0, 5),
    durationMin: group.durationMin,
    capacity: group.capacity,
    active: group.active,
    enrolledCount: row.enrolledCount,
    availableSpots: availableSpots(group.capacity, row.enrolledCount),
    createdAt: group.createdAt.toISOString(),
  }));
}

async function conflictRows(db: DbOrTx, where: SQL | undefined): Promise<ClassSessionConflict[]> {
  const rows = await db
    .select({
      id: classSessionConflicts.id,
      groupId: classGroups.id,
      groupName: classGroups.name,
      courtId: courts.id,
      courtName: courts.name,
      startsAt: classSessionConflicts.startsAt,
      endsAt: classSessionConflicts.endsAt,
      conflictsWith: classSessionConflicts.conflictsWith,
      createdAt: classSessionConflicts.createdAt,
    })
    .from(classSessionConflicts)
    .innerJoin(classGroups, eq(classGroups.id, classSessionConflicts.classGroupId))
    .innerJoin(courts, eq(courts.id, classGroups.courtId))
    .where(and(isNull(classSessionConflicts.resolvedAt), where))
    .orderBy(asc(classSessionConflicts.startsAt), asc(classSessionConflicts.id));
  return rows.map((row) => ({
    id: row.id,
    classGroup: { id: row.groupId, name: row.groupName },
    court: { id: row.courtId, name: row.courtName },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    conflictsWith: row.conflictsWith,
    createdAt: row.createdAt.toISOString(),
  }));
}
