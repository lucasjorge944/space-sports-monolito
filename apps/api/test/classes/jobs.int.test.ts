import { Logger } from '@nestjs/common';
import { addMinutes } from '@space-sports/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SpaceContextService } from '../../src/bookings/space-context.js';
import {
  CLASS_SESSIONS_JOBS,
  PartialClassJobFailure,
  runClassSessionsJob,
} from '../../src/classes/class-sessions.jobs.js';
import { ClassSessionsService } from '../../src/classes/class-sessions.service.js';
import { releaseTeacher } from '../../src/classes/class-teachers.js';
import {
  auditLogs,
  classGroups,
  classGroupTeachers,
  classSessionConflicts,
  classSessions,
  courtOccupations,
  spaceMembers,
  spaces,
  teacherOccupations,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { insertSession } from './attendance-fixtures.js';
import {
  classOccupations,
  occupy,
  occurrenceStart,
  sessionsOf,
  sessionTeacherIds,
  slotWeekday,
  teacherMemberId,
} from './fixtures.js';
import { insertGroup as insertGroupRow } from './subscription-fixtures.js';

// RF-CLASS-02: job que gera as sessões das turmas fixas (fila própria, idempotente, retry sem
// duplicar; conflito com a agenda é sinalizado sem quebrar o job).

useMiddayClock();

type GroupInsert = typeof classGroups.$inferInsert & { teacherMemberId: string };

describe('job de sessões das turmas', () => {
  let t: TestApp;
  let sessions: ClassSessionsService;
  let space: Space;
  let teacherId: string;
  let nextHour = 0;

  beforeAll(async () => {
    t = await createTestApp();
    sessions = t.app.get(ClassSessionsService);
    space = await createSpace(t.db, 'arena-job-aulas');
    const teacher = await member(t, 'prof-job@exemplo.com', space.id, 'TEACHER');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
  });
  afterAll(() => t.close());
  // O job varre todas as turmas ativas: desativa as do teste anterior.
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.db.update(classGroups).set({ active: false });
  });

  const run = () => runClassSessionsJob(CLASS_SESSIONS_JOBS.generateSessions, { sessions });

  /** Turma inserida direto no banco (sem sessões), como se o job ainda não tivesse rodado. */
  async function insertGroup(overrides: Partial<GroupInsert> = {}) {
    return insertGroupRow(t.db, {
      spaceId: space.id,
      sportId: space.sportId,
      teacherMemberId: teacherId,
      courtId: space.courtA,
      name: 'Turma do job',
      weekday: slotWeekday(),
      startTime: `${String(nextHour++).padStart(2, '0')}:00`,
      durationMin: 60,
      capacity: 5,
      ...overrides,
    });
  }

  it('gera 4 semanas de sessões e é idempotente', async () => {
    const group = await insertGroup();
    await expect(run()).resolves.toMatchObject({ classGroups: 1, created: 4, failures: 0 });
    const generated = await sessionsOf(t.db, group.id);
    expect(generated.map((s) => s.startsAt.toISOString())).toEqual(
      [0, 1, 2, 3].map((n) => occurrenceStart(n, group.startTime.slice(0, 5)).toISOString()),
    );
    expect(generated.every((s) => s.capacity === 5)).toBe(true);
    for (const session of generated) {
      expect(await sessionTeacherIds(t.db, session.id)).toEqual([teacherId]);
    }
    expect(
      await classOccupations(
        t.db,
        generated.map((s) => s.id),
      ),
    ).toHaveLength(4);

    // Segunda rodada (ou retry): nada novo.
    await expect(run()).resolves.toMatchObject({ created: 0, conflicts: 0 });
    expect(await sessionsOf(t.db, group.id)).toHaveLength(4);
  });

  it('não recria a sessão cancelada', async () => {
    const group = await insertGroup();
    await run();
    const [session] = await sessionsOf(t.db, group.id);
    if (!session) throw new Error('sessão não gerada');
    await t.db
      .update(classSessions)
      .set({ status: 'CANCELLED', cancelReason: 'Feriado' })
      .where(eq(classSessions.id, session.id));
    await t.db
      .update(courtOccupations)
      .set({ active: false })
      .where(eq(courtOccupations.refId, session.id));
    await expect(run()).resolves.toMatchObject({ created: 0 });
    expect(await sessionsOf(t.db, group.id)).toHaveLength(4);
  });

  it('sinaliza o conflito com bloqueio sem falhar e gera quando o horário libera', async () => {
    const group = await insertGroup();
    const blocked = occurrenceStart(1, group.startTime.slice(0, 5));
    const block = await occupy(t.db, space.courtA, blocked, addMinutes(blocked, 60), 'BLOCK');

    await expect(run()).resolves.toMatchObject({ created: 3, conflicts: 1, failures: 0 });
    expect(await sessionsOf(t.db, group.id)).toHaveLength(3);
    const [conflict] = await t.db
      .select()
      .from(classSessionConflicts)
      .where(eq(classSessionConflicts.classGroupId, group.id));
    expect(conflict).toMatchObject({ startsAt: blocked, conflictsWith: 'BLOCK', resolvedAt: null });

    // Rodar de novo com o bloqueio: continua sinalizado, sem duplicar o aviso.
    await expect(run()).resolves.toMatchObject({ created: 0, conflicts: 1 });
    expect(
      await t.db
        .select()
        .from(classSessionConflicts)
        .where(eq(classSessionConflicts.classGroupId, group.id)),
    ).toHaveLength(1);

    await t.db
      .update(courtOccupations)
      .set({ active: false })
      .where(eq(courtOccupations.id, block.id));
    await expect(run()).resolves.toMatchObject({ created: 1, conflicts: 0 });
    expect(await sessionsOf(t.db, group.id)).toHaveLength(4);
    const open = await t.db
      .select()
      .from(classSessionConflicts)
      .where(
        and(
          eq(classSessionConflicts.classGroupId, group.id),
          isNull(classSessionConflicts.resolvedAt),
        ),
      );
    expect(open).toHaveLength(0);
  });

  it('ignora turmas inativas e espaços suspensos', async () => {
    const inactive = await insertGroup({ active: false });
    const frozen = await createSpace(t.db, 'arena-job-suspensa');
    const frozenTeacher = await member(t, 'prof-job-suspensa@exemplo.com', frozen.id, 'TEACHER');
    const frozenGroup = await insertGroup({
      spaceId: frozen.id,
      courtId: frozen.courtA,
      sportId: frozen.sportId,
      teacherMemberId: await teacherMemberId(t.db, frozenTeacher.id, frozen.id),
    });
    await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, frozen.id));
    await expect(run()).resolves.toMatchObject({ classGroups: 0, created: 0 });
    expect(await sessionsOf(t.db, inactive.id)).toHaveLength(0);
    expect(await sessionsOf(t.db, frozenGroup.id)).toHaveLength(0);
  });

  it('falha parcial: grava o resto, falha o job e o retry completa sem duplicar', async () => {
    const ok = await insertGroup();
    const broken = await createSpace(t.db, 'arena-job-falha');
    const brokenTeacher = await member(t, 'prof-job-falha@exemplo.com', broken.id, 'TEACHER');
    const failing = await insertGroup({
      spaceId: broken.id,
      courtId: broken.courtA,
      sportId: broken.sportId,
      teacherMemberId: await teacherMemberId(t.db, brokenTeacher.id, broken.id),
    });
    const contexts = t.app.get(SpaceContextService);
    const load = contexts.load.bind(contexts);
    let failed = false;
    vi.spyOn(contexts, 'load').mockImplementation((spaceId, db) => {
      if (spaceId === broken.id && !failed) {
        failed = true;
        return Promise.reject(new Error('Conexão perdida.'));
      }
      return load(spaceId, db);
    });

    const error = await run().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PartialClassJobFailure);
    expect((error as PartialClassJobFailure).summary).toMatchObject({ created: 4, failures: 1 });
    expect(await sessionsOf(t.db, ok.id)).toHaveLength(4);
    expect(await sessionsOf(t.db, failing.id)).toHaveLength(0);

    await expect(run()).resolves.toMatchObject({ created: 4, failures: 0 });
    expect(await sessionsOf(t.db, ok.id)).toHaveLength(4);
    expect(await sessionsOf(t.db, failing.id)).toHaveLength(4);
  });

  describe('professores com aula em outro espaço (decisão 47)', () => {
    let other: Space;
    let owner: SignedUp;
    let shared: SignedUp;
    let sharedHere: string;
    let sharedThere: string;

    beforeAll(async () => {
      other = await createSpace(t.db, 'arena-job-vizinha');
      owner = await member(t, 'dono-job@exemplo.com', space.id, 'OWNER');
      shared = await member(t, 'prof-job-dois@exemplo.com', space.id, 'TEACHER');
      await t.db
        .insert(spaceMembers)
        .values({ userId: shared.id, spaceId: other.id, role: 'TEACHER', status: 'ACTIVE' });
      sharedHere = await teacherMemberId(t.db, shared.id, space.id);
      sharedThere = await teacherMemberId(t.db, shared.id, other.id);
    });

    /** Aula já gerada do professor no outro espaço (a turma inativa fica fora do job). */
    async function busyElsewhere(startsAt: Date) {
      const group = await insertGroupRow(t.db, {
        spaceId: other.id,
        sportId: other.sportId,
        courtId: other.courtA,
        teacherMemberId: sharedThere,
        name: 'Turma vizinha',
        weekday: slotWeekday(),
        startTime: '06:00',
        durationMin: 60,
        capacity: 5,
        active: false,
      });
      const endsAt = addMinutes(startsAt, 60);
      const session = await insertSession(t.db, group, 0, { startsAt, endsAt });
      await t.db.insert(teacherOccupations).values({
        userId: shared.id,
        spaceId: other.id,
        classSessionId: session.id,
        period: { start: startsAt, end: endsAt },
      });
      return session;
    }

    it('gera a aula sem o professor em conflito quando resta outro', async () => {
      const group = await insertGroup({ teacherMemberId: sharedHere });
      await t.db
        .insert(classGroupTeachers)
        .values({ classGroupId: group.id, spaceId: space.id, teacherMemberId: teacherId });
      const busy = occurrenceStart(1, group.startTime.slice(0, 5));
      await busyElsewhere(busy);
      const warn = vi.spyOn(Logger.prototype, 'warn');

      await expect(run()).resolves.toMatchObject({
        created: 4,
        conflicts: 0,
        teachersSkipped: 1,
        failures: 0,
      });

      const generated = await sessionsOf(t.db, group.id);
      const both = [sharedHere, teacherId].sort();
      for (const session of generated) {
        expect(await sessionTeacherIds(t.db, session.id)).toEqual(
          session.startsAt.getTime() === busy.getTime() ? [teacherId] : both,
        );
      }
      const skipped = first(generated.filter((s) => s.startsAt.getTime() === busy.getTime()));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          classGroupId: group.id,
          classSessionId: skipped.id,
          teacherUserIds: [shared.id],
        }),
        expect.any(String),
      );
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, skipped.id),
            eq(auditLogs.action, 'class_session.teacher_skipped'),
          ),
        );
      expect(log).toMatchObject({ actorId: null, diff: { teacherMemberIds: [sharedHere] } });
      expect(
        await t.db
          .select()
          .from(classSessionConflicts)
          .where(eq(classSessionConflicts.classGroupId, group.id)),
      ).toEqual([]);

      // A aula que ficou sem ele tem lista própria: não segue a troca feita depois na turma.
      const extra = await member(t, 'prof-job-extra@exemplo.com', space.id, 'TEACHER');
      const extraId = await teacherMemberId(t.db, extra.id, space.id);
      await t
        .http()
        .patch(`/v1/manage/spaces/${space.id}/class-groups/${group.id}`)
        .set(...bearer(owner))
        .send({ teacherMemberIds: [teacherId, extraId] })
        .expect(200);
      expect(await sessionTeacherIds(t.db, skipped.id)).toEqual([teacherId]);
      const follower = first(generated.filter((s) => s.id !== skipped.id));
      expect(await sessionTeacherIds(t.db, follower.id)).toEqual([teacherId, extraId].sort());
    });

    it('trocar a lista da turma gera na hora a aula que faltava e encerra o aviso', async () => {
      const group = await insertGroup({ teacherMemberId: sharedHere });
      const busy = occurrenceStart(1, group.startTime.slice(0, 5));
      await busyElsewhere(busy);
      await expect(run()).resolves.toMatchObject({ created: 3, conflicts: 1, failures: 0 });

      await t
        .http()
        .patch(`/v1/manage/spaces/${space.id}/class-groups/${group.id}`)
        .set(...bearer(owner))
        .send({ teacherMemberIds: [sharedHere, teacherId] })
        .expect(200);

      const generated = await sessionsOf(t.db, group.id);
      expect(generated).toHaveLength(4);
      const rescued = first(generated.filter((s) => s.startsAt.getTime() === busy.getTime()));
      expect(await sessionTeacherIds(t.db, rescued.id)).toEqual([teacherId]);
      const [conflict] = await t.db
        .select()
        .from(classSessionConflicts)
        .where(eq(classSessionConflicts.classGroupId, group.id));
      expect(conflict?.resolvedAt).not.toBeNull();
      await expect(run()).resolves.toMatchObject({ created: 0, conflicts: 0, failures: 0 });
    });

    it('professor saindo da equipe durante o job não entra nas aulas geradas', async () => {
      const leaving = await member(t, 'prof-job-sai@exemplo.com', space.id, 'TEACHER');
      const leavingId = await teacherMemberId(t.db, leaving.id, space.id);
      const group = await insertGroup({ teacherMemberId: leavingId });
      await t.db
        .insert(classGroupTeachers)
        .values({ classGroupId: group.id, spaceId: space.id, teacherMemberId: teacherId });

      let generation: ReturnType<typeof run> | undefined;
      await t.db.transaction(async (tx) => {
        await releaseTeacher(tx, space.id, leaving.id);
        await tx
          .update(spaceMembers)
          .set({ status: 'REMOVED' })
          .where(eq(spaceMembers.id, leavingId));
        // O job lê a lista ainda com o professor e espera a saída terminar.
        generation = run();
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      await expect(generation).resolves.toMatchObject({ created: 4, failures: 0 });

      for (const session of await sessionsOf(t.db, group.id)) {
        expect(await sessionTeacherIds(t.db, session.id)).toEqual([teacherId]);
      }
    });

    it('sem nenhum professor livre: não gera, avisa a gestão e o lote segue', async () => {
      const lone = await insertGroup({ teacherMemberId: sharedHere });
      const bystander = await insertGroup();
      const busy = occurrenceStart(1, lone.startTime.slice(0, 5));
      const elsewhere = await busyElsewhere(busy);
      const warn = vi.spyOn(Logger.prototype, 'warn');

      await expect(run()).resolves.toMatchObject({ created: 7, conflicts: 1, failures: 0 });
      expect(await sessionsOf(t.db, lone.id)).toHaveLength(3);
      expect(await sessionsOf(t.db, bystander.id)).toHaveLength(4);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ classGroupId: lone.id, teacherUserIds: [shared.id] }),
        expect.any(String),
      );

      const res = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/class-session-conflicts`)
        .set(...bearer(owner))
        .expect(200);
      const notice = res.body.items.find(
        (item: { classGroup: { id: string } }) => item.classGroup.id === lone.id,
      );
      expect(notice).toMatchObject({ conflictsWith: 'TEACHER', startsAt: busy.toISOString() });
      const raw = JSON.stringify(notice);
      expect(raw).not.toContain(other.id);
      expect(raw).not.toContain('arena-job-vizinha');

      // O outro espaço liberou o horário: a aula sai na rodada seguinte e o aviso se encerra.
      await t.db
        .update(teacherOccupations)
        .set({ active: false })
        .where(eq(teacherOccupations.classSessionId, elsewhere.id));
      await expect(run()).resolves.toMatchObject({ created: 1, conflicts: 0, failures: 0 });
      expect(await sessionsOf(t.db, lone.id)).toHaveLength(4);
      const [conflict] = await t.db
        .select()
        .from(classSessionConflicts)
        .where(eq(classSessionConflicts.classGroupId, lone.id));
      expect(conflict?.resolvedAt).not.toBeNull();
    });
  });

  it('job desconhecido falha', async () => {
    await expect(runClassSessionsJob('outro', { sessions })).rejects.toThrow(/desconhecido/);
  });
});
