import { Logger } from '@nestjs/common';
import { addDays, utcToZoned } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  oauthConsents,
  onlineCharges,
  spaceMembers,
  spaceReviewReports,
  subscriptionCharges,
  users,
} from '../../src/db/schema/index.js';
import { makeSuper, type SignedUp, signUp, type TestApp, WEB_ORIGIN } from '../auth/helpers.js';
import { bearer, createSpace, type Space, slotIn } from '../bookings/fixtures.js';
import { insertGroup, insertSession } from '../classes/attendance-fixtures.js';
import { confirm, enroll, teacherMemberId } from '../classes/fixtures.js';
import { APPROVED_CPF, approveMerchant, setModes } from '../payments/fixtures.js';
import { insertReviewRow } from '../reviews/qa-fixtures.js';
import {
  ADMIN_RESOURCE,
  authorizeParams,
  authorizePath,
  bearerOf,
  CLIENT_ID,
  cimdDocument,
  connect,
  createMcpTestApp,
  decodeJwt,
  insertTestKey,
  MCP_RESOURCE,
  mintToken,
  oauthRoutes,
  pkce,
  refresh,
  type TestKey,
  type TokenResponse,
} from './helpers.js';

// Fase 2 do MCP (docs/14-mcp.md 8.1 a 8.3; decisões 53 e 120 a 123; RN-MCP-06 a 08): escopos de
// gestão e do Super, segundo recurso, lista permitida por audiência, visão sem contato e as
// proteções do Super.

const USER_SCOPES =
  'spaces:read bookings:read bookings:write classes:read classes:write manage:read manage:finance:read';
const PLAYER_SCOPES = 'spaces:read bookings:read bookings:write classes:read classes:write';
const OTHER_CLIENT = 'https://outro-assistente.example.com/client.json';

/** Camada de métricas (MCP2.2, docs/14-mcp.md 8.4). */
const METRICS = ['bookings', 'occupancy', 'classes', 'customers', 'revenue', 'platform', 'spaces'];
/** Datas locais de uma semana atrás a uma semana à frente. */
const analyticsPeriod = () => {
  const today = utcToZoned(new Date(), 'America/Sao_Paulo').date;
  return { from: addDays(today, -7), to: addDays(today, 7) };
};

/** Telefone diferente para cada pessoa: a varredura procura cada um nas respostas. */
const PEOPLE = {
  dono: { email: 'dono.gestao@exemplo.com', name: 'Dona Gestão', phone: '+5531911110001' },
  admin: { email: 'admin.gestao@exemplo.com', name: 'Admin Gestão', phone: '+5531911110002' },
  prof: { email: 'prof.gestao@exemplo.com', name: 'Professor Gestão', phone: '+5531911110003' },
  jogador: { email: 'jogador.gestao@exemplo.com', name: 'Jogador Gestão', phone: '+5531911110004' },
  sup: { email: 'super.gestao@exemplo.com', name: 'Super Gestão', phone: '+5531911110006' },
};
const GUEST_PHONE = '+5531977776666';
const INVITE_EMAIL = 'convite.gestao@exemplo.com';
const NOTE_EMAIL = 'nota.pagamento@exemplo.com';
const REVIEW_EMAIL = 'vizinho.da.quadra@exemplo.com';
/** Dados do cadastro no gateway (`merchantBody` dos testes de pagamento). */
const MERCHANT_VALUES = [APPROVED_CPF, 'fulano@example.com', '+5531999990000', '30110000'];

/**
 * Chaves que nunca saem pelo MCP na gestão e no Super (decisão 122): contato, documento, endereço,
 * nascimento, foto, tokens, convites, cartão e dados bancários, além do `diff` da auditoria e das
 * observações livres.
 */
const FORBIDDEN_KEY =
  /email|phone|whatsapp|document|cpf|cnpj|birth|street|postal|^location$|^lat$|^lng$|token|invite|bank|agency|^account$|accountDigit|legalName|card|avatar|^diff$|^note$|^payout$|destination/i;

/** Padrões de contato nos valores (e-mail e telefone brasileiro, com ou sem máscara). */
const CONTACT_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\+55\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/,
  /\(\d{2}\)\s?9?\d{4}-?\d{4}/,
  /\b\d{2}\s9\d{4}-\d{4}\b/,
];

/** Caminhos de chaves proibidas, valores sensíveis e padrões de contato encontrados na resposta. */
function leaksIn(body: unknown, sensitive: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      for (const pattern of CONTACT_PATTERNS) {
        if (pattern.test(value)) found.push(`${path} parece contato`);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_KEY.test(key)) found.push(`${path}.${key}`);
        walk(item, `${path}.${key}`);
      }
    }
  };
  walk(body, '$');
  const text = JSON.stringify(body);
  for (const value of sensitive) if (text.includes(value)) found.push(`valor ${value}`);
  return found;
}

