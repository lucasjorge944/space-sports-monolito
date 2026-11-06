import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, supportSessions } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  NIL_UUID,
  type Row,
  seedCatalog,
  setSpaceStatus,
  superUser,
} from './fixtures.js';

// RF-SUPER-04 e RN-SUPER-01: modo suporte (impersonação auditada, limitada ao espaço).

const SUPPORT = 'x-support-session';

describe('Super: modo suporte', () => {
  let t: TestApp;
  let admin: SignedUp;
  let otherAdmin: SignedUp;
  let owner: SignedUp;
  let spaceId: string;
  let otherSpaceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const catalog = await seedCatalog(t.db);
    spaceId = (await createSpace(t.db, catalog, { name: 'Arena Suporte', slug: 'arena-suporte' }))
      .id;
    otherSpaceId = (await createSpace(t.db, catalog, { name: 'Arena Outra', slug: 'arena-outra' }))
      .id;
    owner = await member(t, 'dono@exemplo.com', spaceId, 'OWNER');
    admin = await superUser(t, 'super@exemplo.com');
    otherAdmin = await superUser(t, 'super2@exemplo.com');
  });
  afterAll(() => t.close());

  const start = (space = spaceId, user = admin, reason = 'Ajustar o cadastro a pedido do dono') =>
    t
      .http()
      .post(`/v1/super/spaces/${space}/support-sessions`)
      .set(...bearer(user))
      .send({ reason });
  const manage = (
    method: 'get' | 'patch',
    session: string | null,
    space = spaceId,
    user = admin,
  ) => {
    const req = t
      .http()
      [method](`/v1/manage/spaces/${space}`)
      .set(...bearer(user));
    if (session) req.set(SUPPORT, session);
    return method === 'patch' ? req.send({ description: 'Editado no suporte' }) : req;
  };
  const audit = (action: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.spaceId, spaceId)));

  it('sem sessão de suporte o Super não acessa o painel do espaço (sem acesso automático)', async () => {
    const res = await manage('get', null).expect(403);
    expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
  });

  it('abre a sessão com motivo, registra o início e sinaliza as respostas', async () => {
    await start(spaceId, admin, '').expect(400);
    const started = await start().expect(201);
    expect(started.body).toMatchObject({
      spaceId,
      spaceName: 'Arena Suporte',
      superUserId: admin.id,
      reason: 'Ajustar o cadastro a pedido do dono',
      active: true,
      endedAt: null,
    });
    const session = started.body.id as string;
    const ttlMin =
      (new Date(started.body.expiresAt).getTime() - new Date(started.body.startedAt).getTime()) /
      60_000;
    // `startedAt` vem do relógio do banco e `expiresAt` do da API: tolera alguns ms.
    expect(Math.round(ttlMin)).toBe(120);

    const read = await manage('get', session).expect(200);
    expect(read.headers['x-support-mode']).toBe('true');
    expect(read.headers[SUPPORT]).toBe(session);
    const write = await manage('patch', session).expect(200);
    expect(write.body.description).toBe('Editado no suporte');
    expect(write.headers['x-support-mode']).toBe('true');

    // O Dono, sem o header, não recebe o sinal.
    const normal = await manage('get', null, spaceId, owner).expect(200);
    expect(normal.headers['x-support-mode']).toBeUndefined();

    // RN-SUPER-01: início e cada requisição ficam no log com o Super responsável.
    const [startLog] = await audit('support.start');
    expect(startLog).toMatchObject({
      actorId: admin.id,
      actingAsSuper: true,
      entity: 'support_session',
      entityId: session,
      diff: { reason: 'Ajustar o cadastro a pedido do dono' },
    });
    const requests = await audit('support.request');
    expect(requests.map((row) => row.diff)).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: `/v1/manage/spaces/${spaceId}` },
        { method: 'PATCH', path: `/v1/manage/spaces/${spaceId}` },
      ]),
    );
    expect(requests.every((row) => row.actorId === admin.id && row.actingAsSuper)).toBe(true);
  });

  it('o escopo é só o espaço da sessão', async () => {
    const [session] = await t.db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.spaceId, spaceId));
    const res = await manage('get', session?.id ?? '', otherSpaceId).expect(403);
    expect(res.body.error.code).toBe('SUPPORT_SESSION_INVALID');
    // Fora das rotas do painel do espaço o header não faz nada.
    await t
      .http()
      .get('/v1/me')
      .set(...bearer(admin))
      .set(SUPPORT, session?.id ?? '')
      .expect(200);
  });

  it('só o Super dono da sessão usa o id; usuário comum, outro Super e lixo são recusados', async () => {
    const [session] = await t.db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.spaceId, spaceId));
    const id = session?.id ?? '';
    for (const user of [owner, otherAdmin]) {
      const res = await manage('get', id, spaceId, user).expect(403);
      expect(res.body.error.code).toBe('SUPPORT_SESSION_INVALID');
    }
    for (const bad of ['nao-e-uuid', NIL_UUID]) {
      const res = await manage('get', bad).expect(403);
      expect(res.body.error.code).toBe('SUPPORT_SESSION_INVALID');
    }
  });

  it('espaço suspenso continua só leitura, até no modo suporte', async () => {
    const [session] = await t.db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.spaceId, spaceId));
    await setSpaceStatus(t.db, spaceId, 'SUSPENDED');
    await manage('get', session?.id ?? '').expect(200);
    const res = await manage('patch', session?.id ?? '').expect(403);
    expect(res.body.error.code).toBe('SPACE_READ_ONLY');
    await setSpaceStatus(t.db, spaceId, 'ACTIVE');
  });

  it('sessão expirada deixa de valer', async () => {
    const [session] = await t.db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.spaceId, spaceId));
    const id = session?.id ?? '';
    await t.db
      .update(supportSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(supportSessions.id, id));
    const res = await manage('get', id).expect(403);
    expect(res.body.error.code).toBe('SUPPORT_SESSION_INVALID');
    const listed = await t
      .http()
      .get('/v1/super/support-sessions?active=true')
      .set(...bearer(admin))
      .expect(200);
    expect(listed.body.items.find((s: Row) => s.id === id)).toBeUndefined();
  });

  it('encerrar registra o fim, invalida o id e é idempotente; só o próprio Super encerra', async () => {
    const started = await start(otherSpaceId).expect(201);
    const id = started.body.id as string;
    await manage('get', id, otherSpaceId).expect(200);

    await t
      .http()
      .post(`/v1/super/support-sessions/${id}/end`)
      .set(...bearer(otherAdmin))
      .expect(404);

    const ended = await t
      .http()
      .post(`/v1/super/support-sessions/${id}/end`)
      .set(...bearer(admin))
      .expect(200);
    expect(ended.body).toMatchObject({ active: false });
    expect(ended.body.endedAt).not.toBeNull();
    await t
      .http()
      .post(`/v1/super/support-sessions/${id}/end`)
      .set(...bearer(admin))
      .expect(200);

    const res = await manage('get', id, otherSpaceId).expect(403);
    expect(res.body.error.code).toBe('SUPPORT_SESSION_INVALID');
    const endLogs = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'support.end'), eq(auditLogs.entityId, id)));
    expect(endLogs).toHaveLength(1);
    expect(endLogs[0]).toMatchObject({
      actorId: admin.id,
      actingAsSuper: true,
      spaceId: otherSpaceId,
    });
  });

  it('abrir outra sessão encerra a anterior do mesmo Super', async () => {
    const first = (await start(spaceId).expect(201)).body.id as string;
    const second = (await start(otherSpaceId).expect(201)).body.id as string;
    await manage('get', first).expect(403);
    await manage('get', second, otherSpaceId).expect(200);

    const list = await t
      .http()
      .get(`/v1/super/support-sessions?spaceId=${spaceId}`)
      .set(...bearer(otherAdmin))
      .expect(200);
    expect(list.body.items.map((s: Row) => s.id)).toContain(first);
    const firstRow = list.body.items.find((s: Row) => s.id === first);
    expect(firstRow).toMatchObject({ active: false, superUserName: 'Super Teste' });

    await start(NIL_UUID).expect(404);
  });
});
