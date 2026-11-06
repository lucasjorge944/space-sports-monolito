import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountDeletionRequests,
  auditLogs,
  sessions,
  spaceMembers,
  users,
} from '../../src/db/schema/index.js';
import { createTestApp, PASSWORD, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  NIL_UUID,
  type Row,
  seedCatalog,
  superUser,
} from './fixtures.js';

// RF-SUPER-07 e RF-SUPER-08: usuários, bloqueio, exclusão (LGPD) e usuários Super.

describe('Super: usuários', () => {
  let t: TestApp;
  let admin: SignedUp;
  let spaceA: string;
  let spaceB: string;

  const call = (method: 'get' | 'post' | 'delete', path: string, body?: object, user = admin) => {
    const req = t
      .http()
      [method](path)
      .set(...bearer(user));
    return body ? req.send(body) : req;
  };

  beforeAll(async () => {
    t = await createTestApp();
    const catalog = await seedCatalog(t.db);
    admin = await superUser(t, 'super@exemplo.com');
    spaceA = (await createSpace(t.db, catalog, { name: 'Arena A', slug: 'arena-a' })).id;
    spaceB = (await createSpace(t.db, catalog, { name: 'Arena B', slug: 'arena-b' })).id;
  });
  afterAll(() => t.close());

  describe('buscar e ver vínculos', () => {
    it('busca por nome, e-mail ou telefone e filtra por status/papel', async () => {
      const ana = await member(t, 'ana.silva@exemplo.com', spaceA, 'OWNER');
      await t.db
        .insert(spaceMembers)
        .values({ userId: ana.id, spaceId: spaceB, role: 'ADMIN', status: 'ACTIVE' });
      await t.db
        .update(users)
        .set({ name: 'Ana Silva', phone: '+5531977770000', phoneVerified: true })
        .where(eq(users.id, ana.id));

      const ids = async (query: string) =>
        (await call('get', `/v1/super/users?${query}`).expect(200)).body.items.map(
          (u: Row) => u.id,
        );
      expect(await ids('q=ana%20sil')).toEqual([ana.id]);
      expect(await ids('q=ana.silva%40')).toEqual([ana.id]);
      expect(await ids('q=%2B5531977770000')).toEqual([ana.id]);
      expect(await ids('q=zzzz')).toEqual([]);
      expect(await ids('platformRole=SUPER')).toEqual([admin.id]);
      expect(await ids('status=BLOCKED')).toEqual([]);

      const detail = (await call('get', `/v1/super/users/${ana.id}`).expect(200)).body;
      expect(detail).toMatchObject({
        name: 'Ana Silva',
        phone: '+5531977770000',
        phoneVerified: true,
        status: 'ACTIVE',
        platformRole: 'USER',
        spacesCount: 2,
      });
      expect(detail.memberships.map((m: Row) => [m.spaceSlug, m.role, m.status])).toEqual([
        ['arena-a', 'OWNER', 'ACTIVE'],
        ['arena-b', 'ADMIN', 'ACTIVE'],
      ]);
      expect(detail.activeSessions).toBe(1);
      await call('get', `/v1/super/users/${NIL_UUID}`).expect(404);
      await call('get', '/v1/super/users/xpto').expect(404);
    });

    it('telefone repetido (não verificado, decisão 64): a busca acha todas as contas e mostra quem verificou', async () => {
      const phone = '+5531966665555';
      const typed = await signUp(t, 'digitado-1@exemplo.com', 'Telefone Digitado', phone);
      const typed2 = await signUp(t, 'digitado-2@exemplo.com', 'Telefone Digitado 2', phone);
      const owner = await signUp(t, 'dono-numero@exemplo.com', 'Dono do Número');
      await t.db.update(users).set({ phone, phoneVerified: true }).where(eq(users.id, owner.id));

      const res = await call(
        'get',
        `/v1/super/users?q=${encodeURIComponent('5531966665555')}`,
      ).expect(200);
      expect(res.body.items.map((u: Row) => [u.id, u.phone, u.phoneVerified]).sort()).toEqual(
        [
          [typed.id, phone, false],
          [typed2.id, phone, false],
          [owner.id, phone, true],
        ].sort(),
      );
      expect(res.body.total).toBe(3);
      const detail = (await call('get', `/v1/super/users/${typed.id}`).expect(200)).body;
      expect(detail).toMatchObject({ phone, phoneVerified: false });
    });
  });

  describe('bloquear (encerra as sessões)', () => {
    it('derruba as sessões na hora e impede o uso da conta até desbloquear', async () => {
      const bruno = await signUp(t, 'bruno@exemplo.com', 'Bruno');
      // Duas sessões: a do cadastro e uma segunda por login (outro dispositivo).
      const second = await t
        .http()
        .post('/v1/auth/sign-in/email')
        .send({ email: bruno.email, password: PASSWORD });
      const secondToken = second.headers['set-auth-token'] as string;
      const me = (token: string) => t.http().get('/v1/me').set('authorization', `Bearer ${token}`);
      await me(bruno.token).expect(200);
      await me(secondToken).expect(200);

      const blocked = await call('post', `/v1/super/users/${bruno.id}/block`, {
        reason: 'Abuso',
      }).expect(200);
      expect(blocked.body).toMatchObject({ status: 'BLOCKED', activeSessions: 0 });
      expect(await t.db.select().from(sessions).where(eq(sessions.userId, bruno.id))).toHaveLength(
        0,
      );
      expect((await me(bruno.token).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
      await me(secondToken).expect(401);

      // Conta bloqueada também não consegue entrar de novo.
      const again = await t
        .http()
        .post('/v1/auth/sign-in/email')
        .send({ email: bruno.email, password: PASSWORD })
        .expect(403);
      expect(again.body.error.code).toBe('USER_BLOCKED');

      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.user.block'));
      expect(log).toMatchObject({ actorId: admin.id, actingAsSuper: true, entityId: bruno.id });
      expect(log?.diff).toMatchObject({ reason: 'Abuso', sessionsEnded: 2 });

      await call('post', `/v1/super/users/${bruno.id}/unblock`).expect(200);
      const fresh = await t
        .http()
        .post('/v1/auth/sign-in/email')
        .send({ email: bruno.email, password: PASSWORD });
      await me(fresh.headers['set-auth-token'] as string).expect(200);
    });

    it('reativa a conta inativada pelo titular (RF-AUTH-03), com auditoria', async () => {
      const ivo = await signUp(t, 'ivo@exemplo.com', 'Ivo');
      await t
        .http()
        .post('/v1/me/deactivate')
        .set(...bearer(ivo))
        .expect(204);

      // O Super vê o status no detalhe e filtra a lista por ele.
      expect((await call('get', `/v1/super/users/${ivo.id}`).expect(200)).body).toMatchObject({
        status: 'INACTIVE',
        activeSessions: 0,
      });
      const inactive = await call('get', '/v1/super/users?status=INACTIVE').expect(200);
      expect(inactive.body.items.map((u: Row) => u.id)).toEqual([ivo.id]);
      expect(inactive.body.items[0]).toMatchObject({ status: 'INACTIVE' });

      const reactivated = await call('post', `/v1/super/users/${ivo.id}/unblock`).expect(200);
      expect(reactivated.body).toMatchObject({ status: 'ACTIVE' });
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'super.user.reactivate'), eq(auditLogs.entityId, ivo.id)));
      expect(log).toMatchObject({ actorId: admin.id, actingAsSuper: true });
      expect(log?.diff).toEqual({ from: 'INACTIVE' });

      const fresh = await t
        .http()
        .post('/v1/auth/sign-in/email')
        .send({ email: ivo.email, password: PASSWORD })
        .expect(200);
      await t
        .http()
        .get('/v1/me')
        .set('authorization', `Bearer ${fresh.headers['set-auth-token']}`)
        .expect(200);
    });

    it('desbloquear grava de qual status a conta saiu', async () => {
      const jane = await signUp(t, 'jane@exemplo.com', 'Jane');
      await call('post', `/v1/super/users/${jane.id}/block`, {}).expect(200);
      await call('post', `/v1/super/users/${jane.id}/unblock`).expect(200);
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'super.user.unblock'), eq(auditLogs.entityId, jane.id)));
      expect(log?.diff).toEqual({ from: 'BLOCKED' });
    });

    it('não bloqueia a si mesmo nem usuário inexistente', async () => {
      const self = await call('post', `/v1/super/users/${admin.id}/block`, {}).expect(409);
      expect(self.body.error.code).toBe('CANNOT_ACT_ON_SELF');
      await call('post', `/v1/super/users/${NIL_UUID}/block`, {}).expect(404);
    });
  });

  describe('pedidos de exclusão (LGPD)', () => {
    it('atender anonimiza a conta, encerra vínculos e sessões e conclui o pedido', async () => {
      const carla = await member(t, 'carla@exemplo.com', spaceA, 'ADMIN');
      const created = await call('post', `/v1/super/users/${carla.id}/deletion-requests`, {
        note: 'Pedido recebido por e-mail',
      }).expect(201);
      expect(created.body).toMatchObject({ status: 'PENDING', source: 'SUPER', userId: carla.id });
      const dup = await call('post', `/v1/super/users/${carla.id}/deletion-requests`, {}).expect(
        409,
      );
      expect(dup.body.error.code).toBe('DELETION_REQUEST_PENDING');
      expect(
        (await call('get', `/v1/super/users/${carla.id}`).expect(200)).body
          .pendingDeletionRequestId,
      ).toBe(created.body.id);
      const pending = await call('get', '/v1/super/deletion-requests?status=PENDING').expect(200);
      expect(pending.body.items.map((r: Row) => r.id)).toEqual([created.body.id]);

      const done = await call(
        'post',
        `/v1/super/deletion-requests/${created.body.id}/fulfill`,
        {},
      ).expect(200);
      expect(done.body).toMatchObject({ status: 'COMPLETED', resolvedBy: admin.id });
      const [row] = await t.db.select().from(users).where(eq(users.id, carla.id));
      expect(row).toMatchObject({ name: 'Conta excluída', email: null, phone: null });
      expect(row?.deletedAt).not.toBeNull();
      expect(await t.db.select().from(sessions).where(eq(sessions.userId, carla.id))).toHaveLength(
        0,
      );
      const members = await t.db
        .select()
        .from(spaceMembers)
        .where(eq(spaceMembers.userId, carla.id));
      expect(members.every((m) => m.status === 'REMOVED')).toBe(true);
      await t
        .http()
        .get('/v1/me')
        .set(...bearer(carla))
        .expect(401);

      const again = await call(
        'post',
        `/v1/super/deletion-requests/${created.body.id}/fulfill`,
        {},
      ).expect(409);
      expect(again.body.error.code).toBe('DELETION_REQUEST_RESOLVED');
      const gone = await call('post', `/v1/super/users/${carla.id}/deletion-requests`, {}).expect(
        409,
      );
      expect(gone.body.error.code).toBe('USER_DELETED');
    });

    it('não deixa o espaço sem Dono: o único Dono não é excluído', async () => {
      const dono = await member(t, 'unico-dono@exemplo.com', spaceB, 'OWNER');
      const request = (
        await call('post', `/v1/super/users/${dono.id}/deletion-requests`, {}).expect(201)
      ).body.id as string;
      const res = await call('post', `/v1/super/deletion-requests/${request}/fulfill`, {}).expect(
        409,
      );
      expect(res.body.error.code).toBe('LAST_OWNER');
      // Nada mudou: a conta segue ativa e o pedido pendente.
      const [row] = await t.db.select().from(users).where(eq(users.id, dono.id));
      expect(row?.deletedAt).toBeNull();
      await t
        .http()
        .get('/v1/me')
        .set(...bearer(dono))
        .expect(200);

      // Com outro Dono no espaço, o pedido pode ser atendido.
      await member(t, 'segundo-dono@exemplo.com', spaceB, 'OWNER');
      await call('post', `/v1/super/deletion-requests/${request}/fulfill`, {}).expect(200);
    });

    it('recusar exige a justificativa e fecha o pedido', async () => {
      const diego = await signUp(t, 'diego@exemplo.com', 'Diego');
      const request = (
        await call('post', `/v1/super/users/${diego.id}/deletion-requests`, {}).expect(201)
      ).body.id as string;
      await call('post', `/v1/super/deletion-requests/${request}/reject`, {}).expect(400);
      const rejected = await call('post', `/v1/super/deletion-requests/${request}/reject`, {
        note: 'Titular não confirmou a identidade',
      }).expect(200);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        note: 'Titular não confirmou a identidade',
      });
      await t
        .http()
        .get('/v1/me')
        .set(...bearer(diego))
        .expect(200);
      // Um pedido novo pode ser aberto depois.
      await call('post', `/v1/super/users/${diego.id}/deletion-requests`, {}).expect(201);
      const [stored] = await t.db
        .select()
        .from(accountDeletionRequests)
        .where(
          and(
            eq(accountDeletionRequests.userId, diego.id),
            eq(accountDeletionRequests.status, 'REJECTED'),
          ),
        );
      expect(stored?.resolvedBy).toBe(admin.id);
    });

    it('não atende o próprio pedido nem Super (sem outro Super para assumir)', async () => {
      const other = await superUser(t, 'super-saindo@exemplo.com');
      const request = (
        await call('post', `/v1/super/users/${other.id}/deletion-requests`, {}).expect(201)
      ).body.id as string;
      const res = await call('post', `/v1/super/deletion-requests/${request}/fulfill`, {}).expect(
        409,
      );
      expect(res.body.error.code).toBe('LAST_SUPER');
      await call('post', `/v1/super/deletion-requests/${NIL_UUID}/fulfill`, {}).expect(404);
    });
  });

  describe('usuários Super (RF-SUPER-08)', () => {
    it('promove por e-mail só conta existente, ativa e com e-mail verificado', async () => {
      const eva = await signUp(t, 'eva@exemplo.com', 'Eva');
      await call('post', '/v1/super/admins', { email: 'ninguem@exemplo.com' }).expect(404);
      const unverified = await call('post', '/v1/super/admins', {
        email: 'eva@exemplo.com',
      }).expect(422);
      expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      await t
        .http()
        .get('/v1/super/spaces')
        .set(...bearer(eva))
        .expect(403);

      await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, eva.id));
      const promoted = await call('post', '/v1/super/admins', { email: 'Eva@Exemplo.com' }).expect(
        200,
      );
      expect(promoted.body).toMatchObject({ id: eva.id, name: 'Eva' });
      await call('post', '/v1/super/admins', { email: 'eva@exemplo.com' }).expect(200);
      await t
        .http()
        .get('/v1/super/spaces')
        .set(...bearer(eva))
        .expect(200);
      const list = await call('get', '/v1/super/admins').expect(200);
      expect(list.body.items.map((a: Row) => a.id)).toContain(eva.id);

      const frank = await signUp(t, 'frank@exemplo.com', 'Frank');
      await t.db
        .update(users)
        .set({ emailVerified: true, status: 'BLOCKED' })
        .where(eq(users.id, frank.id));
      const blocked = await call('post', '/v1/super/admins', { email: 'frank@exemplo.com' }).expect(
        409,
      );
      expect(blocked.body.error.code).toBe('USER_IS_BLOCKED');
      await t.db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, frank.id));
      const inactive = await call('post', '/v1/super/admins', {
        email: 'frank@exemplo.com',
      }).expect(409);
      expect(inactive.body.error.code).toBe('USER_IS_INACTIVE');

      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.admin.promote'));
      expect(log).toMatchObject({ actorId: admin.id, entityId: eva.id });
    });

    it('remove o acesso na hora; não remove a si mesmo nem quem não é Super', async () => {
      const gil = await superUser(t, 'gil@exemplo.com');
      await t
        .http()
        .get('/v1/super/spaces')
        .set(...bearer(gil))
        .expect(200);
      await call('delete', `/v1/super/admins/${gil.id}`).expect(204);
      const denied = await t
        .http()
        .get('/v1/super/spaces')
        .set(...bearer(gil))
        .expect(403);
      expect(denied.body.error.code).toBe('SUPER_REQUIRED');

      expect(
        (await call('delete', `/v1/super/admins/${admin.id}`).expect(409)).body.error.code,
      ).toBe('CANNOT_ACT_ON_SELF');
      expect((await call('delete', `/v1/super/admins/${gil.id}`).expect(409)).body.error.code).toBe(
        'NOT_SUPER',
      );
      await call('delete', `/v1/super/admins/${NIL_UUID}`).expect(404);
    });
  });
});