describe('MCP fase 2: gestão e Super em leitura', () => {
  let t: TestApp;
  let spaceA: Space;
  let spaceB: Space;
  let dono: SignedUp;
  let admin: SignedUp;
  let prof: SignedUp;
  let jogador: SignedUp;
  let sup: SignedUp;
  let key: TestKey;
  let ids: Record<string, string>;
  let reviewIds: { personal: string; hidden: string };

  const person = async (who: keyof typeof PEOPLE) => {
    const { email, name, phone } = PEOPLE[who];
    return signUp(t, email, name, phone);
  };
  const addRole = (user: SignedUp, spaceId: string, role: 'OWNER' | 'ADMIN' | 'TEACHER') =>
    t.db.insert(spaceMembers).values({ userId: user.id, spaceId, role, status: 'ACTIVE' });

  /** authorize com sessão até a tela de consentimento (ou o redirect direto ao cliente). */
  const authorize = async (user: SignedUp, overrides: Record<string, string | undefined>) => {
    const { verifier, challenge } = pkce();
    const res = await t
      .http()
      .get(authorizePath(authorizeParams(challenge, overrides)))
      .set('cookie', user.cookie);
    return { res, verifier, location: res.headers.location as string | undefined };
  };

  const consentRequest = (user: SignedUp, oauthQuery: string) =>
    t.http().get('/v1/oauth/consent-request').query({ oauthQuery }).set('cookie', user.cookie);

  const consent = (user: SignedUp, oauthQuery: string, body: Record<string, unknown>) =>
    t
      .http()
      .post('/v1/auth/oauth2/consent')
      .set('cookie', user.cookie)
      .set('origin', WEB_ORIGIN)
      .send({ ...body, oauth_query: oauthQuery });

  const connectAdmin = (user: SignedUp) =>
    connect(t, user, { resource: ADMIN_RESOURCE, scope: 'super:read' });

  const get = (token: string, path: string, query: Record<string, string> = {}) =>
    t
      .http()
      .get(path)
      .query(query)
      .set(...bearerOf(token));

  beforeAll(async () => {
    t = await createMcpTestApp({
      env: { MCP_ADMIN_RESOURCE_URL: ADMIN_RESOURCE, MCP_ADMIN_ALLOWED_CLIENT_IDS: CLIENT_ID },
      documents: {
        [CLIENT_ID]: cimdDocument(),
        [OTHER_CLIENT]: cimdDocument(OTHER_CLIENT, 'Outro'),
      },
    });
    spaceA = await createSpace(t.db, 'arena-gestao-a');
    spaceB = await createSpace(t.db, 'arena-gestao-b');
    dono = await person('dono');
    admin = await person('admin');
    prof = await person('prof');
    jogador = await person('jogador');
    sup = await person('sup');
    await makeSuper(t.db, sup.id);
    await addRole(dono, spaceA.id, 'OWNER');
    await addRole(admin, spaceA.id, 'ADMIN');
    await addRole(prof, spaceA.id, 'TEACHER');
    // A chave de teste entra depois da do Better Auth (que segue assinando os tokens do fluxo).
    await t.http().get('/v1/auth/jwks').expect(200);
    key = await insertTestKey(t);

    // Dados do espaço A com contato em todo canto: balcão com telefone, jogador com reserva Pix,
    // turma com aluno, mensalidade vencida, avaliação, convite da equipe por e-mail, pagamento com
    // observação e o cadastro do gateway (documento, e-mail e conta bancária).
    await approveMerchant(t, dono, spaceA.id);
    await setModes(t, dono, spaceA.id, 'ONLINE_OPTIONAL');
    const desk = await t
      .http()
      .post(`/v1/manage/spaces/${spaceA.id}/bookings`)
      .set(...bearer(dono))
      .send({
        courtId: spaceA.courtA,
        sportId: spaceA.sportId,
        startsAt: slotIn(26 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        guestName: 'Cliente do Balcão',
        guestPhone: GUEST_PHONE,
      })
      .expect(201);
    const online = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(jogador))
      .send({
        spaceId: spaceA.id,
        courtId: spaceA.courtB,
        sportId: spaceA.sportId,
        startsAt: slotIn(28 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        paymentOption: 'ONLINE_PIX',
      })
      .expect(201);
    await t
      .http()
      .post(`/v1/manage/spaces/${spaceA.id}/payments`)
      .set(...bearer(dono))
      .send({
        payableType: 'BOOKING',
        payableId: desk.body.id,
        amountCents: 5_000,
        method: 'CASH',
        note: `Pago; recibo para ${NOTE_EMAIL}`,
      })
      .expect(201);
    const group = await insertGroup(t.db, spaceA, await teacherMemberId(t.db, prof.id, spaceA.id));
    const session = await insertSession(t.db, group, 120);
    const subscription = await enroll(t.db, {
      userId: jogador.id,
      spaceId: spaceA.id,
      sportId: spaceA.sportId,
      classGroupId: group.id,
    });
    await confirm(t.db, session.id, jogador.id);
    await t.db.insert(subscriptionCharges).values({
      subscriptionId: subscription.id,
      periodStart: '2026-01-10',
      periodEnd: '2026-02-09',
      dueDate: '2026-01-10',
      amountCents: 15_000,
      status: 'OVERDUE',
    });
    await insertReviewRow(t.db, spaceA.id, { userId: jogador.id, rating: 5, comment: 'Ótimo' });
    // Avaliações com contato no texto: uma denunciada como dado pessoal (ainda pública) e uma
    // oculta pela moderação. Pelo MCP, o comentário das duas sai nulo.
    const personal = await insertReviewRow(t.db, spaceA.id, {
      rating: 2,
      comment: `Me liga no (31) 98765-4321 ou escreve para ${REVIEW_EMAIL}`,
    });
    const hidden = await insertReviewRow(t.db, spaceA.id, {
      rating: 1,
      comment: 'Whats do dono: +5531987654321',
      commentHiddenAt: new Date(),
      commentHiddenBy: sup.id,
      commentHiddenReason: 'Telefone de terceiro',
    });
    await t.db.insert(spaceReviewReports).values([
      { reviewId: personal.id, reporterUserId: dono.id, reason: 'PERSONAL_DATA' },
      {
        reviewId: hidden.id,
        reporterUserId: dono.id,
        reason: 'OFFENSIVE',
        details: 'ver +5531987654321',
      },
    ]);
    reviewIds = { personal: personal.id, hidden: hidden.id };
    await t
      .http()
      .post(`/v1/manage/spaces/${spaceA.id}/team/invites`)
      .set(...bearer(dono))
      .send({ email: INVITE_EMAIL, role: 'TEACHER' })
      .expect(201);
    ids = {
      spaceId: spaceA.id,
      courtId: spaceA.courtA,
      bookingId: desk.body.id,
      classGroupId: group.id,
      sessionId: session.id,
      planId: subscription.planId,
      chargeId: (
        await t.db
          .select({ id: onlineCharges.id })
          .from(onlineCharges)
          .where(eq(onlineCharges.payableId, online.body.id))
      )[0]?.id as string,
      userId: jogador.id,
    };
  });
  afterAll(() => t?.close());

  describe('escopos concedidos por papel e emissão por recurso (RN-MCP-06, decisões 120 e 121)', () => {
    it('recurso do jogador: jogador sem papel, Professor, Admin, Dona e Super', async () => {
      const expected: [SignedUp, string][] = [
        [jogador, PLAYER_SCOPES],
        [prof, `${PLAYER_SCOPES} manage:read`],
        [admin, USER_SCOPES],
        [dono, USER_SCOPES],
        // O Super sem papel em espaço é só jogador neste recurso: o painel é o outro conector.
        [sup, PLAYER_SCOPES],
      ];
      for (const [user, scopes] of expected) {
        const token = await connect(t, user, { scope: `${USER_SCOPES} super:read` });
        const { payload } = decodeJwt(token.access_token);
        expect(payload.aud, user.email).toBe(MCP_RESOURCE);
        expect(String(payload.scope).split(' ').sort(), user.email).toEqual(
          [...scopes.split(' '), 'offline_access'].sort(),
        );
      }
    });

    it('o consentimento mostra só os escopos concedíveis e o conector', async () => {
      const { location } = await authorize(prof, { scope: USER_SCOPES, prompt: 'consent' });
      const query = new URL(location as string).search.slice(1);
      const described = await consentRequest(prof, query);
      expect(described.status).toBe(200);
      expect(described.body).toMatchObject({
        resource: { kind: 'USER', name: 'Space Sports', maxConnectionHours: null },
        scopes: [...PLAYER_SCOPES.split(' '), 'manage:read'],
        deniedScopes: ['manage:finance:read'],
        canAuthorize: true,
      });
      // A query que a tela recebe já vem filtrada pelo servidor; mesmo com a query de outra pessoa
      // (a do Super), o servidor decide pela conta logada.
      const adminQuery = new URL(
        (await authorize(sup, { resource: ADMIN_RESOURCE, scope: 'super:read' })).location ?? '',
      ).search.slice(1);
      const forJogador = await consentRequest(jogador, adminQuery);
      expect(forJogador.body).toMatchObject({
        resource: { kind: 'ADMIN', name: 'Space Sports · Plataforma', maxConnectionHours: 24 },
        scopes: [],
        deniedScopes: ['super:read'],
        canAuthorize: false,
      });
    });

    it('recurso do Super: o Super recebe só super:read, com aud própria', async () => {
      const token = await connectAdmin(sup);
      const { payload } = decodeJwt(token.access_token);
      expect(payload.aud).toBe(ADMIN_RESOURCE);
      expect(String(payload.scope).split(' ').sort()).toEqual(['offline_access', 'super:read']);
      expect(token.refresh_token).toEqual(expect.any(String));
      // O mesmo cliente segue conectado ao recurso do jogador, com o seu consentimento.
      const consents = await t.db
        .select()
        .from(oauthConsents)
        .where(and(eq(oauthConsents.userId, sup.id), eq(oauthConsents.clientId, CLIENT_ID)));
      expect(consents.map((row) => row.referenceId ?? '').sort()).toEqual(['', 'mcp-admin']);
    });

    it('recurso do Super para quem não é Super: tela sem "Permitir" e access_denied', async () => {
      for (const user of [jogador, dono]) {
        const { res, location } = await authorize(user, {
          resource: ADMIN_RESOURCE,
          scope: 'super:read',
        });
        expect(res.status).toBe(302);
        const consentUrl = new URL(location as string);
        expect(consentUrl.origin + consentUrl.pathname).toBe(`${WEB_ORIGIN}/autorizar`);
        const query = consentUrl.search.slice(1);
        expect((await consentRequest(user, query)).body.canAuthorize).toBe(false);
        const accepted = await consent(user, query, { accept: true });
        expect(accepted.status).toBe(403);
        expect(accepted.body).toMatchObject({
          code: 'OAUTH_ACCESS_DENIED',
          error: 'access_denied',
        });
        const denied = await consent(user, query, { accept: false });
        expect(new URL(denied.body.url).searchParams.get('error')).toBe('access_denied');
        // Escolher `super:read` na mão também não passa.
        expect((await consent(user, query, { accept: true, scope: 'super:read' })).status).toBe(
          403,
        );
        const rows = await t.db
          .select()
          .from(oauthConsents)
          .where(
            and(eq(oauthConsents.userId, user.id), eq(oauthConsents.referenceId, 'mcp-admin')),
          );
        expect(rows).toEqual([]);
      }
    });

    it('um recurso por token: escopo de outro recurso sai, e só ele no pedido é recusado', async () => {
      const onlyAdminScope = await authorize(dono, { scope: 'super:read' });
      expect(onlyAdminScope.res.status).toBe(400);
      expect(onlyAdminScope.res.body.error).toBe('invalid_scope');
      const onlyManage = await authorize(sup, { resource: ADMIN_RESOURCE, scope: 'manage:read' });
      expect(onlyManage.res.status).toBe(400);
      expect(onlyManage.res.body.error).toBe('invalid_scope');
    });

    it('pedido só com offline_access (como o Claude conecta) vale como todos os do recurso', async () => {
      const onlyOffline = await authorize(sup, {
        resource: ADMIN_RESOURCE,
        scope: 'offline_access',
        prompt: 'consent',
      });
      const query = new URL(onlyOffline.location ?? '').search.slice(1);
      expect(new URLSearchParams(query).get('scope')).toBe('super:read offline_access');
      expect((await consentRequest(sup, query)).body).toMatchObject({
        scopes: ['super:read'],
        canAuthorize: true,
      });
    });
  });

  describe('lista permitida por audiência (decisão 120)', () => {
    let donoToken: TokenResponse;
    let supUserToken: TokenResponse;
    let supAdminToken: TokenResponse;

    beforeAll(async () => {
      donoToken = await connect(t, dono, { scope: USER_SCOPES });
      supUserToken = await connect(t, sup, { scope: PLAYER_SCOPES });
      supAdminToken = await connectAdmin(sup);
    });

    it('o token do jogador (mesmo com gestão, mesmo do Super) não entra no /super', async () => {
      for (const token of [donoToken, supUserToken]) {
        const res = await get(token.access_token, '/v1/super/users');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
      }
      expect((await get(donoToken.access_token, `/v1/manage/spaces/${spaceA.id}`)).status).toBe(
        200,
      );
    });

    it('o token do Super não entra nas rotas de jogador nem de gestão', async () => {
      for (const path of [
        '/v1/me/summary',
        '/v1/bookings',
        '/v1/spaces',
        '/v1/me/staff-spaces',
        `/v1/manage/spaces/${spaceA.id}`,
      ]) {
        const res = await get(supAdminToken.access_token, path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('OAUTH_ROUTE_NOT_ALLOWED');
      }
      const write = await t
        .http()
        .post(`/v1/super/spaces/${spaceA.id}/suspend`)
        .set(...bearerOf(supAdminToken.access_token))
        .send({ reason: 'teste' });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
      for (const path of [
        '/v1/super/admins',
        '/v1/super/deletion-requests',
        '/v1/super/support-sessions',
        '/v1/super/online-payments/simulator/charges',
        '/v1/super/finance/payments.csv',
        '/v1/super/contacts',
      ]) {
        const res = await get(supAdminToken.access_token, path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('OAUTH_ROUTE_NOT_ALLOWED');
      }
      expect((await get(supAdminToken.access_token, '/v1/super/users')).status).toBe(200);
    });

    it('gestão fora da lista: CSV, escrita, contatos, convites e conta do gateway', async () => {
      const auth = bearerOf(donoToken.access_token);
      for (const [method, path] of [
        ['get', `/v1/manage/spaces/${spaceA.id}/statement.csv`],
        ['get', `/v1/manage/spaces/${spaceA.id}/contacts`],
        ['get', `/v1/manage/spaces/${spaceA.id}/settings`],
        ['get', `/v1/manage/spaces/${spaceA.id}/online-payments/merchant-account`],
        ['get', `/v1/manage/spaces/${spaceA.id}/online-payments/settings`],
        ['get', `/v1/manage/spaces/${spaceA.id}/online-payments/wallet/payouts`],
        ['get', `/v1/manage/spaces/${spaceA.id}/recurring-bookings`],
        ['get', `/v1/manage/spaces/${spaceA.id}/subscriptions`],
        ['get', `/v1/manage/spaces/${spaceA.id}/teachers`],
        ['post', `/v1/manage/spaces/${spaceA.id}/team/invites`],
        ['post', `/v1/manage/spaces/${spaceA.id}/court-blocks`],
        ['patch', `/v1/manage/spaces/${spaceA.id}`],
      ] as const) {
        const res = await t
          .http()
          [method](path)
          .set(...auth)
          .send({});
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.body.error.code, `${method} ${path}`).toBe('OAUTH_ROUTE_NOT_ALLOWED');
      }
      // Só GET: o HEAD (que o Express manda ao mesmo handler) também é recusado pelo AuthGuard.
      for (const [token, path] of [
        [donoToken, `/v1/manage/spaces/${spaceA.id}`],
        [supAdminToken, '/v1/super/users'],
      ] as const) {
        const res = await t
          .http()
          .head(path)
          .set(...bearerOf(token.access_token));
        expect(res.status, path).toBe(403);
      }
    });

    it('audiência dupla, desconhecida ou do Super com a chave vencida no guard: 401', async () => {
      for (const aud of [[MCP_RESOURCE, ADMIN_RESOURCE], 'https://outro.example.com/mcp']) {
        const token = await mintToken(key, { sub: dono.id, aud, scope: USER_SCOPES });
        const res = await get(token, '/v1/bookings');
        expect(res.status, JSON.stringify(aud)).toBe(401);
        expect(res.body.error.code).toBe('OAUTH_TOKEN_INVALID');
      }
      // Cliente fora da MCP_ADMIN_ALLOWED_CLIENT_IDS com aud do Super: o guard também recusa.
      const other = await mintToken(key, {
        sub: sup.id,
        aud: ADMIN_RESOURCE,
        azp: OTHER_CLIENT,
        client_id: OTHER_CLIENT,
        scope: 'super:read',
      });
      expect((await get(other, '/v1/super/users')).status).toBe(401);
    });

    it('modo suporte nunca vale com o token do MCP', async () => {
      const res = await t
        .http()
        .get(`/v1/manage/spaces/${spaceA.id}`)
        .set(...bearerOf(donoToken.access_token))
        .set('x-support-session', '00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
    });
  });

  describe('papel no espaço como no painel (RN-MCP-06, decisão 53)', () => {
    it('Professor que pede manage:finance:read não recebe, e mesmo forçando não vê valores', async () => {
      const token = await connect(t, prof, { scope: USER_SCOPES });
      expect(String(decodeJwt(token.access_token).payload.scope)).not.toContain('finance');
      const statement = await get(token.access_token, `/v1/manage/spaces/${spaceA.id}/statement`, {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date().toISOString(),
      });
      expect(statement.status).toBe(403);
      expect(statement.body.error.code).toBe('OAUTH_INSUFFICIENT_SCOPE');

      // Forçando: consentimento e token com o escopo de valores (o servidor nunca os emitiria).
      await t.db
        .update(oauthConsents)
        .set({ scopes: [...USER_SCOPES.split(' '), 'offline_access'] })
        .where(and(eq(oauthConsents.userId, prof.id), eq(oauthConsents.clientId, CLIENT_ID)));
      const forced = await mintToken(key, { sub: prof.id, scope: USER_SCOPES });
      const list = await get(forced, `/v1/manage/spaces/${spaceA.id}/bookings`);
      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      for (const item of list.body.items) {
        expect(item.priceCents).toBeNull();
        expect(item.paidCents).toBeNull();
        expect(item.paymentStatus).toBeNull();
      }
      const detail = await get(forced, `/v1/manage/spaces/${spaceA.id}/bookings/${ids.bookingId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.priceCents).toBeNull();
      expect(detail.body.payments).toEqual([]);
      for (const path of ['statement', 'receivables/today', 'online-payments/wallet']) {
        const res = await get(forced, `/v1/manage/spaces/${spaceA.id}/${path}`, {
          from: new Date(Date.now() - 86_400_000).toISOString(),
          to: new Date().toISOString(),
        });
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('SPACE_FORBIDDEN');
      }
    });

    it('Dona sem manage:finance:read não vê valores; com ele, vê', async () => {
      await connect(t, dono, { scope: USER_SCOPES });
      const withoutFinance = await mintToken(key, {
        sub: dono.id,
        scope: `${PLAYER_SCOPES} manage:read`,
      });
      const hidden = await get(withoutFinance, `/v1/manage/spaces/${spaceA.id}/bookings`);
      expect(hidden.status).toBe(200);
      expect(
        hidden.body.items.every((item: { priceCents: unknown }) => item.priceCents === null),
      ).toBe(true);
      const withFinance = await mintToken(key, { sub: dono.id, scope: USER_SCOPES });
      const shown = await get(withFinance, `/v1/manage/spaces/${spaceA.id}/bookings`);
      expect(
        shown.body.items.some((item: { priceCents: unknown }) => item.priceCents === 10_000),
      ).toBe(true);
    });

    it('Admin do espaço A lendo o espaço B: 403 SPACE_FORBIDDEN, como no painel', async () => {
      const token = await connect(t, admin, { scope: USER_SCOPES });
      const viaMcp = await get(token.access_token, `/v1/manage/spaces/${spaceB.id}/bookings`);
      const viaPanel = await t
        .http()
        .get(`/v1/manage/spaces/${spaceB.id}/bookings`)
        .set(...bearer(admin));
      expect([viaMcp.status, viaMcp.body.error.code]).toEqual([403, 'SPACE_FORBIDDEN']);
      expect([viaPanel.status, viaPanel.body.error.code]).toEqual([403, 'SPACE_FORBIDDEN']);
      // Reserva do A pelo id, no caminho do B: 403 também (o vínculo vale só para o espaço).
      const crossed = await get(
        token.access_token,
        `/v1/manage/spaces/${spaceB.id}/bookings/${ids.bookingId}`,
      );
      expect(crossed.status).toBe(403);
    });
  });

  it('varredura: nenhuma rota de gestão ou do Super devolve contato, documento ou afins', async () => {
    const donoToken = await connect(t, dono, { scope: USER_SCOPES });
    const supToken = await connectAdmin(sup);
    const now = Date.now();
    const queries: Record<string, Record<string, string>> = {
      'court-blocks': {
        from: new Date(now - 7 * 86_400_000).toISOString(),
        to: new Date(now + 30 * 86_400_000).toISOString(),
      },
      statement: {
        from: new Date(now - 7 * 86_400_000).toISOString(),
        to: new Date(now + 86_400_000).toISOString(),
      },
      'reviews/summary': { spaceId: spaceA.id },
      'class-attendances': { classGroupId: ids.classGroupId as string },
      'reports/monthly': { month: new Date(now).toISOString().slice(0, 7) },
    };
    // Métricas (MCP2.2): um período que cobre as reservas de amanhã (balcão com telefone e Pix),
    // para o nome do cliente de balcão passar pela varredura.
    for (const metric of METRICS) queries[`analytics/${metric}`] = analyticsPeriod();
    const sensitive = [
      ...Object.values(PEOPLE).flatMap(({ email, phone }) => [email, phone, phone.slice(3)]),
      GUEST_PHONE,
      GUEST_PHONE.slice(3),
      INVITE_EMAIL,
      NOTE_EMAIL,
      REVIEW_EMAIL,
      '98765-4321',
      '987654321',
      ...MERCHANT_VALUES,
    ];
    const routes = oauthRoutes(t).filter((route) =>
      route.scopes.some((scope) => scope.startsWith('manage:') || scope === 'super:read'),
    );
    expect(routes.length).toBeGreaterThan(35);
    const failures: string[] = [];
    for (const route of routes) {
      const path = route.path.replace(/:(\w+)/g, (_match, name: string) => ids[name] ?? name);
      const suffix = Object.keys(queries).find((end) => route.path.endsWith(end));
      const token = route.scopes.includes('super:read') ? supToken : donoToken;
      const res = await get(token.access_token, path, suffix ? queries[suffix] : {});
      if (res.status !== 200) {
        failures.push(`${route.path}: ${res.status} ${JSON.stringify(res.body)}`);
        continue;
      }
      const leaks = leaksIn(res.body, sensitive);
      if (leaks.length) failures.push(`${route.path}: ${leaks.join(', ')}`);
    }
    expect(failures).toEqual([]);
    // A sessão do web segue com a visão completa (o telefone do balcão aparece no painel).
    const panel = await t
      .http()
      .get(`/v1/manage/spaces/${spaceA.id}/bookings/${ids.bookingId}`)
      .set(...bearer(dono));
    expect(JSON.stringify(panel.body)).toContain(GUEST_PHONE);
    // As avaliações marcadas (denúncia de dado pessoal ou ocultas) estão na fila e na lista, com o
    // comentário nulo pelo MCP; no painel do Super, o texto segue inteiro para moderar.
    const reports = await get(supToken.access_token, '/v1/super/reviews/reports');
    const marked = reports.body.items.filter((item: { reviewId: string }) =>
      Object.values(reviewIds).includes(item.reviewId),
    );
    expect(marked).toHaveLength(2);
    for (const item of marked) expect(item.review.comment).toBeNull();
    const manage = await get(donoToken.access_token, `/v1/manage/spaces/${spaceA.id}/reviews`);
    const personalItem = manage.body.items.find(
      (item: { id: string }) => item.id === reviewIds.personal,
    );
    expect(personalItem).toMatchObject({ rating: 2, comment: null });
    const superPanel = await t
      .http()
      .get('/v1/super/reviews/reports')
      .set(...bearer(sup));
    expect(JSON.stringify(superPanel.body)).toContain(REVIEW_EMAIL);
  });

  it('métricas (MCP2.2): escopos, papéis e a visão igual à resposta do painel', async () => {
    const period = analyticsPeriod();
    const manage = (metric: string) => `/v1/manage/spaces/${spaceA.id}/analytics/${metric}`;
    const donoToken = (await connect(t, dono, { scope: USER_SCOPES })).access_token;
    // A visão é a lista de campos do contrato: pelo MCP sai o mesmo que no painel.
    for (const metric of ['bookings', 'occupancy', 'classes', 'customers', 'revenue']) {
      const viaMcp = await get(donoToken, manage(metric), period);
      const viaPanel = await t
        .http()
        .get(manage(metric))
        .query(period)
        .set(...bearer(dono));
      expect(viaMcp.status, metric).toBe(200);
      expect(viaMcp.body, metric).toEqual(viaPanel.body);
    }
    // O cliente de balcão sai pelo nome que a gestão digitou, com a chave `guest-N`.
    const customers = await get(donoToken, manage('customers'), period);
    expect(customers.body.rows).toContainEqual(
      expect.objectContaining({ key: 'guest-1', label: 'Cliente do Balcão' }),
    );
    expect(leaksIn(customers.body, [GUEST_PHONE, GUEST_PHONE.slice(3)])).toEqual([]);

    // Receita só com manage:finance:read; o resto com manage:read.
    const withoutFinance = await mintToken(key, {
      sub: dono.id,
      scope: `${PLAYER_SCOPES} manage:read`,
    });
    const revenue = await get(withoutFinance, manage('revenue'), period);
    expect([revenue.status, revenue.body.error.code]).toEqual([403, 'OAUTH_INSUFFICIENT_SCOPE']);
    expect((await get(withoutFinance, manage('customers'), period)).status).toBe(200);
    const playerOnly = await mintToken(key, { sub: dono.id, scope: PLAYER_SCOPES });
    const noManage = await get(playerOnly, manage('bookings'), period);
    expect([noManage.status, noManage.body.error.code]).toEqual([403, 'OAUTH_INSUFFICIENT_SCOPE']);

    // Professor: reservas, ocupação e aulas sim; clientes e receita não, como no painel.
    const profToken = (await connect(t, prof, { scope: USER_SCOPES })).access_token;
    for (const metric of ['bookings', 'occupancy', 'classes']) {
      expect((await get(profToken, manage(metric), period)).status, metric).toBe(200);
    }
    const forced = await mintToken(key, { sub: prof.id, scope: USER_SCOPES });
    for (const metric of ['customers', 'revenue']) {
      const res = await get(forced, manage(metric), period);
      expect([res.status, res.body.error.code], metric).toEqual([403, 'SPACE_FORBIDDEN']);
    }

    // Super: só com o token do recurso do Super; o da gestão não entra, e vice-versa.
    const supToken = (await connectAdmin(sup)).access_token;
    for (const metric of ['platform', 'spaces']) {
      const viaMcp = await get(supToken, `/v1/super/analytics/${metric}`, period);
      const viaPanel = await t
        .http()
        .get(`/v1/super/analytics/${metric}`)
        .query(period)
        .set(...bearer(sup));
      expect(viaMcp.status, metric).toBe(200);
      expect(viaMcp.body, metric).toEqual(viaPanel.body);
      const crossed = await get(donoToken, `/v1/super/analytics/${metric}`, period);
      expect(crossed.body.error.code, metric).toBe('OAUTH_ROUTE_NOT_ALLOWED');
    }
    const supOnManage = await get(supToken, manage('bookings'), period);
    expect(supOnManage.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
  });

  it('busca pelo MCP só por nome: e-mail e telefone não viram oráculo do contato', async () => {
    const donoToken = await connect(t, dono, { scope: USER_SCOPES });
    const supToken = await connectAdmin(sup);
    const byPhone = await get(supToken.access_token, '/v1/super/users', { q: '911110004' });
    const byEmail = await get(supToken.access_token, '/v1/super/users', { q: 'jogador.gestao@' });
    const byName = await get(supToken.access_token, '/v1/super/users', { q: 'Jogador Gestão' });
    expect([byPhone.body.total, byEmail.body.total, byName.body.total]).toEqual([0, 0, 1]);
    const guest = await get(donoToken.access_token, `/v1/manage/spaces/${spaceA.id}/bookings`, {
      q: '977776666',
    });
    expect(guest.body.items).toEqual([]);
    // Na sessão do web, a busca por contato segue como antes.
    const panel = await t
      .http()
      .get('/v1/super/users')
      .query({ q: '911110004' })
      .set(...bearer(sup));
    expect(panel.body.total).toBe(1);
  });

  describe('proteções do Super (decisão 123, RN-MCP-08)', () => {
    it('cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS: recusado no authorize, com o client_id no log', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn');
      try {
        const { res, location } = await authorize(sup, {
          client_id: OTHER_CLIENT,
          resource: ADMIN_RESOURCE,
          scope: 'super:read',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('unauthorized_client');
        expect(location).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
          { oauthClientId: OTHER_CLIENT },
          expect.stringContaining('MCP_ADMIN_ALLOWED_CLIENT_IDS'),
        );
      } finally {
        warn.mockRestore();
      }
      // O mesmo cliente segue podendo usar o recurso do jogador.
      const token = await connect(t, sup, { client_id: OTHER_CLIENT, scope: PLAYER_SCOPES });
      expect(decodeJwt(token.access_token).payload.aud).toBe(MCP_RESOURCE);
    });

    it('conexão de mais de 24 h: token e renovação param; nova autorização pede o consentimento', async () => {
      const token = await connectAdmin(sup);
      expect((await get(token.access_token, '/v1/super/users')).status).toBe(200);
      const adminConsent = and(
        eq(oauthConsents.userId, sup.id),
        eq(oauthConsents.clientId, CLIENT_ID),
        eq(oauthConsents.referenceId, 'mcp-admin'),
      );
      await t.db
        .update(oauthConsents)
        .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
        .where(adminConsent);
      const expired = await get(token.access_token, '/v1/super/users');
      expect([expired.status, expired.body.error.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
      const renewed = await refresh(t, token.refresh_token as string, ADMIN_RESOURCE);
      expect(renewed.status).toBe(400);
      expect(renewed.body.error).toBe('invalid_grant');
      // O recurso do jogador do mesmo Super não é afetado.
      const userToken = await connect(t, sup, { scope: PLAYER_SCOPES });
      expect((await get(userToken.access_token, '/v1/bookings')).status).toBe(200);

      // Nova autorização: o consentimento vencido sai e a tela aparece de novo.
      const again = await authorize(sup, { resource: ADMIN_RESOURCE, scope: 'super:read' });
      expect(new URL(again.location as string).pathname).toBe('/autorizar');
      const fresh = await connectAdmin(sup);
      expect((await get(fresh.access_token, '/v1/super/users')).status).toBe(200);
      const [row] = await t.db.select().from(oauthConsents).where(adminConsent);
      expect(Date.now() - (row?.createdAt.getTime() ?? 0)).toBeLessThan(60_000);
    });

    it('auditoria de todo token do Super, com o resultado, inclusive o recusado', async () => {
      const token = await connectAdmin(sup);
      const auth = bearerOf(token.access_token);
      expect(
        (await get(token.access_token, '/v1/super/users', { q: 'gestao', page: '1' })).status,
      ).toBe(200);
      const missing = '/v1/super/users/00000000-0000-4000-8000-000000000000';
      expect((await get(token.access_token, missing)).status).toBe(404);
      // Recusadas pela lista (rota e método) e pelo papel (SUPER_REQUIRED).
      expect((await get(token.access_token, '/v1/super/admins')).status).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/v1/super/spaces/${spaceA.id}/suspend`)
            .set(...auth)
            .send({ reason: 'x' })
        ).status,
      ).toBe(403);
      // Token do Super de quem deixou de ser Super (o consentimento ainda existe).
      const demoted = await signUp(t, 'ex.super@exemplo.com', 'Ex Super', '+5531911110009');
      await makeSuper(t.db, demoted.id);
      const demotedToken = await connectAdmin(demoted);
      await t.db.update(users).set({ platformRole: 'USER' }).where(eq(users.id, demoted.id));
      const refused = await get(demotedToken.access_token, '/v1/super/users');
      expect([refused.status, refused.body.error.code]).toEqual([403, 'SUPER_REQUIRED']);

      const expected = [
        ['GET', '/v1/super/users', { q: 'gestao', page: '1' }, 200, null, sup.id],
        ['GET', missing, {}, 404, 'USER_NOT_FOUND', sup.id],
        ['GET', '/v1/super/admins', {}, 403, 'OAUTH_ROUTE_NOT_ALLOWED', sup.id],
        [
          'POST',
          `/v1/super/spaces/${spaceA.id}/suspend`,
          {},
          403,
          'OAUTH_ROUTE_NOT_ALLOWED',
          sup.id,
        ],
        ['GET', '/v1/super/users', {}, 403, 'SUPER_REQUIRED', demoted.id],
      ] as const;
      // O resultado entra quando a resposta fecha: espera a gravação.
      const deadline = Date.now() + 3_000;
      let rows: { actorId: string | null; diff: Record<string, unknown> | null }[] = [];
      const done = () =>
        expected.every(([method, path, , status, code, actor]) =>
          rows.some(
            (row) =>
              row.actorId === actor &&
              row.diff?.method === method &&
              row.diff?.path === path &&
              (row.diff?.result as { status?: number } | null)?.status === status &&
              (row.diff?.result as { code?: string | null } | null)?.code === code,
          ),
        );
      while (Date.now() < deadline) {
        rows = await t.db
          .select({ actorId: auditLogs.actorId, diff: auditLogs.diff })
          .from(auditLogs)
          .where(eq(auditLogs.action, 'mcp.admin_request'));
        if (done()) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(done(), JSON.stringify(rows.slice(-8))).toBe(true);
      const users200 = rows.find(
        (row) => row.actorId === sup.id && (row.diff?.query as { q?: string })?.q === 'gestao',
      );
      expect(users200?.diff).toEqual({
        method: 'GET',
        path: '/v1/super/users',
        query: { q: 'gestao', page: '1' },
        origin: 'MCP',
        oauthClientId: CLIENT_ID,
        result: { status: 200, code: null, completed: true },
      });
      expect(JSON.stringify(rows)).not.toContain(token.access_token);
      // A leitura da gestão pelo token do jogador não vira auditoria (só as escritas, fase 1).
      const before = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'mcp.admin_request'));
      const donoToken = await connect(t, dono, { scope: USER_SCOPES });
      await get(donoToken.access_token, `/v1/manage/spaces/${spaceA.id}`).expect(200);
      const after = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'mcp.admin_request'));
      expect(after.length).toBe(before.length);
    });
  });
});

