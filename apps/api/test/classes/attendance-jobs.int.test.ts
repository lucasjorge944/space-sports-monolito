import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLASS_ATTENDANCE_JOBS, runClassAttendanceJob } from '../../src/classes/attendance.jobs.js';
import { ClassSessionLifecycleService } from '../../src/classes/class-session-lifecycle.service.js';
import { PartialClassJobFailure } from '../../src/classes/class-sessions.jobs.js';
import { spaceSettings, spaces } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { auditOf, insertGroup, insertSession, sessionById } from './attendance-fixtures.js';
import { teacherMemberId } from './fixtures.js';

// RN-CLASS-04: job de 1 minuto da lista de presença (fila própria, idempotente, retry). Padrões
// do espaço: AUTOMATIC, abre 1440 min antes e fecha 60 min antes.

useMiddayClock();

describe('job da lista de presença', () => {
  let t: TestApp;
  let lifecycle: ClassSessionLifecycleService;
  let space: Space;
  let admin: SignedUp;
  let teacherId: string;

  beforeAll(async () => {
    t = await createTestApp();
    lifecycle = t.app.get(ClassSessionLifecycleService);
    space = await createSpace(t.db, 'arena-job-presenca');
    admin = await member(t, 'admin-job-presenca@exemplo.com', space.id, 'ADMIN');
    const teacher = await member(t, 'prof-job-presenca@exemplo.com', space.id, 'TEACHER');
    teacherId = await teacherMemberId(t.db, teacher.id, space.id);
  });
  afterAll(() => t.close());
  afterEach(() => vi.restoreAllMocks());

  const run = () => runClassAttendanceJob(CLASS_ATTENDANCE_JOBS.tick, { lifecycle });
  const session = async (minutes: number, overrides = {}, target: Space = space) => {
    const teacher =
      target === space
        ? teacherId
        : await teacherMemberId(
            t.db,
            (await member(t, `prof-${crypto.randomUUID()}@exemplo.com`, target.id, 'TEACHER')).id,
            target.id,
          );
    return insertSession(t.db, await insertGroup(t.db, target, teacher), minutes, overrides);
  };
  const statusOf = async (id: string) => (await sessionById(t.db, id)).status;

  it('AUTOMATIC: abre na janela, uma vez só, e audita sem ator', async () => {
    const inWindow = await session(60 * 23);
    const tooEarly = await session(60 * 25);

    await run();
    expect(await statusOf(inWindow.id)).toBe('OPEN');
    expect(await statusOf(tooEarly.id)).toBe('SCHEDULED');
    const opened = await sessionById(t.db, inWindow.id);
    expect(opened.openedAt?.getTime()).toBe(Date.now());
    expect(opened.openedBy).toBeNull();

    // Idempotente: rodar de novo (ou em paralelo, retry) não repete a transição.
    await Promise.all([run(), run()]);
    const audit = await auditOf(t.db, inWindow.id, 'class_session.open');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, diff: { automatic: true, after: 'OPEN' } });
  });

  it('AUTOMATIC: fecha no horário; quem nem abriu vai direto para fechada', async () => {
    const open = await session(50, { status: 'OPEN', openedAt: new Date(Date.now() - 3_600_000) });
    const neverOpened = await session(30);

    const summary = await run();
    expect(summary).toMatchObject({ failures: 0 });
    expect(await statusOf(open.id)).toBe('CLOSED');
    expect(await statusOf(neverOpened.id)).toBe('CLOSED');
    expect(await auditOf(t.db, open.id, 'class_session.close')).toHaveLength(1);
    expect(await auditOf(t.db, neverOpened.id, 'class_session.open')).toHaveLength(0);
  });

  it('reaberta pela gestão depois do horário de fechamento, fica aberta', async () => {
    const s = await session(30, { status: 'CLOSED', closedAt: new Date() });
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/class-sessions/${s.id}/open`)
      .set(...bearer(admin))
      .expect(200);
    await run();
    expect(await statusOf(s.id)).toBe('OPEN');
  });

  it('aberta cedo pela gestão fecha no horário automático', async () => {
    const s = await session(60 * 30);
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/class-sessions/${s.id}/open`)
      .set(...bearer(admin))
      .expect(200);
    await run();
    expect(await statusOf(s.id)).toBe('OPEN');
    // 30 h depois, faltando menos de 60 min: fecha.
    await lifecycle.tick(new Date(Date.now() + (60 * 30 - 30) * 60_000));
    expect(await statusOf(s.id)).toBe('CLOSED');
  });

  it('MANUAL: o job não abre nem fecha; leva a DONE depois do fim', async () => {
    const manual = await createSpace(t.db, 'arena-job-presenca-manual');
    await t.db
      .update(spaceSettings)
      .set({ attendanceMode: 'MANUAL' })
      .where(eq(spaceSettings.spaceId, manual.id));
    const scheduled = await session(60 * 2, {}, manual);
    const open = await session(30, { status: 'OPEN', openedAt: new Date(0) }, manual);
    const ended = await session(-90, { status: 'OPEN' }, manual);

    await run();
    expect(await statusOf(scheduled.id)).toBe('SCHEDULED');
    expect(await statusOf(open.id)).toBe('OPEN');
    expect(await statusOf(ended.id)).toBe('DONE');
  });

  it('leva a DONE o que terminou, com auditoria (não mexe em cancelada) e não abre em espaço suspenso', async () => {
    const ended = await session(-61);
    const running = await session(-30, { status: 'CLOSED' });
    const cancelled = await session(-90, { status: 'CANCELLED' });
    const suspended = await createSpace(t.db, 'arena-job-presenca-suspensa');
    await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, suspended.id));
    const notOpened = await session(60 * 5, {}, suspended);

    await run();
    expect(await statusOf(ended.id)).toBe('DONE');
    expect(await statusOf(running.id)).toBe('CLOSED');
    expect(await statusOf(cancelled.id)).toBe('CANCELLED');
    expect(await statusOf(notOpened.id)).toBe('SCHEDULED');
    // A ida para DONE é auditada (em lote, sem ator), uma vez só.
    await run();
    expect(await auditOf(t.db, ended.id, 'class_session.done')).toMatchObject([
      { actorId: null, diff: { before: 'SCHEDULED', after: 'DONE', automatic: true } },
    ]);
    expect(await auditOf(t.db, cancelled.id, 'class_session.done')).toHaveLength(0);
  });

  it('duas rodadas simultâneas do tick: cada transição (e auditoria) acontece uma vez', async () => {
    const toOpen = await session(60 * 20);
    const toClose = await session(40, { status: 'OPEN', openedAt: new Date(0) });
    const toFinish = await session(-75, { status: 'CLOSED' });

    const [r1, r2] = await Promise.all([lifecycle.tick(), lifecycle.tick()]);
    expect(r1.failures + r2.failures).toBe(0);
    expect(await statusOf(toOpen.id)).toBe('OPEN');
    expect(await statusOf(toClose.id)).toBe('CLOSED');
    expect(await statusOf(toFinish.id)).toBe('DONE');
    expect(await auditOf(t.db, toOpen.id, 'class_session.open')).toHaveLength(1);
    expect(await auditOf(t.db, toClose.id, 'class_session.close')).toHaveLength(1);
    expect(await auditOf(t.db, toFinish.id, 'class_session.done')).toHaveLength(1);
  });

  it('falha de uma sessão não para o resto; o retry completa o que faltou', async () => {
    const first = await session(60 * 10);
    const second = await session(60 * 11);
    const db = (lifecycle as unknown as { db: { transaction: (...a: unknown[]) => unknown } }).db;
    const original = db.transaction.bind(db);
    let calls = 0;
    vi.spyOn(db, 'transaction').mockImplementation((...args: unknown[]) => {
      // A 1ª transação da rodada é a ida para DONE em lote; a 2ª, a primeira sessão a abrir.
      calls++;
      if (calls === 2) return Promise.reject(new Error('falha simulada'));
      return original(...args);
    });

    await expect(run()).rejects.toBeInstanceOf(PartialClassJobFailure);
    const statuses = [await statusOf(first.id), await statusOf(second.id)];
    expect(statuses.sort()).toEqual(['OPEN', 'SCHEDULED']);

    await run();
    expect(await statusOf(first.id)).toBe('OPEN');
    expect(await statusOf(second.id)).toBe('OPEN');
    expect(await auditOf(t.db, first.id, 'class_session.open')).toHaveLength(1);
    expect(await auditOf(t.db, second.id, 'class_session.open')).toHaveLength(1);
  });

  it('nome de job desconhecido falha', async () => {
    await expect(runClassAttendanceJob('outro', { lifecycle })).rejects.toThrow(/desconhecido/);
  });
});
