import { Inject, Injectable } from '@nestjs/common';
import {
  type AttendanceBlockReason,
  type Attendee,
  addDays,
  addMinutes,
  type ClassSessionDetail,
  DEFAULT_TIME_ZONE,
  MAX_MY_CLASS_SESSIONS_RANGE_DAYS,
  type MarkPresenceInput,
  MY_CLASS_SESSIONS_DEFAULT_DAYS,
  type MyClassSession,
  type MyClassSessionDetail,
  type MyClassSessionsQuery,
  type MyClassSessionsResponse,
  utcToZoned,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, gte, inArray, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { assertSpaceWritable, audit, type DbOrTx, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { attendances, cities, classSessions, spaces, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import {
  alreadyInSession,
  attendanceListNotOpen,
  cancelDeadlinePassed,
  notEnrolledInClass,
  notInSession,
  presenceAlreadyMarked,
  presenceTooEarly,
  sessionStatusConflict,
  studentNotInSession,
  subscriptionAccessEnded,
  subscriptionPastDue,
  userNotFound,
} from './attendance.errors.js';
import {
  attendanceOf,
  lockSession,
  MARKED_STATUSES,
  placeAttendee,
  releaseAttendee,
  renumberWaitlist,
  type SessionRow,
  UPCOMING_STATUSES,
} from './attendance-core.js';
import {
  attendanceSettings,
  attendanceSettingsOf,
  type EnrollmentState,
  enrollmentBlock,
  enrollmentStates,
} from './attendance-rules.js';
import { ClassSessionLifecycleService } from './class-session-lifecycle.service.js';
import { sessionRows } from './class-sessions.service.js';
import { teacherRef } from './class-teachers.js';
import { classSessionNotFound, sessionsRangeTooLong } from './classes.errors.js';
import { type ClassesScope, sessionScope } from './classes-scope.js';
import {
  assertNoSessionOverlap,
  heldSessions,
  lockStudentSchedule,
  sessionOverlap,
} from './schedule-overlap.js';

const BLOCK_ERRORS = {
  NOT_ENROLLED: notEnrolledInClass,
  SUBSCRIPTION_ACCESS_ENDED: subscriptionAccessEnded,
  SUBSCRIPTION_PAST_DUE: subscriptionPastDue,
} as const;

/**
 * Lista de presença (RF-CLASS-07..10; RN-CLASS-03/05/06): o aluno confirma e desiste nas
 * sessões das turmas dele; a gestão adiciona, remove e marca a presença real. Toda mudança na
 * lista trava a linha da sessão (`lockSession`), e a vaga liberada promove a espera.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly lifecycle: ClassSessionLifecycleService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Aluno (app)

  /**
   * Aulas das turmas do aluno (matrícula ativa) e as que a gestão o incluiu, por data local
   * (America/Sao_Paulo), canceladas inclusive.
   */
  async listMine(userId: string, query: MyClassSessionsQuery): Promise<MyClassSessionsResponse> {
    const now = new Date();
    const from = query.from ?? utcToZoned(now, DEFAULT_TIME_ZONE).date;
    const to = query.to ?? addDays(from, MY_CLASS_SESSIONS_DEFAULT_DAYS - 1);
    if (to > addDays(from, MAX_MY_CLASS_SESSIONS_RANGE_DAYS - 1)) {
      throw sessionsRangeTooLong(MAX_MY_CLASS_SESSIONS_RANGE_DAYS);
    }
    const states = await enrollmentStates(this.db, { userId });
    const groupIds = [...new Set(states.map((s) => s.classGroupId))];
    const rows = await this.db
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(
        and(
          gte(classSessions.startsAt, zonedToUtc(from, 0, DEFAULT_TIME_ZONE)),
          lt(classSessions.startsAt, zonedToUtc(addDays(to, 1), 0, DEFAULT_TIME_ZONE)),
          or(
            groupIds.length ? inArray(classSessions.classGroupId, groupIds) : undefined,
            inArray(
              classSessions.id,
              this.db
                .select({ id: attendances.sessionId })
                .from(attendances)
                .where(and(eq(attendances.userId, userId), ne(attendances.status, 'CANCELLED'))),
            ),
          ),
        ),
      );
    const items = await this.mine(
      userId,
      rows.map((r) => r.id),
      states,
      now,
    );
    return { from, to, items };
  }

  async getMine(userId: string, sessionId: string): Promise<MyClassSessionDetail> {
    const states = await enrollmentStates(this.db, { userId });
    const [item] = await this.mine(userId, [sessionId], states, new Date());
    if (!item) throw classSessionNotFound();
    const confirmed = await this.db
      .select({ userId: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(attendances)
      .innerJoin(users, eq(users.id, attendances.userId))
      .where(
        and(
          eq(attendances.sessionId, sessionId),
          inArray(attendances.status, ['CONFIRMED', 'PRESENT', 'ABSENT']),
        ),
      )
      .orderBy(asc(users.name), asc(users.id));
    return { ...item, confirmed };
  }

  /**
   * Confirma presença (RF-CLASS-08): lista aberta, aula futura, matrícula ativa na turma sem
   * atraso (RN-CLASS-06), dentro do acesso do plano cancelado (RN-CLASS-08) e sem outra aula no
   * mesmo horário em que já está confirmado ou na espera (decisão 37). Sem vaga, entra na espera
   * (RN-CLASS-03).
   */
  async confirm(userId: string, sessionId: string): Promise<MyClassSessionDetail> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Antes da trava da sessão: duas confirmações do aluno em aulas no mesmo horário (de
      // espaços diferentes, inclusive) não passam as duas.
      await lockStudentSchedule(tx, userId);
      const session = await this.lockForStudent(tx, userId, sessionId);
      await assertSpaceWritable(tx, session.spaceId);
      const settings = await attendanceSettingsOf(tx, session.spaceId);
      const states = await enrollmentStates(tx, {
        userId,
        classGroupIds: [session.classGroupId],
      });
      const block = enrollmentBlock(states, session.startsAt, now, settings);
      if (block) throw BLOCK_ERRORS[block]();
      if (session.status !== 'OPEN' || session.startsAt <= now) {
        throw attendanceListNotOpen(session.status);
      }
      const current = await attendanceOf(tx, sessionId, userId);
      if (current && current.status !== 'CANCELLED') throw alreadyInSession(current.status);
      await assertNoSessionOverlap(tx, userId, session);
      await placeAttendee(tx, session, userId, false);
    });
    return this.getMine(userId, sessionId);
  }

  /**
   * Desiste (RN-CLASS-05): confirmado, só com a lista aberta e até
   * `attendance_cancel_deadline_min` antes; na espera, a qualquer momento antes do início. A
   * vaga liberada promove o primeiro da espera.
   */
  async withdraw(userId: string, sessionId: string): Promise<MyClassSessionDetail> {
    const now = new Date();
    const promoted = await this.db.transaction(async (tx) => {
      const session = await this.lockForStudent(tx, userId, sessionId);
      await assertSpaceWritable(tx, session.spaceId);
      const current = await attendanceOf(tx, sessionId, userId);
      if (!current || current.status === 'CANCELLED') throw notInSession();
      if (current.status === 'CONFIRMED') {
        if (session.status !== 'OPEN' || session.startsAt <= now) {
          throw attendanceListNotOpen(session.status);
        }
        const { cancelDeadlineMin } = await attendanceSettingsOf(tx, session.spaceId);
        const deadline = addMinutes(session.startsAt, -cancelDeadlineMin);
        if (now > deadline) throw cancelDeadlinePassed(deadline);
      } else if (
        current.status !== 'WAITLIST' ||
        !['OPEN', 'CLOSED'].includes(session.status) ||
        session.startsAt <= now
      ) {
        throw attendanceListNotOpen(session.status);
      }
      return releaseAttendee(tx, session, current);
    });
    await this.lifecycle.publishPromoted(sessionId, promoted);
    return this.getMine(userId, sessionId);
  }

  /** Sessão travada que o aluno pode ver (matriculado na turma ou já na lista); senão 404. */
  private async lockForStudent(tx: Tx, userId: string, sessionId: string): Promise<SessionRow> {
    const session = await lockSession(tx, eq(classSessions.id, sessionId));
    if (!session) throw classSessionNotFound();
    const [enrolled] = await enrollmentStates(tx, {
      userId,
      classGroupIds: [session.classGroupId],
    });
    if (!enrolled && !(await attendanceOf(tx, sessionId, userId))) throw classSessionNotFound();
    return session;
  }

  /** Monta a visão do aluno das sessões que ele pode ver (as demais ficam de fora). */
  private async mine(
    userId: string,
    sessionIds: string[],
    states: EnrollmentState[],
    now: Date,
  ): Promise<MyClassSession[]> {
    if (!sessionIds.length) return [];
    const meta = await this.db
      .select({
        id: classSessions.id,
        classGroupId: classSessions.classGroupId,
        spaceId: spaces.id,
        spaceName: spaces.name,
        spaceSlug: spaces.slug,
        timeZone: cities.timezone,
      })
      .from(classSessions)
      .innerJoin(spaces, eq(spaces.id, classSessions.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(inArray(classSessions.id, sessionIds));
    const mineRows = await this.db
      .select()
      .from(attendances)
      .where(and(eq(attendances.userId, userId), inArray(attendances.sessionId, sessionIds)));
    const attendanceBySession = new Map(mineRows.map((row) => [row.sessionId, row]));
    const metaById = new Map(meta.map((row) => [row.id, row]));
    const settings = await attendanceSettings(this.db, [...new Set(meta.map((m) => m.spaceId))]);
    const sessions = await sessionRows(this.db, inArray(classSessions.id, sessionIds));
    // Decisão 37: a agenda do aluno no período das aulas listadas, para o `SCHEDULE_OVERLAP`.
    const held = sessions.length
      ? await heldSessions(
          this.db,
          userId,
          new Date(Math.min(...sessions.map((session) => Date.parse(session.startsAt)))),
          new Date(Math.max(...sessions.map((session) => Date.parse(session.endsAt)))),
        )
      : [];

    return sessions.flatMap((session): MyClassSession[] => {
      const info = metaById.get(session.id);
      const config = info && settings.get(info.spaceId);
      if (!info || !config) return [];
      const groupStates = states.filter((s) => s.classGroupId === info.classGroupId);
      const row = attendanceBySession.get(session.id);
      if (!groupStates.length && !row) return [];
      const startsAt = new Date(session.startsAt);
      const mine = row && row.status !== 'CANCELLED' ? row : null;
      const listOpen = session.status === 'OPEN' && startsAt > now;
      const overlap = sessionOverlap(held, {
        id: session.id,
        startsAt,
        endsAt: new Date(session.endsAt),
      });
      const block: AttendanceBlockReason | null =
        enrollmentBlock(groupStates, startsAt, now, config) ??
        (overlap ? 'SCHEDULE_OVERLAP' : null) ??
        (listOpen ? null : 'LIST_NOT_OPEN');
      const deadline = addMinutes(startsAt, -config.cancelDeadlineMin);
      return [
        {
          ...session,
          teachers: session.teachers.map(teacherRef),
          space: {
            id: info.spaceId,
            name: info.spaceName,
            slug: info.spaceSlug,
            timeZone: info.timeZone || DEFAULT_TIME_ZONE,
          },
          myAttendance: mine
            ? { status: mine.status, waitlistPosition: mine.waitlistPosition }
            : null,
          canConfirm: !mine && block === null,
          canWithdraw: canWithdraw(mine?.status, session.status, startsAt, deadline, now),
          blockedReason: mine ? null : block,
          cancellableUntil: deadline.toISOString(),
        },
      ];
    });
  }

  // -------------------------------------------------------------------------------------------
  // Gestão (painel web)

  /** Detalhe com a lista e os matriculados da turma (RF-CLASS-09). */
  async detail(
    spaceId: string,
    scope: ClassesScope,
    sessionId: string,
  ): Promise<ClassSessionDetail> {
    const where = and(
      eq(classSessions.spaceId, spaceId),
      eq(classSessions.id, sessionId),
      sessionScope(scope),
    );
    const [session] = await sessionRows(this.db, where);
    const [extra] = await this.db
      .select({
        classGroupId: classSessions.classGroupId,
        openedAt: classSessions.openedAt,
        closedAt: classSessions.closedAt,
        cancelledAt: classSessions.cancelledAt,
      })
      .from(classSessions)
      .where(where);
    if (!session || !extra) throw classSessionNotFound();
    const states = await enrollmentStates(this.db, { classGroupIds: [extra.classGroupId] });
    const enrolled = new Map(states.map((s) => [s.userId, s.subscriptionStatus]));
    const people = enrolled.size
      ? await this.db
          .select({ userId: users.id, name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, [...enrolled.keys()]))
          .orderBy(asc(users.name), asc(users.id))
      : [];
    return {
      ...session,
      openedAt: extra.openedAt?.toISOString() ?? null,
      closedAt: extra.closedAt?.toISOString() ?? null,
      cancelledAt: extra.cancelledAt?.toISOString() ?? null,
      attendances: await attendeesOf(this.db, [sessionId]).then((rows) =>
        rows.map(({ sessionId: _, ...attendee }) => attendee),
      ),
      enrolledStudents: people.map((person) => ({
        ...person,
        subscriptionStatus: enrolled.get(person.userId) ?? 'ACTIVE',
      })),
    };
  }

  /**
   * Inclusão manual (RF-CLASS-09, `added_by_staff`): vale para qualquer aluno, sem as travas de
   * matrícula/assinatura, mas não em aula que se sobrepõe a outra em que ele já está confirmado
   * ou na espera, em qualquer espaço (decisão 37); sem vaga (confirmados + presenças marcadas) vai
   * para a espera (RN-CLASS-03).
   */
  async add(
    spaceId: string,
    actorId: string,
    scope: ClassesScope,
    sessionId: string,
    userId: string,
  ): Promise<ClassSessionDetail> {
    await this.db.transaction(async (tx) => {
      await lockStudentSchedule(tx, userId);
      const session = await lockScoped(tx, spaceId, scope, sessionId);
      if (!UPCOMING_STATUSES.includes(session.status)) {
        throw sessionStatusConflict(session.status, 'add_attendee');
      }
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!user) throw userNotFound();
      const current = await attendanceOf(tx, sessionId, userId);
      if (current && current.status !== 'CANCELLED') throw alreadyInSession(current.status);
      await assertNoSessionOverlap(tx, userId, session);
      const placed = await placeAttendee(tx, session, userId, true);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_attendance.add',
        entity: 'class_session',
        entityId: sessionId,
        diff: { userId, status: placed.status, waitlistPosition: placed.waitlistPosition },
      });
    });
    return this.detail(spaceId, scope, sessionId);
  }

  /**
   * Remoção manual: a vaga liberada promove a espera (só antes do início). Quem já teve a
   * presença marcada não sai (409 `PRESENCE_ALREADY_MARKED`).
   */
  async remove(
    spaceId: string,
    actorId: string,
    scope: ClassesScope,
    sessionId: string,
    userId: string,
  ): Promise<ClassSessionDetail> {
    const promoted = await this.db.transaction(async (tx) => {
      const session = await lockScoped(tx, spaceId, scope, sessionId);
      if (!UPCOMING_STATUSES.includes(session.status)) {
        throw sessionStatusConflict(session.status, 'remove_attendee');
      }
      const current = await attendanceOf(tx, sessionId, userId);
      if (!current || current.status === 'CANCELLED') throw notInSession();
      if (MARKED_STATUSES.includes(current.status)) throw presenceAlreadyMarked(current.status);
      const promotedIds = await releaseAttendee(tx, session, current);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_attendance.remove',
        entity: 'class_session',
        entityId: sessionId,
        diff: { userId, before: current.status, promoted: promotedIds },
      });
      return promotedIds;
    });
    await this.lifecycle.publishPromoted(sessionId, promoted);
    return this.detail(spaceId, scope, sessionId);
  }

  /**
   * Presença real (RF-CLASS-09) a partir do início da aula, também depois de `DONE`. Vale para
   * quem está na lista (confirmado, espera ou já marcado) e para os matriculados na turma.
   */
  async markPresence(
    spaceId: string,
    actorId: string,
    scope: ClassesScope,
    sessionId: string,
    input: MarkPresenceInput,
  ): Promise<ClassSessionDetail> {
    await this.db.transaction(async (tx) => {
      const session = await lockScoped(tx, spaceId, scope, sessionId);
      if (session.status === 'CANCELLED') throw sessionStatusConflict(session.status, 'presence');
      if (session.startsAt > new Date()) throw presenceTooEarly(session.startsAt);
      const userIds = input.items.map((item) => item.userId);
      const listed = await tx
        .select()
        .from(attendances)
        .where(and(eq(attendances.sessionId, sessionId), inArray(attendances.userId, userIds)));
      const current = new Map(listed.map((row) => [row.userId, row]));
      const enrolled = new Set(
        (await enrollmentStates(tx, { classGroupIds: [session.classGroupId] })).map(
          (s) => s.userId,
        ),
      );
      const missing = userIds.filter((id) => {
        const row = current.get(id);
        return !(row && row.status !== 'CANCELLED') && !enrolled.has(id);
      });
      if (missing.length) throw studentNotInSession(missing);
      for (const { userId, status } of input.items) {
        await tx
          .insert(attendances)
          .values({ sessionId, userId, status, waitlistPosition: null, addedByStaff: true })
          .onConflictDoUpdate({
            target: [attendances.sessionId, attendances.userId],
            set: { status, waitlistPosition: null },
          });
      }
      if (listed.some((row) => row.status === 'WAITLIST')) await renumberWaitlist(tx, sessionId);
      await audit(tx, {
        actorId,
        spaceId,
        action: 'class_attendance.presence',
        entity: 'class_session',
        entityId: sessionId,
        diff: {
          items: input.items.map((item) => ({
            ...item,
            before: current.get(item.userId)?.status ?? null,
          })),
        },
      });
    });
    return this.detail(spaceId, scope, sessionId);
  }
}

