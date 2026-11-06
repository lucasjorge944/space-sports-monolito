import type { SpaceRole } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, spaceMembers, staffInvites, users } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  type Catalog,
  createSpace,
  member,
  seedCatalog,
  setSpaceStatus,
} from '../spaces/fixtures.js';

// Equipe do espaço: convites, papéis múltiplos, restrições do Admin e do último Dono
// (RN-AUTH-01/03/04, RF-NOTIF-02).

type Space = Awaited<ReturnType<typeof createSpace>>;

describe('equipe do espaço', () => {
  let t: TestApp;
  let catalog: Catalog;
  let space: Space;
  let otherSpace: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let player: SignedUp;
  let otherOwner: SignedUp;
  let counter = 0;

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    space = await createSpace(t.db, catalog, { name: 'Arena Equipe' });
    otherSpace = await createSpace(t.db, catalog, { name: 'Arena Vizinha' });
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
    player = await signUpVerified(t, 'jogador@exemplo.com');
    otherOwner = await member(t, 'dono-vizinho@exemplo.com', otherSpace.id, 'OWNER');
  });
  afterAll(() => t.close());

  /** Conta nova com o e-mail já verificado (o aceite do convite exige). */
  async function signUpVerified(app: TestApp, email: string, name?: string): Promise<SignedUp> {
    const user = await signUp(app, email, name);
    await app.db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
    return user;
  }

  /** Recua o último envio do convite para fora do intervalo mínimo de reenvio. */
  const expireResendCooldown = (inviteId: string) =>
    t.db
      .update(staffInvites)
      .set({ updatedAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(staffInvites.id, inviteId));

  const teamUrl = (spaceId = space.id) => `/v1/manage/spaces/${spaceId}/team`;
  const as = (user: SignedUp) => ({ cookie: user.cookie });

  const invite = (by: SignedUp, email: string, role: string, spaceId = space.id) =>
    t
      .http()
      .post(`${teamUrl(spaceId)}/invites`)
      .set(as(by))
      .send({ email, role });

  /** Token do link do último e-mail enviado ao endereço. */
  async function tokenSentTo(email: string): Promise<string> {
    const mail = await t.mailer.lastTo(email);
    const match = /\/convite\/([\w-]+)/.exec(mail.text);
    if (!match?.[1]) throw new Error(`E-mail sem link de convite: ${mail.text}`);
    return match[1];
  }

  const accept = (user: SignedUp, token: string) =>
    t.http().post(`/v1/staff-invites/${token}/accept`).set(as(user));

  const me = async (user: SignedUp) =>
    (await t.http().get('/v1/me').set(as(user)).expect(200)).body;

  /** Convida, cadastra a conta (se faltar) e aceita: devolve o usuário já na equipe. */
  async function join(role: SpaceRole, spaceId = space.id, existing?: SignedUp) {
    counter += 1;
    const email = existing?.email ?? `novo${counter}@exemplo.com`;
    const owner_ = spaceId === space.id ? owner : otherOwner;
    await invite(owner_, email, role, spaceId).expect(201);
    // Antes do cadastro: o e-mail de verificação da conta seria o último da caixa.
    const token = await tokenSentTo(email);
    const user = existing ?? (await signUpVerified(t, email));
    await accept(user, token).expect(200);
    return user;
  }

  const members = async (by = owner, spaceId = space.id) =>
    (await t.http().get(teamUrl(spaceId)).set(as(by)).expect(200)).body;

  describe('permissões da rota', () => {
    it('só Dono e Admin gerem a equipe; Professor e jogador levam 403', async () => {
      for (const user of [owner, admin]) {
        await t.http().get(teamUrl()).set(as(user)).expect(200);
      }
      for (const user of [teacher, player, otherOwner]) {
        const res = await t.http().get(teamUrl()).set(as(user)).expect(403);
        expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
        await invite(user, 'x@exemplo.com', 'TEACHER').expect(403);
      }
      await t.http().get(teamUrl()).expect(401);
    });

    it('lista a equipe com papéis e e-mails', async () => {
      const team = await members();
      expect(team.members.map((m: { email: string }) => m.email)).toEqual(
        expect.arrayContaining(['dono@exemplo.com', 'admin@exemplo.com']),
      );
      const ownerEntry = team.members.find(
        (m: { email: string }) => m.email === 'dono@exemplo.com',
      );
      expect(ownerEntry.roles).toEqual(['OWNER']);
    });
  });

  describe('convite, aceite e revogação (RF-NOTIF-02)', () => {
    it('convida quem ainda não tem conta: e-mail com link, prévia pública, cadastro e aceite', async () => {
      const res = await invite(admin, 'Maria@Exemplo.com ', 'ADMIN');
      // e-mail com espaço no fim não é um e-mail válido
      expect(res.status).toBe(400);

      const created = await invite(admin, 'Maria@Exemplo.com', 'ADMIN').expect(201);
      expect(created.body).toMatchObject({
        email: 'maria@exemplo.com',
        role: 'ADMIN',
        status: 'PENDING',
        invitedBy: { id: admin.id },
      });
      const mail = await t.mailer.lastTo('maria@exemplo.com');
      expect(mail.subject).toContain('Arena Equipe');
      expect(mail.text).toContain('Administrador');
      expect(mail.text).toContain('http://localhost:3000/convite/');

      const token = await tokenSentTo('maria@exemplo.com');
      // O token não fica no banco, só o hash.
      const stored = await t.db
        .select()
        .from(staffInvites)
        .where(eq(staffInvites.id, created.body.id));
      expect(JSON.stringify(stored)).not.toContain(token);

      const preview = await t.http().get(`/v1/staff-invites/${token}`).expect(200);
      expect(preview.body).toMatchObject({
        email: 'maria@exemplo.com',
        role: 'ADMIN',
        hasAccount: false,
        space: { id: space.id, name: 'Arena Equipe' },
      });

      // Antes do aceite, nada de acesso.
      const maria = await signUpVerified(t, 'maria@exemplo.com', 'Maria');
      expect((await me(maria)).access.management).toBe(false);
      expect((await t.http().get(`/v1/staff-invites/${token}`).expect(200)).body.hasAccount).toBe(
        true,
      );

      const accepted = await accept(maria, token).expect(200);
      expect(accepted.body).toMatchObject({ space: { id: space.id }, roles: ['ADMIN'] });

      // GET /v1/me reflete o vínculo (RN-AUTH-01/04).
      const profile = await me(maria);
      expect(profile.access.management).toBe(true);
      expect(profile.memberships).toEqual([
        expect.objectContaining({
          space: expect.objectContaining({ id: space.id }),
          roles: ['ADMIN'],
        }),
      ]);
      // E o painel do espaço passa a responder para ela.
      await t.http().get(`/v1/manage/spaces/${space.id}`).set(as(maria)).expect(200);

      const team = await members();
      expect(team.invites).toEqual([]);
      expect(team.members).toContainEqual(
        expect.objectContaining({ userId: maria.id, roles: ['ADMIN'] }),
      );

      // Idempotente para quem já aceitou; outro usuário não reaproveita o link.
      await accept(maria, token).expect(200);
      const outsider = await signUpVerified(t, 'curioso@exemplo.com');
      const reuse = await accept(outsider, token).expect(409);
      expect(reuse.body.error.code).toBe('STAFF_INVITE_UNAVAILABLE');
      await t.http().get(`/v1/staff-invites/${token}`).expect(409);
    });

    it('aceita com a conta que já existia (login) e e-mail em caixa diferente', async () => {
      const existing = await signUpVerified(t, 'Carlos@Exemplo.com', 'Carlos');
      expect(existing.email).toBe('carlos@exemplo.com');
      await invite(owner, 'CARLOS@exemplo.com', 'TEACHER').expect(201);
      const token = await tokenSentTo('carlos@exemplo.com');
      expect((await t.http().get(`/v1/staff-invites/${token}`).expect(200)).body.hasAccount).toBe(
        true,
      );
      await accept(existing, token).expect(200);
      expect((await me(existing)).memberships[0].roles).toEqual(['TEACHER']);
    });

    it('conta com outro e-mail não aceita o convite, que continua válido', async () => {
      await invite(owner, 'convidada@exemplo.com', 'ADMIN').expect(201);
      const token = await tokenSentTo('convidada@exemplo.com');
      const wrong = await accept(player, token).expect(403);
      expect(wrong.body.error.code).toBe('STAFF_INVITE_EMAIL_MISMATCH');
      expect(wrong.body.error.message).toContain('outro e-mail');
      expect((await me(player)).access.management).toBe(false);

      const right = await signUpVerified(t, 'convidada@exemplo.com');
      await accept(right, token).expect(200);
    });

    it('cadastro novo com outro e-mail é recusado pelo e-mail, antes da verificação', async () => {
      await invite(owner, 'certa@exemplo.com', 'ADMIN').expect(201);
      const token = await tokenSentTo('certa@exemplo.com');
      const preview = await t.http().get(`/v1/staff-invites/${token}`).expect(200);
      expect(preview.body.email).toBe('certa@exemplo.com');

      // Conta nova, com o e-mail ainda sem verificar: o motivo é o e-mail diferente.
      const fresh = await signUp(t, 'outra@exemplo.com');
      const wrong = await accept(fresh, token).expect(403);
      expect(wrong.body.error.code).toBe('STAFF_INVITE_EMAIL_MISMATCH');
      // Verificar o e-mail errado não muda a resposta.
      await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, fresh.id));
      expect((await accept(fresh, token).expect(403)).body.error.code).toBe(
        'STAFF_INVITE_EMAIL_MISMATCH',
      );
      expect((await me(fresh)).access.management).toBe(false);
      await t.http().get(`/v1/staff-invites/${token}`).expect(200);
    });

    it('conta só com telefone (sem e-mail) também é recusada', async () => {
      await invite(owner, 'sem-email@exemplo.com', 'TEACHER').expect(201);
      const token = await tokenSentTo('sem-email@exemplo.com');
      const phoneOnly = await signUp(t, 'temporario@exemplo.com');
      await t.db
        .update(users)
        .set({ email: null, emailVerified: false, phone: '+5531977776666', phoneVerified: true })
        .where(eq(users.id, phoneOnly.id));

      const wrong = await accept(phoneOnly, token).expect(403);
      expect(wrong.body.error.code).toBe('STAFF_INVITE_EMAIL_MISMATCH');
    });

    it('cadastro novo com o e-mail convidado aceita sem diferenciar maiúsculas', async () => {
      await invite(owner, 'Nova.Pessoa@Exemplo.com', 'TEACHER').expect(201);
      const token = await tokenSentTo('nova.pessoa@exemplo.com');
      const fresh = await signUpVerified(t, 'NOVA.pessoa@EXEMPLO.com');
      await accept(fresh, token).expect(200);
      expect((await me(fresh)).memberships[0].roles).toEqual(['TEACHER']);
    });

    it('sem sessão não aceita; token inventado é 404', async () => {
      await t.http().post('/v1/staff-invites/qualquer/accept').expect(401);
      const res = await t.http().get('/v1/staff-invites/token-que-nao-existe').expect(404);
      expect(res.body.error.code).toBe('STAFF_INVITE_NOT_FOUND');
      await accept(player, 'token-que-nao-existe').expect(404);
    });

    it('revogar invalida o link; revogar de novo e aceitar depois falham', async () => {
      const created = await invite(owner, 'revogado@exemplo.com', 'TEACHER').expect(201);
      const token = await tokenSentTo('revogado@exemplo.com');
      const guest = await signUpVerified(t, 'revogado@exemplo.com');

      await t.http().delete(`${teamUrl()}/invites/${created.body.id}`).set(as(admin)).expect(204);
      expect((await members()).invites.map((i: { id: string }) => i.id)).not.toContain(
        created.body.id,
      );
      expect((await t.http().get(`/v1/staff-invites/${token}`).expect(409)).body.error.code).toBe(
        'STAFF_INVITE_UNAVAILABLE',
      );
      await accept(guest, token).expect(409);
      expect((await me(guest)).access.management).toBe(false);
      await t.http().delete(`${teamUrl()}/invites/${created.body.id}`).set(as(owner)).expect(409);

      // Depois de revogado, dá para convidar de novo.
      await invite(owner, 'revogado@exemplo.com', 'TEACHER').expect(201);
    });

    it('reenviar gera link novo e invalida o anterior', async () => {
      const created = await invite(owner, 'reenvio@exemplo.com', 'ADMIN').expect(201);
      const first = await tokenSentTo('reenvio@exemplo.com');
      const sentBefore = t.mailer.sent.length;
      await expireResendCooldown(created.body.id);

      const resent = await t
        .http()
        .post(`${teamUrl()}/invites/${created.body.id}/resend`)
        .set(as(admin))
        .expect(200);
      expect(resent.body.id).toBe(created.body.id);
      expect(t.mailer.sent.length).toBe(sentBefore + 1);

      const second = await tokenSentTo('reenvio@exemplo.com');
      expect(second).not.toBe(first);
      await t.http().get(`/v1/staff-invites/${first}`).expect(404);
      await t.http().get(`/v1/staff-invites/${second}`).expect(200);
    });

    it('limita o reenvio: dentro do intervalo mínimo é 429 e nada é enviado nem muda', async () => {
      const created = await invite(owner, 'pressa@exemplo.com', 'ADMIN').expect(201);
      const token = await tokenSentTo('pressa@exemplo.com');
      const sentBefore = t.mailer.sent.length;
      const resend = () =>
        t.http().post(`${teamUrl()}/invites/${created.body.id}/resend`).set(as(owner));

      // Logo após criar (o envio de criação conta).
      const early = await resend().expect(429);
      expect(early.body.error.code).toBe('STAFF_INVITE_RESEND_TOO_SOON');
      expect(early.body.error.details.retryAfterSec).toBeGreaterThan(0);
      expect(t.mailer.sent.length).toBe(sentBefore);
      await t.http().get(`/v1/staff-invites/${token}`).expect(200); // o link segue valendo

      await expireResendCooldown(created.body.id);
      await resend().expect(200);
      expect(t.mailer.sent.length).toBe(sentBefore + 1);
      // O reenvio reinicia o intervalo.
      await resend().expect(429);
      expect(t.mailer.sent.length).toBe(sentBefore + 1);
    });

    it('o e-mail sai em segundo plano: SMTP travado ou com erro não segura nem derruba a requisição', async () => {
      const original = t.mailer.send;
      try {
        t.mailer.send = () => new Promise<void>(() => {}); // nunca responde
        const slow = await invite(owner, 'lento@exemplo.com', 'TEACHER').expect(201);

        t.mailer.send = () => Promise.reject(new Error('SMTP fora do ar'));
        await expireResendCooldown(slow.body.id);
        await t
          .http()
          .post(`${teamUrl()}/invites/${slow.body.id}/resend`)
          .set(as(owner))
          .expect(200);
        await invite(owner, 'falha@exemplo.com', 'TEACHER').expect(201);
      } finally {
        t.mailer.send = original;
      }
      // O convite existe e pode ser reenviado depois.
      const listed = (await members()).invites.map((i: { email: string }) => i.email);
      expect(listed).toEqual(expect.arrayContaining(['lento@exemplo.com', 'falha@exemplo.com']));
    });

    it('exige e-mail verificado para aceitar: 422 e o convite continua válido', async () => {
      await invite(owner, 'naoverificada@exemplo.com', 'ADMIN').expect(201);
      const token = await tokenSentTo('naoverificada@exemplo.com');
      // Quem cadastra o e-mail de outra pessoa não prova que é dono dele.
      const impostor = await signUp(t, 'naoverificada@exemplo.com');

      const denied = await accept(impostor, token).expect(422);
      expect(denied.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect((await me(impostor)).access.management).toBe(false);
      await t.http().get(`/v1/staff-invites/${token}`).expect(200);

      await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, impostor.id));
      await accept(impostor, token).expect(200);
      expect((await me(impostor)).memberships[0].roles).toEqual(['ADMIN']);
    });

    it('convite vencido: prévia/aceite dão 409 EXPIRED, a lista mostra EXPIRED e dá para reenviar', async () => {
      const created = await invite(owner, 'vencido@exemplo.com', 'TEACHER').expect(201);
      const token = await tokenSentTo('vencido@exemplo.com');
      await t.db
        .update(staffInvites)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(staffInvites.id, created.body.id));
      const guest = await signUpVerified(t, 'vencido@exemplo.com');

      expect((await t.http().get(`/v1/staff-invites/${token}`).expect(409)).body.error.code).toBe(
        'STAFF_INVITE_EXPIRED',
      );
      expect((await accept(guest, token).expect(409)).body.error.code).toBe('STAFF_INVITE_EXPIRED');
      const listed = (await members()).invites.find(
        (i: { id: string }) => i.id === created.body.id,
      );
      expect(listed.status).toBe('EXPIRED');

      await t
        .http()
        .post(`${teamUrl()}/invites/${created.body.id}/resend`)
        .set(as(owner))
        .expect(200);
      await accept(guest, await tokenSentTo('vencido@exemplo.com')).expect(200);
    });

    it('convidar de novo um convite vencido o substitui', async () => {
      const created = await invite(owner, 'vencido2@exemplo.com', 'TEACHER').expect(201);
      await t.db
        .update(staffInvites)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(staffInvites.id, created.body.id));
      const again = await invite(owner, 'vencido2@exemplo.com', 'TEACHER').expect(201);
      expect(again.body.id).not.toBe(created.body.id);
      const open = (await members()).invites.filter(
        (i: { email: string }) => i.email === 'vencido2@exemplo.com',
      );
      expect(open).toHaveLength(1);
    });

    it('rejeita convite duplicado em aberto e quem já tem o papel', async () => {
      await invite(owner, 'dup@exemplo.com', 'ADMIN').expect(201);
      const dup = await invite(admin, 'DUP@exemplo.com', 'ADMIN').expect(409);
      expect(dup.body.error.code).toBe('STAFF_INVITE_PENDING');
      // Outro papel para o mesmo e-mail é outro convite.
      await invite(owner, 'dup@exemplo.com', 'TEACHER').expect(201);

      const already = await invite(owner, 'professor@exemplo.com', 'TEACHER').expect(409);
      expect(already.body.error.code).toBe('ALREADY_TEAM_MEMBER');
    });

    it('o Dono não é convidável: papel inválido no corpo e validação do e-mail', async () => {
      await invite(owner, 'novodono@exemplo.com', 'OWNER').expect(400);
      await invite(owner, 'novodono@exemplo.com', 'JOGADOR').expect(400);
      await invite(owner, 'sem-arroba', 'ADMIN').expect(400);
    });

    it('convite de outro espaço não aparece nem é mexido por esta equipe (multi-tenant)', async () => {
      const created = await invite(
        otherOwner,
        'vizinho@exemplo.com',
        'ADMIN',
        otherSpace.id,
      ).expect(201);
      expect((await members()).invites.map((i: { id: string }) => i.id)).not.toContain(
        created.body.id,
      );
      await t.http().delete(`${teamUrl()}/invites/${created.body.id}`).set(as(owner)).expect(404);
      await t
        .http()
        .post(`${teamUrl()}/invites/${created.body.id}/resend`)
        .set(as(owner))
        .expect(404);
      await t.http().delete(`${teamUrl()}/invites/nao-e-uuid`).set(as(owner)).expect(404);
      // Dono do outro espaço não mexe neste.
      await t
        .http()
        .delete(`${teamUrl()}/invites/${created.body.id}`)
        .set(as(otherOwner))
        .expect(403);
    });

    it('registra convite, aceite e revogação na auditoria', async () => {
      const actions = await t.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.spaceId, space.id));
      const names = new Set(actions.map((a) => a.action));
      for (const action of ['team.invite_create', 'team.invite_accept', 'team.invite_revoke']) {
        expect(names).toContain(action);
      }
    });

    it('a auditoria guarda o e-mail do convidado mascarado, nunca em texto', async () => {
      const rows = await t.db
        .select({ action: auditLogs.action, diff: auditLogs.diff })
        .from(auditLogs)
        .where(eq(auditLogs.spaceId, space.id));
      const invites = rows.filter((row) => row.action.startsWith('team.invite_'));
      expect(invites.length).toBeGreaterThan(0);
      for (const { diff } of invites) {
        expect(JSON.stringify(diff)).not.toMatch(/[a-z0-9.]{2,}@exemplo\.com/);
      }
      expect(invites.find((row) => row.action === 'team.invite_create')?.diff?.email).toMatch(
        /^.\*\*\*@exemplo\.com$/,
      );
    });
  });

  describe('papéis múltiplos e por espaço (RN-AUTH-03)', () => {
    it('a mesma pessoa acumula papéis no espaço e tem papéis diferentes em outro', async () => {
      const ana = await join('TEACHER');
      await join('TEACHER', otherSpace.id, ana);
      await join('ADMIN', otherSpace.id, ana);

      const profile = await me(ana);
      expect(profile.memberships).toHaveLength(2);
      const here = profile.memberships.find(
        (m: { space: { id: string } }) => m.space.id === space.id,
      );
      const there = profile.memberships.find(
        (m: { space: { id: string } }) => m.space.id === otherSpace.id,
      );
      expect(here.roles).toEqual(['TEACHER']);
      expect(there.roles.sort()).toEqual(['ADMIN', 'TEACHER']);

      // O papel vale só no espaço em que foi dado.
      await t
        .http()
        .post(`${teamUrl(otherSpace.id)}/invites`)
        .set(as(ana))
        .send({ email: 'x@exemplo.com', role: 'TEACHER' })
        .expect(201);
      await t
        .http()
        .post(`${teamUrl()}/invites`)
        .set(as(ana))
        .send({ email: 'y@exemplo.com', role: 'TEACHER' })
        .expect(403);
    });

    it('altera os papéis (substitui o conjunto) e o acesso muda na hora', async () => {
      const bia = await join('TEACHER');
      await t.http().get(teamUrl()).set(as(bia)).expect(403);

      const upgraded = await t
        .http()
        .put(`${teamUrl()}/members/${bia.id}/roles`)
        .set(as(owner))
        .send({ roles: ['TEACHER', 'ADMIN'] })
        .expect(200);
      expect(upgraded.body.roles).toEqual(['ADMIN', 'TEACHER']);
      await t.http().get(teamUrl()).set(as(bia)).expect(200);

      const downgraded = await t
        .http()
        .put(`${teamUrl()}/members/${bia.id}/roles`)
        .set(as(admin))
        .send({ roles: ['TEACHER'] })
        .expect(200);
      expect(downgraded.body.roles).toEqual(['TEACHER']);
      await t.http().get(teamUrl()).set(as(bia)).expect(403);
      expect((await me(bia)).memberships[0].roles).toEqual(['TEACHER']);

      // Papel retirado e devolvido reativa o vínculo (sem duplicar linha).
      await t
        .http()
        .put(`${teamUrl()}/members/${bia.id}/roles`)
        .set(as(owner))
        .send({ roles: ['ADMIN', 'TEACHER'] })
        .expect(200);
      const rows = await t.db
        .select()
        .from(spaceMembers)
        .where(and(eq(spaceMembers.userId, bia.id), eq(spaceMembers.spaceId, space.id)));
      // Uma linha por papel: o ADMIN retirado foi reativado, não duplicado.
      expect(rows.map((r) => [r.role, r.status]).sort()).toEqual([
        ['ADMIN', 'ACTIVE'],
        ['TEACHER', 'ACTIVE'],
      ]);
    });

    it('valida o corpo e o alvo da troca de papéis', async () => {
      const put = (userId: string, body: object, by = owner) =>
        t.http().put(`${teamUrl()}/members/${userId}/roles`).set(as(by)).send(body);
      await put(teacher.id, { roles: [] }).expect(400);
      await put(teacher.id, { roles: ['TEACHER', 'TEACHER'] }).expect(400);
      await put(teacher.id, { roles: ['JOGADOR'] }).expect(400);
      // Quem não é da equipe (ou é de outro espaço) não existe aqui.
      const missing = await put(player.id, { roles: ['TEACHER'] }).expect(404);
      expect(missing.body.error.code).toBe('MEMBER_NOT_FOUND');
      await put(otherOwner.id, { roles: ['TEACHER'] }).expect(404);
      await put('nao-e-uuid', { roles: ['TEACHER'] }).expect(404);
    });
  });

  describe('restrições do Admin ("exceto Dono")', () => {
    it('Admin não altera, remove nem convida o Dono, e não concede o papel de Dono', async () => {
      const change = await t
        .http()
        .put(`${teamUrl()}/members/${owner.id}/roles`)
        .set(as(admin))
        .send({ roles: ['ADMIN'] })
        .expect(403);
      expect(change.body.error.code).toBe('OWNER_PROTECTED');

      const remove = await t
        .http()
        .delete(`${teamUrl()}/members/${owner.id}`)
        .set(as(admin))
        .expect(403);
      expect(remove.body.error.code).toBe('OWNER_PROTECTED');

      // Convidar quem é Dono para outro papel também é mexer no vínculo dele.
      const inviteOwner = await invite(admin, 'dono@exemplo.com', 'TEACHER').expect(403);
      expect(inviteOwner.body.error.code).toBe('OWNER_PROTECTED');

      const grant = await t
        .http()
        .put(`${teamUrl()}/members/${teacher.id}/roles`)
        .set(as(admin))
        .send({ roles: ['TEACHER', 'OWNER'] })
        .expect(403);
      expect(grant.body.error.code).toBe('OWNER_ROLE_RESTRICTED');

      // Dono com papel extra continua protegido.
      const dual = await join('ADMIN', space.id, await signUpVerified(t, 'dono-duplo@exemplo.com'));
      await t.db.insert(spaceMembers).values({
        userId: dual.id,
        spaceId: space.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      await t.http().delete(`${teamUrl()}/members/${dual.id}`).set(as(admin)).expect(403);
      await t.http().delete(`${teamUrl()}/members/${dual.id}`).set(as(owner)).expect(204);
    });

    it('o Dono também não concede o papel de Dono (só a plataforma)', async () => {
      const res = await t
        .http()
        .put(`${teamUrl()}/members/${admin.id}/roles`)
        .set(as(owner))
        .send({ roles: ['ADMIN', 'OWNER'] })
        .expect(403);
      expect(res.body.error.code).toBe('OWNER_ROLE_RESTRICTED');
    });

    it('Admin gerencia Admin e Professor, como a matriz permite', async () => {
      const other = await join('ADMIN');
      await invite(admin, 'novo-admin@exemplo.com', 'ADMIN').expect(201);
      await t
        .http()
        .put(`${teamUrl()}/members/${other.id}/roles`)
        .set(as(admin))
        .send({ roles: ['TEACHER'] })
        .expect(200);
      await t.http().delete(`${teamUrl()}/members/${other.id}`).set(as(admin)).expect(204);
    });
  });

  describe('último Dono (RN-AUTH-01)', () => {
    it('o único Dono não pode ser removido nem perder o papel', async () => {
      const remove = await t
        .http()
        .delete(`${teamUrl(otherSpace.id)}/members/${otherOwner.id}`)
        .set(as(otherOwner))
        .expect(409);
      expect(remove.body.error.code).toBe('LAST_OWNER');

      const drop = await t
        .http()
        .put(`${teamUrl(otherSpace.id)}/members/${otherOwner.id}/roles`)
        .set(as(otherOwner))
        .send({ roles: ['ADMIN'] })
        .expect(409);
      expect(drop.body.error.code).toBe('LAST_OWNER');

      // Papéis extras podem ser mexidos desde que o OWNER fique.
      await t
        .http()
        .put(`${teamUrl(otherSpace.id)}/members/${otherOwner.id}/roles`)
        .set(as(otherOwner))
        .send({ roles: ['OWNER', 'ADMIN'] })
        .expect(200);
      await t.http().get(teamUrl(otherSpace.id)).set(as(otherOwner)).expect(200);
    });

    it('com dois Donos, um sai; o que sobra vira o último', async () => {
      const second = await signUpVerified(t, 'segundo-dono@exemplo.com');
      await t.db.insert(spaceMembers).values({
        userId: second.id,
        spaceId: otherSpace.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      await t
        .http()
        .delete(`${teamUrl(otherSpace.id)}/members/${second.id}`)
        .set(as(otherOwner))
        .expect(204);
      await t
        .http()
        .delete(`${teamUrl(otherSpace.id)}/members/${otherOwner.id}`)
        .set(as(otherOwner))
        .expect(409);
      // O Dono removido perdeu o acesso.
      await t.http().get(teamUrl(otherSpace.id)).set(as(second)).expect(403);
    });

    it('dois Donos se removendo ao mesmo tempo: um deles sempre fica', async () => {
      const spaceC = await createSpace(t.db, catalog, { name: 'Arena Corrida' });
      const a = await member(t, 'dono-a@exemplo.com', spaceC.id, 'OWNER');
      const b = await member(t, 'dono-b@exemplo.com', spaceC.id, 'OWNER');
      const results = await Promise.all([
        t
          .http()
          .delete(`${teamUrl(spaceC.id)}/members/${b.id}`)
          .set(as(a)),
        t
          .http()
          .delete(`${teamUrl(spaceC.id)}/members/${a.id}`)
          .set(as(b)),
      ]);
      // O perdedor da corrida pode levar 204 (se rodou primeiro) e o outro 403/409.
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 204)).toHaveLength(1);
      const owners = await t.db
        .select()
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.spaceId, spaceC.id),
            eq(spaceMembers.role, 'OWNER'),
            eq(spaceMembers.status, 'ACTIVE'),
          ),
        );
      expect(owners).toHaveLength(1);
    });
  });

  describe('remoção e fim do acesso (RN-AUTH-01)', () => {
    it('removido perde o acesso na hora, com a mesma sessão, e some do /me', async () => {
      const dani = await join('ADMIN');
      await t.http().get(`/v1/manage/spaces/${space.id}`).set(as(dani)).expect(200);
      expect((await me(dani)).access.management).toBe(true);

      await t.http().delete(`${teamUrl()}/members/${dani.id}`).set(as(admin)).expect(204);

      const denied = await t.http().get(`/v1/manage/spaces/${space.id}`).set(as(dani)).expect(403);
      expect(denied.body.error.code).toBe('SPACE_FORBIDDEN');
      const profile = await me(dani);
      expect(profile.memberships).toEqual([]);
      expect(profile.access.management).toBe(false);
      expect((await members()).members.map((m: { userId: string }) => m.userId)).not.toContain(
        dani.id,
      );

      // Já removido: não existe mais na equipe.
      await t.http().delete(`${teamUrl()}/members/${dani.id}`).set(as(owner)).expect(404);

      // Pode ser convidado de novo e volta com o vínculo reativado.
      await join('TEACHER', space.id, dani);
      expect((await me(dani)).memberships[0].roles).toEqual(['TEACHER']);
    });

    it('remover num espaço não afeta o vínculo da pessoa em outro', async () => {
      const edu = await join('TEACHER');
      await join('ADMIN', otherSpace.id, edu);
      await t.http().delete(`${teamUrl()}/members/${edu.id}`).set(as(owner)).expect(204);
      const profile = await me(edu);
      expect(profile.memberships).toHaveLength(1);
      expect(profile.memberships[0].space.id).toBe(otherSpace.id);
    });

    it('quem sai da equipe sem ser convidado de novo não aceita o link antigo', async () => {
      // O convite aceito não ressuscita o vínculo.
      await invite(owner, 'fabio@exemplo.com', 'TEACHER').expect(201);
      const oldToken = await tokenSentTo('fabio@exemplo.com');
      const fabio = await signUpVerified(t, 'fabio@exemplo.com');
      await accept(fabio, oldToken).expect(200);
      await t.http().delete(`${teamUrl()}/members/${fabio.id}`).set(as(owner)).expect(204);
      await accept(fabio, oldToken).expect(409);
      expect((await me(fabio)).access.management).toBe(false);
    });
  });

  describe('espaço suspenso: equipe só leitura (RF-SUPER-03)', () => {
    it('escritas dão 403 SPACE_READ_ONLY e o aceite também; a listagem continua', async () => {
      const suspended = await createSpace(t.db, catalog, { name: 'Arena Suspensa' });
      const dono = await member(t, 'dono-suspenso@exemplo.com', suspended.id, 'OWNER');
      const colega = await member(t, 'colega-suspenso@exemplo.com', suspended.id, 'TEACHER');
      await invite(dono, 'antes@exemplo.com', 'TEACHER', suspended.id).expect(201);
      const token = await tokenSentTo('antes@exemplo.com');
      const guest = await signUpVerified(t, 'antes@exemplo.com');
      await setSpaceStatus(t.db, suspended.id, 'SUSPENDED');

      await t.http().get(teamUrl(suspended.id)).set(as(dono)).expect(200);
      for (const res of [
        await invite(dono, 'depois@exemplo.com', 'TEACHER', suspended.id),
        await t
          .http()
          .delete(`${teamUrl(suspended.id)}/members/${colega.id}`)
          .set(as(dono)),
        await t
          .http()
          .put(`${teamUrl(suspended.id)}/members/${colega.id}/roles`)
          .set(as(dono))
          .send({ roles: ['ADMIN'] }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SPACE_READ_ONLY');
      }
      const late = await accept(guest, token).expect(403);
      expect(late.body.error.code).toBe('SPACE_READ_ONLY');
    });
  });
});
