import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AttendanceStatus,
  addDays,
  addMinutes,
  CLASS_SESSION_GENERATION_DAYS,
  type ClassConflictKind,
  type ClassSession,
  type ClassSessionStatus,
  type ClassSessionsQuery,
  type ClassSessionsResponse,
  MAX_CLASS_SESSIONS_RANGE_DAYS,
  type Teacher,
  timeToMinutes,
  utcToZoned,
  weekdayDates,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, gt, gte, inArray, isNull, lt, notExists, type SQL, sql } from 'drizzle-orm';
import { audit, type DbOrTx, isOverlapViolation, type Tx } from '../bookings/db-utils.js';
import { type SpaceContext, SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import {
  attendances,
  classGroups,
  classSessionConflicts,
  classSessions,
  courtOccupations,
  courts,
  spaces,
  sports,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { conflictingKind } from '../recurring/occurrences.service.js';
import { OCCUPYING_STATUSES } from './attendance-core.js';
import {
  addSessionTeachers,
  busyElsewhere,
  lockGroupTeachers,
  lockTeacherSchedule,
  replaceSessionTeachers,
  sameTeachers,
  sessionTeachers,
} from './class-teachers.js';
import {
  classSessionNotFound,
  scheduleConflict,
  sessionsRangeTooLong,
  teacherScheduleConflict,
} from './classes.errors.js';
import { type ClassesScope, sessionHasTeacher, sessionScope } from './classes-scope.js';

export type ClassGroupRow = typeof classGroups.$inferSelect;

/**
 * `STRICT` (criar/editar/reativar a turma): qualquer ocupação no horário recusa tudo com 409
 * CLASS_SCHEDULE_CONFLICT, e o professor com aula em outro espaço, com 409
 * TEACHER_SCHEDULE_CONFLICT. `FLAG` (job e troca dos professores da turma): a sessão que não cabe
 * é sinalizada e a geração segue; o professor com aula em outro espaço fica fora da sessão se
 * restar outro.
 */
export type SessionGenerationMode = 'STRICT' | 'FLAG';

export interface SessionGenerationResult {
  created: number;
  conflicts: number;
  /** Professores deixados de fora de aulas geradas, por terem aula em outro espaço. */
  teachersSkipped: number;
}

export interface SessionGenerationSummary extends SessionGenerationResult {
  classGroups: number;
  failures: number;
}

/** Sessões que ainda vão acontecer (o job da presença, tarefa 2.3, leva a DONE). */
const UPCOMING_STATUSES: ClassSessionStatus[] = ['SCHEDULED', 'OPEN', 'CLOSED'];
/** Presenças que contam como "confirmação" (a sessão não é regenerada). */
const HELD_ATTENDANCE = ['CONFIRMED', 'WAITLIST', 'PRESENT', 'ABSENT'] as const;

/**
 * Sessões das turmas fixas (RF-CLASS-02): geradas com 4 semanas de antecedência, cada uma ocupa a
 * quadra em `court_occupations` (kind = CLASS) e copia os professores da turma, ocupando a agenda
 * deles em `teacher_occupations`. Idempotente: uma sessão por turma e data local (o
 * `UNIQUE(class_group_id, starts_at)` e a trava da linha da turma impedem duplicar). Sessão
 * cancelada não é recriada.
 */
@Injectable()
export class ClassSessionsService {
  private readonly logger = new Logger(ClassSessionsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  /**
   * Gera as sessões que faltam de hoje até daqui a 4 semanas. Tem de rodar numa transação com a
   * linha da turma travada (`lockGroup`).
   */
  async generateFor(
    tx: Tx,
    group: ClassGroupRow,
    space: SpaceContext,
    mode: SessionGenerationMode,
    now: Date = new Date(),
  ): Promise<SessionGenerationResult> {
    const result: SessionGenerationResult = { created: 0, conflicts: 0, teachersSkipped: 0 };
    const today = utcToZoned(now, space.timeZone).date;
    const dates = weekdayDates(group.weekday, today, addDays(today, CLASS_SESSION_GENERATION_DAYS));
    const startMinute = timeToMinutes(group.startTime);
    const slots = dates
      .map((date) => ({ date, startsAt: zonedToUtc(date, startMinute, space.timeZone) }))
      // Sessão de hoje que já começou não é gerada.
      .filter(({ startsAt }) => startsAt > now);
    if (!slots.length) return result;

    const teachers = await lockGroupTeachers(tx, group.id);
    await lockTeacherSchedule(
      tx,
      teachers.map((teacher) => teacher.userId),
    );

    // Uma sessão por data: a que ficou (com confirmações ou cancelada) segura o dia.
    const taken = new Set(
      (
        await tx
          .select({ startsAt: classSessions.startsAt })
          .from(classSessions)
          .where(
            and(
              eq(classSessions.classGroupId, group.id),
              gte(classSessions.startsAt, zonedToUtc(today, 0, space.timeZone)),
            ),
          )
      ).map((row) => utcToZoned(row.startsAt, space.timeZone).date),
    );

    for (const { date, startsAt } of slots) {
      if (taken.has(date)) continue;
      const endsAt = addMinutes(startsAt, group.durationMin);
      const busy = await busyElsewhere(tx, space.id, teachers, { startsAt, endsAt });
      const skipped = teachers.filter((teacher) => busy.has(teacher.userId));
      const assigned = teachers.filter((teacher) => !busy.has(teacher.userId));
      if (mode === 'STRICT' && skipped[0]) {
        throw teacherScheduleConflict(skipped[0], startsAt, endsAt, space.timeZone);
      }
      if (!assigned.length) {
        // A aula precisa de ao menos um professor: fica para a gestão, e o job tenta de novo.
        await this.flagConflict(tx, group, startsAt, endsAt, 'TEACHER');
        result.conflicts++;
        this.logger.warn(
          {
            classGroupId: group.id,
            spaceId: group.spaceId,
            startsAt: startsAt.toISOString(),
            teacherUserIds: skipped.map((teacher) => teacher.userId),
          },
          'Aula não gerada: todos os professores têm aula em outro espaço no horário',
        );
        continue;
      }
      let sessionId: string;
      try {
        // Savepoint: a falha da constraint de exclusão não derruba a transação inteira.
        sessionId = await tx.transaction(async (sp) => {
          const [session] = await sp
            .insert(classSessions)
            .values({
              classGroupId: group.id,
              spaceId: group.spaceId,
              courtId: group.courtId,
              startsAt,
              endsAt,
              capacity: group.capacity,
            })
            .returning({
              id: classSessions.id,
              spaceId: classSessions.spaceId,
              startsAt: classSessions.startsAt,
              endsAt: classSessions.endsAt,
            });
          if (!session) throw new Error('Insert de sessão sem retorno.');
          await sp.insert(courtOccupations).values({
            courtId: group.courtId,
            period: { start: startsAt, end: endsAt },
            kind: 'CLASS',
            refId: session.id,
          });
          await addSessionTeachers(sp, session, assigned, space.timeZone);
          return session.id;
        });
      } catch (err) {
        if (!isOverlapViolation(err)) throw err;
        const kind = await conflictingKind(tx, group.courtId, startsAt, endsAt);
        if (mode === 'STRICT') {
          throw scheduleConflict({ conflictsWith: kind, startsAt: startsAt.toISOString() });
        }
        await this.flagConflict(tx, group, startsAt, endsAt, kind);
        result.conflicts++;
        continue;
      }
      result.created++;
      if (skipped.length) {
        result.teachersSkipped += skipped.length;
        this.logger.warn(
          {
            classGroupId: group.id,
            spaceId: group.spaceId,
            classSessionId: sessionId,
            startsAt: startsAt.toISOString(),
            teacherUserIds: skipped.map((teacher) => teacher.userId),
          },
          'Aula gerada sem o professor que tem aula em outro espaço no horário',
        );
        await audit(tx, {
          actorId: null,
          spaceId: group.spaceId,
          action: 'class_session.teacher_skipped',
          entity: 'class_session',
          entityId: sessionId,
          diff: { teacherMemberIds: skipped.map((teacher) => teacher.memberId), automatic: true },
        });
      }
      // O horário voltou a caber: o aviso à gestão deixa de valer.
      await tx
        .update(classSessionConflicts)
        .set({ resolvedAt: now })
        .where(
          and(
            eq(classSessionConflicts.classGroupId, group.id),
            eq(classSessionConflicts.startsAt, startsAt),
            isNull(classSessionConflicts.resolvedAt),
          ),
        );
    }
    return result;
  }

  private async flagConflict(
    tx: Tx,
    group: ClassGroupRow,
    startsAt: Date,
    endsAt: Date,
    kind: ClassConflictKind,
  ): Promise<void> {
    await tx
      .insert(classSessionConflicts)
      .values({ classGroupId: group.id, startsAt, endsAt, conflictsWith: kind })
      .onConflictDoUpdate({
        target: [classSessionConflicts.classGroupId, classSessionConflicts.startsAt],
        set: { endsAt, conflictsWith: kind, resolvedAt: null },
      });
  }

  /**
   * Edição, desativação ou exclusão da turma: apaga as sessões futuras sem confirmações (e as
   * ocupações delas; listas e agenda dos professores saem em cascata) e encerra os avisos de
   * conflito. As sessões com confirmação ficam como
   * estão. Devolve quantas foram apagadas.
   */
  async removeUpcomingUnconfirmed(tx: Tx, groupId: string, now: Date = new Date()) {
    const removable = await tx
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(upcomingUnconfirmed(tx, groupId, now));
    const ids = removable.map((row) => row.id);
    if (ids.length) {
      await tx
        .delete(courtOccupations)
        .where(and(eq(courtOccupations.kind, 'CLASS'), inArray(courtOccupations.refId, ids)));
      await tx.delete(classSessions).where(inArray(classSessions.id, ids));
    }
    await tx
      .update(classSessionConflicts)
      .set({ resolvedAt: now })
      .where(
        and(
          eq(classSessionConflicts.classGroupId, groupId),
          isNull(classSessionConflicts.resolvedAt),
        ),
      );
    return ids.length;
  }

  /**
   * Troca de capacidade da turma: aplica nas sessões futuras sem confirmações, sem regenerar (a
   * ocupação da quadra não muda). Só muda nas sessões que ainda estão com a capacidade antiga da
   * turma; as ajustadas pela gestão ficam como estão. Devolve quantas sessões foram atualizadas.
   */
  async updateUpcomingUnconfirmed(
    tx: Tx,
    before: Pick<ClassGroupRow, 'id' | 'capacity'>,
    after: Pick<ClassGroupRow, 'capacity'>,
    now: Date = new Date(),
  ): Promise<number> {
    const updated = await tx
      .update(classSessions)
      .set({
        capacity: sql`CASE WHEN ${classSessions.capacity} = ${before.capacity} THEN ${after.capacity}::int ELSE ${classSessions.capacity} END`,
      })
      .where(upcomingUnconfirmed(tx, before.id, now))
      .returning({ id: classSessions.id });
    return updated.length;
  }

  /**
   * Troca dos professores da turma: aplica nas sessões futuras sem confirmações que ainda estão
   * com a lista antiga, sem regenerar; a aula com professores próprios fica como está. Conflito
   * de agenda recusa tudo. Devolve quantas sessões foram atualizadas.
   */
  async replaceUpcomingTeachers(
    tx: Tx,
    groupId: string,
    before: readonly Teacher[],
    after: readonly Teacher[],
    timeZone: string,
    now: Date = new Date(),
  ): Promise<number> {
    const sessions = await tx
      .select()
      .from(classSessions)
      .where(upcomingUnconfirmed(tx, groupId, now))
      .orderBy(asc(classSessions.id))
      .for('update');
    const lists = await sessionTeachers(
      tx,
      sessions.map((session) => session.id),
    );
    const beforeIds = before.map((teacher) => teacher.memberId);
    const followers = sessions.filter((session) =>
      sameTeachers(lists.get(session.id) ?? [], beforeIds),
    );
    for (const session of followers) await replaceSessionTeachers(tx, session, after, timeZone);
    return followers.length;
  }

  /** Trava a linha da turma para serializar geração e edição. */
  async lockGroup(tx: Tx, where: SQL | undefined): Promise<ClassGroupRow | undefined> {
    const [row] = await tx.select().from(classGroups).where(where).for('update');
    return row;
  }

  /**
   * Job diário: gera as sessões de todas as turmas ativas de espaços ativos. Cada turma tem a
   * própria transação; um erro isolado é registrado e não interrompe o resto.
   */
  async generateAll(now: Date = new Date()): Promise<SessionGenerationSummary> {
    const rows = await this.db
      .select({ id: classGroups.id, spaceId: classGroups.spaceId })
      .from(classGroups)
      .innerJoin(spaces, eq(spaces.id, classGroups.spaceId))
      .where(and(eq(classGroups.active, true), eq(spaces.status, 'ACTIVE')))
      .orderBy(asc(classGroups.createdAt), asc(classGroups.id));

    const summary: SessionGenerationSummary = {
      classGroups: rows.length,
      created: 0,
      conflicts: 0,
      teachersSkipped: 0,
      failures: 0,
    };
    const contexts = new Map<string, SpaceContext>();
    for (const { id, spaceId } of rows) {
      try {
        let space = contexts.get(spaceId);
        if (!space) {
          space = await this.spaces.load(spaceId);
          contexts.set(spaceId, space);
        }
        const context = space;
        const result = await this.db.transaction(async (tx) => {
          const group = await this.lockGroup(tx, eq(classGroups.id, id));
          // Desativada depois da consulta: nada a gerar.
          if (!group?.active) return null;
          return this.generateFor(tx, group, context, 'FLAG', now);
        });
        if (result) {
          summary.created += result.created;
          summary.conflicts += result.conflicts;
          summary.teachersSkipped += result.teachersSkipped;
          if (result.conflicts) {
            this.logger.warn(
              { classGroupId: id, spaceId, conflicts: result.conflicts },
              'Sessões de turma em conflito com a agenda (sinalizadas para a gestão)',
            );
          }
        }
      } catch (err) {
        summary.failures++;
        this.logger.error({ err, classGroupId: id, spaceId }, 'Falha ao gerar sessões da turma');
      }
    }
    return summary;
  }

  // -------------------------------------------------------------------------------------------
  // Leitura e ajuste pela gestão

  async list(
    spaceId: string,
    scope: ClassesScope,
    query: ClassSessionsQuery,
  ): Promise<ClassSessionsResponse> {
    const space = await this.spaces.load(spaceId);
    const from = query.from ?? utcToZoned(new Date(), space.timeZone).date;
    const to = query.to ?? addDays(from, CLASS_SESSION_GENERATION_DAYS - 1);
    if (to > addDays(from, MAX_CLASS_SESSIONS_RANGE_DAYS)) {
      throw sessionsRangeTooLong(MAX_CLASS_SESSIONS_RANGE_DAYS);
    }
    const filters: (SQL | undefined)[] = [
      eq(classSessions.spaceId, spaceId),
      gte(classSessions.startsAt, zonedToUtc(from, 0, space.timeZone)),
      lt(classSessions.startsAt, zonedToUtc(addDays(to, 1), 0, space.timeZone)),
    ];
    if (query.classGroupId) filters.push(eq(classSessions.classGroupId, query.classGroupId));
    if (query.teacherMemberId) filters.push(sessionHasTeacher(query.teacherMemberId));
    if (query.status?.length) filters.push(inArray(classSessions.status, query.status));
    const items = await sessionRows(this.db, and(...filters, sessionScope(scope)));
    return { from, to, timeZone: space.timeZone, items };
  }

  async get(spaceId: string, scope: ClassesScope, sessionId: string): Promise<ClassSession> {
    const [session] = await sessionRows(
      this.db,
      and(eq(classSessions.spaceId, spaceId), eq(classSessions.id, sessionId), sessionScope(scope)),
    );
    if (!session) throw classSessionNotFound();
    return session;
  }
}

/** Sessões da turma que ainda vão acontecer e não têm confirmações (podem mudar com a turma). */
function upcomingUnconfirmed(tx: Tx, groupId: string, now: Date): SQL | undefined {
  return and(
    eq(classSessions.classGroupId, groupId),
    gt(classSessions.startsAt, now),
    inArray(classSessions.status, UPCOMING_STATUSES),
    notExists(
      tx
        .select({ id: attendances.id })
        .from(attendances)
        .where(
          and(
            eq(attendances.sessionId, classSessions.id),
            inArray(attendances.status, [...HELD_ATTENDANCE]),
          ),
        ),
    ),
  );
}

export async function sessionRows(db: DbOrTx, where: SQL | undefined): Promise<ClassSession[]> {
  // Vagas ocupadas: confirmados e quem já teve a presença marcada (`OCCUPYING_STATUSES`).
  const count = (statuses: readonly AttendanceStatus[]) =>
    sql<number>`(SELECT count(*)::int FROM ${attendances} WHERE ${attendances.sessionId} = ${classSessions.id} AND ${inArray(attendances.status, [...statuses])})`;
  const rows = await db
    .select({
      id: classSessions.id,
      groupId: classGroups.id,
      groupName: classGroups.name,
      level: classGroups.level,
      sportId: sports.id,
      sportName: sports.name,
      sportSlug: sports.slug,
      courtId: courts.id,
      courtName: courts.name,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      capacity: classSessions.capacity,
      status: classSessions.status,
      cancelReason: classSessions.cancelReason,
      confirmedCount: count(OCCUPYING_STATUSES),
      waitlistCount: count(['WAITLIST']),
    })
    .from(classSessions)
    .innerJoin(classGroups, eq(classGroups.id, classSessions.classGroupId))
    .innerJoin(sports, eq(sports.id, classGroups.sportId))
    .innerJoin(courts, eq(courts.id, classSessions.courtId))
    .where(where)
    .orderBy(asc(classSessions.startsAt), asc(classSessions.id));
  const teachers = await sessionTeachers(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    classGroup: { id: row.groupId, name: row.groupName },
    sport: { id: row.sportId, name: row.sportName, slug: row.sportSlug },
    level: row.level,
    court: { id: row.courtId, name: row.courtName },
    teachers: teachers.get(row.id) ?? [],
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    capacity: row.capacity,
    status: row.status,
    confirmedCount: row.confirmedCount,
    waitlistCount: row.waitlistCount,
    cancelReason: row.cancelReason,
  }));
}