function canWithdraw(
  status: string | undefined,
  sessionStatus: string,
  startsAt: Date,
  deadline: Date,
  now: Date,
): boolean {
  if (startsAt <= now) return false;
  if (status === 'CONFIRMED') return sessionStatus === 'OPEN' && now <= deadline;
  if (status === 'WAITLIST') return sessionStatus === 'OPEN' || sessionStatus === 'CLOSED';
  return false;
}

async function lockScoped(
  tx: Tx,
  spaceId: string,
  scope: ClassesScope,
  sessionId: string,
): Promise<SessionRow> {
  const session = await lockSession(
    tx,
    and(eq(classSessions.spaceId, spaceId), eq(classSessions.id, sessionId), sessionScope(scope)),
  );
  if (!session) throw classSessionNotFound();
  return session;
}

/**
 * Listas das sessões (sem desistências): confirmados e presenças primeiro, depois a espera em
 * ordem. Usada no detail da gestão e na visão de equipe.
 */
export async function attendeesOf(
  db: DbOrTx,
  sessionIds: string[],
): Promise<(Attendee & { sessionId: string })[]> {
  if (!sessionIds.length) return [];
  const order: SQL = sql`CASE ${attendances.status} WHEN 'WAITLIST' THEN 1 ELSE 0 END`;
  return db
    .select({
      sessionId: attendances.sessionId,
      userId: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: attendances.status,
      waitlistPosition: attendances.waitlistPosition,
      addedByStaff: attendances.addedByStaff,
    })
    .from(attendances)
    .innerJoin(users, eq(users.id, attendances.userId))
    .where(and(inArray(attendances.sessionId, sessionIds), ne(attendances.status, 'CANCELLED')))
    .orderBy(order, asc(attendances.waitlistPosition), asc(users.name), asc(users.id));
}