describe('MCP_ADMIN_ENABLED=false (decisão 123)', () => {
  let t: TestApp;
  let sup: SignedUp;
  let jogador: SignedUp;

  beforeAll(async () => {
    t = await createMcpTestApp({
      env: {
        MCP_ADMIN_RESOURCE_URL: ADMIN_RESOURCE,
        MCP_ADMIN_ALLOWED_CLIENT_IDS: CLIENT_ID,
        MCP_ADMIN_ENABLED: 'false',
      },
    });
    sup = await signUp(t, 'super.desligado@exemplo.com', 'Super Desligado');
    await makeSuper(t.db, sup.id);
    jogador = await signUp(t, 'jogador.desligado@exemplo.com', 'Jogador Desligado');
  });
  afterAll(() => t?.close());

  it('desliga só o recurso do Super (authorize e token: 503); o do jogador segue', async () => {
    const { challenge } = pkce();
    const res = await t
      .http()
      .get(
        authorizePath(
          authorizeParams(challenge, { resource: ADMIN_RESOURCE, scope: 'super:read' }),
        ),
      )
      .set('cookie', sup.cookie);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MCP_DISABLED');

    await t.http().get('/v1/auth/jwks').expect(200);
    const key = await insertTestKey(t);
    const userToken = await connect(t, sup, { scope: PLAYER_SCOPES });
    // Token do Super assinado à mão (o servidor não emitiria): o guard responde 503.
    await t.db.insert(oauthConsents).values({
      clientId: CLIENT_ID,
      userId: sup.id,
      referenceId: 'mcp-admin',
      scopes: ['super:read', 'offline_access'],
      createdAt: new Date(Date.now() - 60_000),
    });
    const adminToken = await mintToken(key, {
      sub: sup.id,
      aud: ADMIN_RESOURCE,
      scope: 'super:read',
    });
    const denied = await t
      .http()
      .get('/v1/super/users')
      .set(...bearerOf(adminToken));
    expect([denied.status, denied.body.error.code]).toEqual([503, 'MCP_DISABLED']);

    // O recurso do jogador e o metadata do servidor de autorização seguem no ar.
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearerOf(userToken.access_token))
      ).status,
    ).toBe(200);
    const player = await connect(t, jogador);
    expect(decodeJwt(player.access_token).payload.aud).toBe(MCP_RESOURCE);
    expect((await t.http().get('/.well-known/oauth-authorization-server/v1/auth')).status).toBe(
      200,
    );
  });
});
