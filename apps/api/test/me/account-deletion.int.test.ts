import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountDeletionRequests,
  auditLogs,
  devices,
  sessions,
  users,
} from '../../src/db/schema/index.js';
import { PUBLIC_DELETION_MESSAGE } from '../../src/me/account.service.js';
import {
  createTestApp,
  makeSuper,
  PASSWORD,
  type SignedUp,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from '../auth/helpers.js';
import { bearer, createSpace, member } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';

// RF-AUTH-03 (decisão 40): o titular pede a exclusão pelo app (POST /v1/me/deletion-request) ou
// pela página web pública (POST /v1/public/deletion-request). A conta é inativada na hora e o
// pedido fica pendente para a equipe, que responde em até 15 dias.

const DAY_MS = 24 * 60 * 60 * 1000;

describe('pedido de exclusão pelo titular', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const request = (user: SignedUp, body?: object) =>
    t
      .http()
      .post('/v1/me/deletion-request')
      .set(...bearer(user))
      .send(body);

  const publicRequest = (body: object) =>
    t.http().post('/v1/public/deletion-request').set('origin', WEB_ORIGIN).send(body);

  const signIn = (email: string) =>
    t.http().post('/v1/auth/sign-in/email').send({ email, password: PASSWORD });

  const userRow = async (id: string) =>
    first(await t.db.select().from(users).where(eq(users.id, id)));

  const requestsOf = (userId: string) =>
    t.db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId));

  /** Dispositivo com token de push (RF-NOTIF), como o app registra. */
  const addDevice = (userId: string, token: string) =>
    t.db.insert(devices).values({ userId, expoPushToken: token, platform: 'ANDROID' });

  const devicesOf = (userId: string) =>
    t.db.select().from(devices).where(eq(devices.userId, userId));

  const mailsTo = (to: string) => t.mailer.sent.filter((mail) => mail.to === to);

  /** Espera os e-mails em segundo plano (o envio não bloqueia a resposta). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  describe('pelo app', () => {
    it('com a senha: cria o pedido, inativa a conta, encerra as sessões e manda o prazo', async () => {
      const user = await signUp(t, 'pede@exemplo.com', 'Pede');
      await addDevice(user.id, 'ExponentPushToken[pede-1]');
      const res = await request(user, { password: PASSWORD, reason: 'Não uso mais' }).expect(201);

      const { requestId, requestedAt, dueAt } = res.body;
      expect(new Date(dueAt).getTime() - new Date(requestedAt).getTime()).toBe(15 * DAY_MS);
      const [stored] = await requestsOf(user.id);
      expect(stored).toMatchObject({
        id: requestId,
        status: 'PENDING',
        source: 'USER',
        reason: 'Não uso mais',
      });
      expect((await userRow(user.id)).status).toBe('INACTIVE');
      expect(await t.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
      // A conta inativa não recebe push: o token sai junto.
      expect(await devicesOf(user.id)).toEqual([]);
      const login = await signIn(user.email).expect(403);
      expect(login.body.error.code).toBe('ACCOUNT_INACTIVE');
      await t
        .http()
        .get('/v1/me')
        .set(...bearer(user))
        .expect(401);

      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'user.deletion_request')));
      expect(log?.diff).toMatchObject({
        requestId,
        channel: 'APP',
        from: 'ACTIVE',
        devicesRemoved: 1,
      });

      const mail = await t.mailer.lastTo(user.email);
      expect(mail.subject).toBe('Recebemos o seu pedido de exclusão de conta');
      expect(mail.text).toContain('15 dias');
      expect(mail.text).toContain('atendimento');
    });

    it('senha errada: 403 INVALID_PASSWORD e nada muda', async () => {
      const user = await signUp(t, 'senha-errada@exemplo.com');
      const res = await request(user, { password: 'outra-senha-123' }).expect(403);
      expect(res.body.error.code).toBe('INVALID_PASSWORD');
      expect((await userRow(user.id)).status).toBe('ACTIVE');
      expect(await requestsOf(user.id)).toEqual([]);
    });

    it('sem a senha, só com a sessão recente (até 10 min)', async () => {
      const fresh = await signUp(t, 'sessao-recente@exemplo.com');
      // Corpo vazio também vale (o motivo é opcional).
      await request(fresh).expect(201);
      expect((await userRow(fresh.id)).status).toBe('INACTIVE');

      const stale = await signUp(t, 'sessao-antiga@exemplo.com');
      await t.db
        .update(sessions)
        .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(sessions.userId, stale.id));
      const res = await request(stale, {}).expect(403);
      expect(res.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
      expect((await userRow(stale.id)).status).toBe('ACTIVE');
      // Com a senha, a sessão antiga basta.
      await request(stale, { password: PASSWORD }).expect(201);
    });

    it('pedido pendente duplicado: 409 DELETION_REQUEST_PENDING', async () => {
      const user = await signUp(t, 'duplicado@exemplo.com');
      // Pedido registrado pela equipe (por e-mail), com a conta ainda ativa.
      await t.db.insert(accountDeletionRequests).values({ userId: user.id, source: 'SUPER' });
      const res = await request(user, { password: PASSWORD }).expect(409);
      expect(res.body.error.code).toBe('DELETION_REQUEST_PENDING');
      expect((await userRow(user.id)).status).toBe('ACTIVE');
      expect(await requestsOf(user.id)).toHaveLength(1);
    });

    it('o único Dono e a conta Super não pedem (como na inativação)', async () => {
      const space = await createSpace(t.db, 'arena-exclusao-dono');
      const owner = await member(t, 'dono-exclui@exemplo.com', space.id, 'OWNER');
      const last = await request(owner, { password: PASSWORD }).expect(409);
      expect(last.body.error.code).toBe('LAST_OWNER');
      expect((await userRow(owner.id)).status).toBe('ACTIVE');

      const admin = await signUp(t, 'super-exclui@exemplo.com');
      await makeSuper(t.db, admin.id);
      const sup = await request(admin, { password: PASSWORD }).expect(409);
      expect(sup.body.error.code).toBe('SUPER_ACCOUNT');
      expect(await requestsOf(admin.id)).toEqual([]);
    });

    it('exige login e valida o corpo', async () => {
      await t.http().post('/v1/me/deletion-request').send({}).expect(401);
      const user = await signUp(t, 'corpo@exemplo.com');
      await request(user, { password: PASSWORD, extra: true }).expect(400);
      await request(user, { reason: 'x'.repeat(501) }).expect(400);
    });
  });

  describe('pela página web pública', () => {
    it('e-mail e senha certos: registra o pedido, inativa e manda o prazo', async () => {
      const user = await signUp(t, 'web-exclui@exemplo.com', 'Web');
      await addDevice(user.id, 'ExponentPushToken[web-1]');
      await addDevice(user.id, 'ExponentPushToken[web-2]');
      const res = await publicRequest({
        email: 'Web-Exclui@Exemplo.com',
        password: PASSWORD,
        reason: 'Pela página',
      }).expect(202);
      expect(res.body).toEqual({ message: PUBLIC_DELETION_MESSAGE });

      const [stored] = await requestsOf(user.id);
      expect(stored).toMatchObject({ status: 'PENDING', source: 'USER', reason: 'Pela página' });
      expect((await userRow(user.id)).status).toBe('INACTIVE');
      expect(await t.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
      expect(await devicesOf(user.id)).toEqual([]);
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'user.deletion_request')));
      expect(log?.diff).toMatchObject({ channel: 'WEB', devicesRemoved: 2 });
      expect((await t.mailer.lastTo(user.email)).subject).toBe(
        'Recebemos o seu pedido de exclusão de conta',
      );
    });

    it('e-mail inexistente ou senha errada: a mesma resposta, sem pedido nem e-mail', async () => {
      const user = await signUp(t, 'web-senha@exemplo.com');
      const before = mailsTo(user.email).length;
      const wrong = await publicRequest({ email: user.email, password: 'errada-123' }).expect(202);
      const unknown = await publicRequest({
        email: 'ninguem@exemplo.com',
        password: PASSWORD,
      }).expect(202);
      expect(wrong.body).toEqual({ message: PUBLIC_DELETION_MESSAGE });
      expect(unknown.body).toEqual(wrong.body);
      await settle();
      expect(await requestsOf(user.id)).toEqual([]);
      expect((await userRow(user.id)).status).toBe('ACTIVE');
      expect(mailsTo(user.email)).toHaveLength(before);
      expect(mailsTo('ninguem@exemplo.com')).toEqual([]);
    });

    it('vale para a conta já inativada pelo app (que não entra mais)', async () => {
      const user = await signUp(t, 'web-inativa@exemplo.com');
      await t
        .http()
        .post('/v1/me/deactivate')
        .set(...bearer(user))
        .expect(204);
      await publicRequest({ email: user.email, password: PASSWORD }).expect(202);
      const [stored] = await requestsOf(user.id);
      expect(stored?.status).toBe('PENDING');
      expect((await userRow(user.id)).status).toBe('INACTIVE');
    });

    it('pedido recusado pelas regras: resposta genérica e o motivo só por e-mail', async () => {
      const user = await signUp(t, 'web-pendente@exemplo.com');
      await publicRequest({ email: user.email, password: PASSWORD }).expect(202);
      const again = await publicRequest({ email: user.email, password: PASSWORD }).expect(202);
      expect(again.body).toEqual({ message: PUBLIC_DELETION_MESSAGE });
      expect(await requestsOf(user.id)).toHaveLength(1);
      const mail = await t.mailer.lastTo(user.email);
      expect(mail.subject).toBe('Não foi possível registrar o seu pedido de exclusão');
      expect(mail.text).toContain('em análise');

      const space = await createSpace(t.db, 'arena-exclusao-web');
      const owner = await member(t, 'web-dono@exemplo.com', space.id, 'OWNER');
      await publicRequest({ email: owner.email, password: PASSWORD }).expect(202);
      expect(await requestsOf(owner.id)).toEqual([]);
      expect((await userRow(owner.id)).status).toBe('ACTIVE');
      expect((await t.mailer.lastTo(owner.email)).text).toContain('único Dono');
    });

    it('valida o corpo (400) sem sessão', async () => {
      await publicRequest({ email: 'invalido', password: PASSWORD }).expect(400);
      await publicRequest({ email: 'a@exemplo.com' }).expect(400);
    });
  });
});
