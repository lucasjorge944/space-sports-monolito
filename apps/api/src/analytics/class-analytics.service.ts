import { Inject, Injectable } from '@nestjs/common';
import {
  attendanceRate,
  CLASS_ANALYTICS_COLUMNS,
  type ClassAnalytics,
  type ClassAnalyticsGroupBy,
  type ClassAnalyticsQuery,
  type SpaceRole,
} from '@space-sports/shared';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { SpaceContextService } from '../bookings/space-context.js';
import { ENROLLED_SUBSCRIPTION } from '../classes/attendance-rules.js';
import {
  type ClassesScope,
  classesScope,
  groupScope,
  sessionScope,
} from '../classes/classes-scope.js';
import type { Database } from '../db/client.js';
import {
  attendances,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  enrollments,
  spaceMembers,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import {
  type Bucket,
  columnsOf,
  fillRows,
  inPeriod,
  isTimeBucket,
  type ResolvedPeriod,
  resolvePeriod,
  timeBucketSql,
  timeBuckets,
} from './period.js';

type Counts = {
  sessionsDone: number;
  sessionsCancelled: number;
  present: number;
  absent: number;
  unmarked: number;
};
const zero = (): Counts => ({
  sessionsDone: 0,
  sessionsCancelled: 0,
  present: 0,
  absent: 0,
  unmarked: 0,
});
const values = (c: Counts, activeStudents: number | null): ClassAnalytics['totals'] => ({
  ...c,
  attendanceRate: attendanceRate(c.present, c.absent),
  activeStudents,
});

/**
 * Aulas e presença (docs/14-mcp.md 8.4), com as regras dos relatórios de presença do painel
 * (`attendance-reports.service.ts`): contam as aulas dadas (`DONE`) com início no período; presença
 * e falta são as marcadas nelas; "sem presença marcada" é o confirmado que ficou sem marcação. O
 * Professor vê só as aulas e turmas em que está entre os professores (`classes-scope.ts`, a
 * mesma regra de `classes.view` e dos relatórios no painel).
 */
@Injectable()
export class ClassAnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async classes(
    spaceId: string,
    userId: string,
    roles: readonly SpaceRole[],
    query: ClassAnalyticsQuery,
  ): Promise<ClassAnalytics> {
    const { timeZone } = await this.spaces.load(spaceId);
    const period = resolvePeriod(query, timeZone);
    const scope = await classesScope(this.db, spaceId, userId, roles);
    const groupFilter = and(
      eq(classGroups.spaceId, spaceId),
      query.classGroupId ? eq(classGroups.id, query.classGroupId) : undefined,
      query.sportId ? eq(classGroups.sportId, query.sportId) : undefined,
    );

    const [sessionRows, students, buckets] = await Promise.all([
      this.sessionCounts(query.groupBy, period, scope, spaceId, groupFilter),
      this.students(scope, groupFilter, query.groupBy),
      this.buckets(query.groupBy, period, scope, groupFilter),
    ]);

    const found = new Map<string, ClassAnalytics['totals']>();
    const labels = new Map<string, string>();
    let total = zero();
    for (const row of sessionRows) {
      const counts: Counts = {
        sessionsDone: row.sessionsDone,
        sessionsCancelled: row.sessionsCancelled,
        present: row.present,
        absent: row.absent,
        unmarked: row.unmarked,
      };
      if (row.isTotal) {
        total = counts;
        continue;
      }
      found.set(row.key, values(counts, students.byKey(row.key)));
      if (row.label) labels.set(row.key, row.label);
    }

    return {
      period: { from: period.from, to: period.to },
      groupBy: query.groupBy,
      timezone: timeZone,
      columns: columnsOf(CLASS_ANALYTICS_COLUMNS),
      rows: fillRows(
        buckets,
        found,
        () => values(zero(), null),
        (key) => labels.get(key) ?? key,
      ).map((row) =>
        found.has(row.key) ? row : { ...row, activeStudents: students.byKey(row.key) },
      ),
      totals: values(total, students.total),
    };
  }

  /**
   * Uma consulta: uma linha por (aula, marcação[, professor]) no período e no escopo, agregada por
   * grupo e no total (`GROUPING SETS`), com contagens distintas, para a aula com dois professores
   * contar uma vez no total.
   */
  private async sessionCounts(
    groupBy: ClassAnalyticsGroupBy,
    period: ResolvedPeriod,
    scope: ClassesScope,
    spaceId: string,
    groupFilter: SQL | undefined,
  ) {
    const byTeacher = groupBy === 'teacher';
    const key: SQL = isTimeBucket(groupBy)
      ? timeBucketSql(groupBy, classSessions.startsAt, period.timeZone)
      : byTeacher
        ? sql`${classSessionTeachers.teacherMemberId}::text`
        : sql`${classSessions.classGroupId}::text`;
    const label: SQL = byTeacher
      ? sql`${users.name}`
      : groupBy === 'classGroup'
        ? sql`${classGroups.name}`
        : sql`NULL::text`;

    let lines = this.db
      .select({
        key: sql<string>`${key}`.as('key'),
        label: sql<string | null>`${label}`.as('label'),
        sessionId: sql<string>`${classSessions.id}`.as('session_id'),
        sessionStatus: sql<string>`${classSessions.status}::text`.as('session_status'),
        attendanceId: sql<string | null>`${attendances.id}`.as('attendance_id'),
        attendanceStatus: sql<string | null>`${attendances.status}::text`.as('attendance_status'),
      })
      .from(classSessions)
      .innerJoin(classGroups, eq(classGroups.id, classSessions.classGroupId))
      .leftJoin(attendances, eq(attendances.sessionId, classSessions.id))
      .$dynamic();
    if (byTeacher) {
      lines = lines
        .innerJoin(classSessionTeachers, eq(classSessionTeachers.classSessionId, classSessions.id))
        .innerJoin(spaceMembers, eq(spaceMembers.id, classSessionTeachers.teacherMemberId))
        .innerJoin(users, eq(users.id, spaceMembers.userId));
    }
    const sub = lines
      .where(
        and(
          eq(classSessions.spaceId, spaceId),
          inPeriod(classSessions.startsAt, period),
          sessionScope(scope),
          groupFilter,
          // Por professor, quem é só Professor vê a linha dele.
          byTeacher && scope.kind === 'TEACHER'
            ? eq(classSessionTeachers.teacherMemberId, scope.memberId)
            : undefined,
        ),
      )
      .as('lines');

    const done = sql`${sub.sessionStatus} = 'DONE'`;
    const mark = (status: string) =>
      sql<number>`(count(DISTINCT ${sub.attendanceId}) FILTER (WHERE ${done} AND ${sub.attendanceStatus} = ${status}))::int`;
    return this.db
      .select({
        key: sub.key,
        label: sql<string | null>`max(${sub.label})`,
        isTotal: sql<boolean>`grouping(${sub.key}) = 1`,
        sessionsDone: sql<number>`(count(DISTINCT ${sub.sessionId}) FILTER (WHERE ${done}))::int`,
        sessionsCancelled: sql<number>`(count(DISTINCT ${sub.sessionId}) FILTER (WHERE ${sub.sessionStatus} = 'CANCELLED'))::int`,
        present: mark('PRESENT'),
        absent: mark('ABSENT'),
        unmarked: mark('CONFIRMED'),
      })
      .from(sub)
      .groupBy(sql`GROUPING SETS ((${sub.key}), ())`);
  }

  /**
   * Alunos ativos hoje: matrícula `ACTIVE` de assinatura em vigor (`ACTIVE` ou `PAST_DUE`, a regra
   * de quem pode confirmar presença), nas turmas do escopo. Por turma, por professor da turma e no
   * total (alunos distintos); nas linhas por data, nulo.
   */
  private async students(
    scope: ClassesScope,
    groupFilter: SQL | undefined,
    groupBy: ClassAnalyticsGroupBy,
  ) {
    const rows = await this.db
      .select({ classGroupId: enrollments.classGroupId, userId: subscriptions.userId })
      .from(enrollments)
      .innerJoin(subscriptions, eq(subscriptions.id, enrollments.subscriptionId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(
        and(
          eq(enrollments.status, 'ACTIVE'),
          inArray(subscriptions.status, ENROLLED_SUBSCRIPTION),
          groupFilter,
          groupScope(scope),
        ),
      );
    const byGroup = new Map<string, Set<string>>();
    for (const row of rows) {
      byGroup.set(row.classGroupId, (byGroup.get(row.classGroupId) ?? new Set()).add(row.userId));
    }
    const byTeacher = new Map<string, Set<string>>();
    if (groupBy === 'teacher' && byGroup.size) {
      const links = await this.db
        .select({
          classGroupId: classGroupTeachers.classGroupId,
          memberId: classGroupTeachers.teacherMemberId,
        })
        .from(classGroupTeachers)
        .where(inArray(classGroupTeachers.classGroupId, [...byGroup.keys()]));
      for (const link of links) {
        const set = byTeacher.get(link.memberId) ?? new Set<string>();
        for (const student of byGroup.get(link.classGroupId) ?? []) set.add(student);
        byTeacher.set(link.memberId, set);
      }
    }
    return {
      total: new Set(rows.map((row) => row.userId)).size,
      byKey: (key: string): number | null => {
        if (groupBy === 'classGroup') return byGroup.get(key)?.size ?? 0;
        if (groupBy === 'teacher') return byTeacher.get(key)?.size ?? 0;
        return null;
      },
    };
  }

  /** Linhas: turmas ativas do escopo, professores dessas turmas ou o calendário do período. */
  private async buckets(
    groupBy: ClassAnalyticsGroupBy,
    period: ResolvedPeriod,
    scope: ClassesScope,
    groupFilter: SQL | undefined,
  ): Promise<Bucket[]> {
    if (isTimeBucket(groupBy)) return timeBuckets(groupBy, period);
    if (groupBy === 'classGroup') {
      const groups = await this.db
        .select({ key: classGroups.id, label: classGroups.name })
        .from(classGroups)
        .where(and(groupFilter, eq(classGroups.active, true), groupScope(scope)))
        .orderBy(asc(classGroups.name), asc(classGroups.id));
      return groups;
    }
    const teachers = await this.db
      .selectDistinct({ key: spaceMembers.id, label: users.name })
      .from(classGroupTeachers)
      .innerJoin(classGroups, eq(classGroups.id, classGroupTeachers.classGroupId))
      .innerJoin(spaceMembers, eq(spaceMembers.id, classGroupTeachers.teacherMemberId))
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(
        and(
          groupFilter,
          eq(classGroups.active, true),
          scope.kind === 'TEACHER' ? eq(spaceMembers.id, scope.memberId) : undefined,
        ),
      )
      .orderBy(asc(users.name), asc(spaceMembers.id));
    return teachers;
  }
}
