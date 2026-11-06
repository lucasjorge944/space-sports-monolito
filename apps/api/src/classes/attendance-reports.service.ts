import { Inject, Injectable } from '@nestjs/common';
import {
  ATTENDANCE_HISTORY_DEFAULT_DAYS,
  type AttendanceCounts,
  addDays,
  attendanceRate,
  type ClassAttendancesQuery,
  type ClassAttendancesResponse,
  type ClassGroupFrequency,
  type ClassGroupFrequencyQuery,
  MAX_ATTENDANCE_HISTORY_RANGE_DAYS,
  utcToZoned,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import { attendances, classGroups, classSessions, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { attendanceFilterRequired, attendanceRangeTooLong } from './attendance.errors.js';
import { enrollmentStates } from './attendance-rules.js';
import { classGroupNotFound } from './classes.errors.js';
import { type ClassesScope, groupScope, sessionScope } from './classes-scope.js';

type Range = { from: string; to: string; start: Date; end: Date };

/** Contadores de presença das aulas dadas (`DONE`). */
function count(statuses: string[]): AttendanceCounts {
  const present = statuses.filter((s) => s === 'PRESENT').length;
  const absent = statuses.filter((s) => s === 'ABSENT').length;
  const unmarked = statuses.filter((s) => s === 'CONFIRMED').length;
  return { present, absent, unmarked, attendanceRate: attendanceRate(present, absent) };
}

/**
 * Histórico de presença por aluno e frequência por turma (RF-CLASS-09; base dos relatórios da
 * Fase 2). Só leitura; o Professor só vê as sessões e turmas em que está.
 */
@Injectable()
export class AttendanceReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async history(
    spaceId: string,
    scope: ClassesScope,
    query: ClassAttendancesQuery,
  ): Promise<ClassAttendancesResponse> {
    if (!query.userId && !query.classGroupId) throw attendanceFilterRequired();
    const range = await this.range(spaceId, query);
    const filters: (SQL | undefined)[] = [
      eq(classSessions.spaceId, spaceId),
      gte(classSessions.startsAt, range.start),
      lt(classSessions.startsAt, range.end),
      sessionScope(scope),
      query.userId ? eq(attendances.userId, query.userId) : undefined,
      query.classGroupId ? eq(classSessions.classGroupId, query.classGroupId) : undefined,
      query.status?.length ? inArray(attendances.status, query.status) : undefined,
    ];
    const rows = await this.db
      .select({
        id: attendances.id,
        userId: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        sessionId: classSessions.id,
        groupId: classGroups.id,
        groupName: classGroups.name,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
        sessionStatus: classSessions.status,
        status: attendances.status,
        waitlistPosition: attendances.waitlistPosition,
        addedByStaff: attendances.addedByStaff,
        updatedAt: attendances.updatedAt,
      })
      .from(attendances)
      .innerJoin(classSessions, eq(classSessions.id, attendances.sessionId))
      .innerJoin(classGroups, eq(classGroups.id, classSessions.classGroupId))
      .innerJoin(users, eq(users.id, attendances.userId))
      .where(and(...filters))
      .orderBy(desc(classSessions.startsAt), asc(users.name), asc(attendances.id));
    return {
      from: range.from,
      to: range.to,
      items: rows.map((row) => ({
        id: row.id,
        student: { userId: row.userId, name: row.name, avatarUrl: row.avatarUrl },
        session: {
          id: row.sessionId,
          classGroup: { id: row.groupId, name: row.groupName },
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          status: row.sessionStatus,
        },
        status: row.status,
        waitlistPosition: row.waitlistPosition,
        addedByStaff: row.addedByStaff,
        updatedAt: row.updatedAt.toISOString(),
      })),
      summary: count(rows.filter((r) => r.sessionStatus === 'DONE').map((r) => r.status)),
    };
  }

  /** Frequência da turma: aulas dadas e canceladas, presenças por aluno e totais. */
  async frequency(
    spaceId: string,
    scope: ClassesScope,
    classGroupId: string,
    query: ClassGroupFrequencyQuery,
  ): Promise<ClassGroupFrequency> {
    const [group] = await this.db
      .select({ id: classGroups.id, name: classGroups.name })
      .from(classGroups)
      .where(
        and(eq(classGroups.spaceId, spaceId), eq(classGroups.id, classGroupId), groupScope(scope)),
      );
    if (!group) throw classGroupNotFound();
    const range = await this.range(spaceId, query);
    const sessions = await this.db
      .select({ id: classSessions.id, status: classSessions.status })
      .from(classSessions)
      .where(
        and(
          eq(classSessions.classGroupId, classGroupId),
          gte(classSessions.startsAt, range.start),
          lt(classSessions.startsAt, range.end),
        ),
      );
    const doneIds = sessions.filter((s) => s.status === 'DONE').map((s) => s.id);
    const marks = doneIds.length
      ? await this.db
          .select({ userId: attendances.userId, status: attendances.status })
          .from(attendances)
          .where(
            and(
              inArray(attendances.sessionId, doneIds),
              inArray(attendances.status, ['CONFIRMED', 'PRESENT', 'ABSENT']),
            ),
          )
      : [];
    const enrolled = new Set(
      (await enrollmentStates(this.db, { classGroupIds: [classGroupId] })).map((s) => s.userId),
    );
    const userIds = [...new Set([...enrolled, ...marks.map((m) => m.userId)])];
    const people = userIds.length
      ? await this.db
          .select({ userId: users.id, name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, userIds))
          .orderBy(asc(users.name), asc(users.id))
      : [];
    return {
      classGroup: group,
      from: range.from,
      to: range.to,
      sessionsDone: doneIds.length,
      sessionsCancelled: sessions.filter((s) => s.status === 'CANCELLED').length,
      totals: count(marks.map((m) => m.status)),
      students: people.map((person) => ({
        ...person,
        enrolled: enrolled.has(person.userId),
        ...count(marks.filter((m) => m.userId === person.userId).map((m) => m.status)),
      })),
    };
  }

  /** Datas locais do espaço (`from` a `to` inclusive); padrão: os últimos 30 dias. */
  private async range(spaceId: string, query: { from?: string; to?: string }): Promise<Range> {
    const { timeZone } = await this.spaces.load(spaceId);
    const to = query.to ?? utcToZoned(new Date(), timeZone).date;
    const from = query.from ?? addDays(to, -(ATTENDANCE_HISTORY_DEFAULT_DAYS - 1));
    if (to > addDays(from, MAX_ATTENDANCE_HISTORY_RANGE_DAYS - 1)) {
      throw attendanceRangeTooLong(MAX_ATTENDANCE_HISTORY_RANGE_DAYS);
    }
    return {
      from,
      to,
      start: zonedToUtc(from, 0, timeZone),
      end: zonedToUtc(addDays(to, 1), 0, timeZone),
    };
  }
}
