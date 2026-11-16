import { utcToZoned } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeAcceptsResource } from '../../src/auth/oauth-access.service.js';
import {
  auditLogs,
  bookings,
  oauthConsents,
  spaceMembers,
  users,
} from '../../src/db/schema/index.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, slotIn } from '../bookings/fixtures.js';
import { insertGroup, insertSession, listOf } from '../classes/attendance-fixtures.js';
import { confirm, enroll, teacherMemberId } from '../classes/fixtures.js';
import {
  bearerOf,
  CLIENT_ID,
  connect,
  createMcpTestApp,
  decodeJwt,
  insertTestKey,
  mintToken,
  oauthRoutes,
  refresh,
  type TestKey,
  type TokenResponse,
} from './helpers.js';

// RN-MCP-01, RN-MCP-03 e RN-MCP-04; decisões 112, 113 e 115 (docs/14-mcp.md 3.3 e 3.4): o token do
// MCP na API, com a lista permitida, os escopos, a validação do token e a auditoria.

/**
 * A lista permitida por recurso (docs/14-mcp.md 3.3 e 8.2/8.3; decisões 112 e 120): método,
 * caminho e escopos (vazio = qualquer escopo do recurso do jogador).
 */
const ALLOWLIST = {
  /** Recurso do jogador: rotas de jogador (fase 1) e de gestão (fase 2). */
  USER: [
    'DELETE /v1/me/class-sessions/:sessionId/attendance classes:write',
    'GET /v1/bookings bookings:read',
    'GET /v1/bookings/:bookingId bookings:read',
    'GET /v1/manage/spaces/:spaceId manage:read',
    'GET /v1/manage/spaces/:spaceId/analytics/bookings manage:read',
    'GET /v1/manage/spaces/:spaceId/analytics/classes manage:read',
    'GET /v1/manage/spaces/:spaceId/analytics/customers manage:read',
    'GET /v1/manage/spaces/:spaceId/analytics/occupancy manage:read',
    'GET /v1/manage/spaces/:spaceId/analytics/revenue manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/bookings manage:read',
    'GET /v1/manage/spaces/:spaceId/bookings/:bookingId manage:read',
    'GET /v1/manage/spaces/:spaceId/class-attendances manage:read',
    'GET /v1/manage/spaces/:spaceId/class-groups manage:read',
    'GET /v1/manage/spaces/:spaceId/class-groups/:classGroupId manage:read',
    'GET /v1/manage/spaces/:spaceId/class-groups/:classGroupId/frequency manage:read',
    'GET /v1/manage/spaces/:spaceId/class-session-conflicts manage:read',
    'GET /v1/manage/spaces/:spaceId/class-sessions manage:read',
    'GET /v1/manage/spaces/:spaceId/class-sessions/:sessionId manage:read',
    'GET /v1/manage/spaces/:spaceId/court-blocks manage:read',
    'GET /v1/manage/spaces/:spaceId/courts manage:read',
    'GET /v1/manage/spaces/:spaceId/courts/:courtId manage:read',
    'GET /v1/manage/spaces/:spaceId/online-payments/chargebacks manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/online-payments/charges manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/online-payments/charges/:chargeId manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/online-payments/wallet manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/online-payments/wallet/entries manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/plans manage:read',
    'GET /v1/manage/spaces/:spaceId/plans/:planId manage:read',
    'GET /v1/manage/spaces/:spaceId/receivables/today manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/reviews manage:read',
    'GET /v1/manage/spaces/:spaceId/reviews/summary manage:read',
    'GET /v1/manage/spaces/:spaceId/statement manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/subscription-charges manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/subscription-charges/delinquents manage:finance:read',
    'GET /v1/manage/spaces/:spaceId/team manage:read',
    'GET /v1/me/class-sessions classes:read',
    'GET /v1/me/class-sessions/:sessionId classes:read',
    'GET /v1/me/staff-spaces manage:read',
    'GET /v1/me/summary ',
    'GET /v1/spaces spaces:read',
    'GET /v1/spaces/:slug spaces:read',
    'GET /v1/spaces/:slug/classes spaces:read',
    'GET /v1/spaces/:spaceId/availability spaces:read',
    'POST /v1/bookings bookings:write',
    'POST /v1/bookings/:bookingId/cancel bookings:write',
    'POST /v1/me/class-sessions/:sessionId/attendance classes:write',
  ],
  /** Recurso do Super: só leituras de /v1/super, sem CSV, simulador, suporte, admins nem exclusões. */
  ADMIN: [
    'GET /v1/super/analytics/platform super:read',
    'GET /v1/super/analytics/spaces super:read',
    'GET /v1/super/audit-logs super:read',
    'GET /v1/super/finance/summary super:read',
    'GET /v1/super/metrics/spaces super:read',
    'GET /v1/super/online-payments/reports/monthly super:read',
    'GET /v1/super/online-payments/revenue super:read',
    'GET /v1/super/reviews/reports super:read',
    'GET /v1/super/reviews/summary super:read',
    'GET /v1/super/spaces super:read',
    'GET /v1/super/spaces/:spaceId super:read',
    'GET /v1/super/users super:read',
    'GET /v1/super/users/:userId super:read',
  ],
};

describe('token OAuth do MCP na API', () => {
  let t: TestApp;
  let space: Space;
  let ana: SignedUp;
  let bob: SignedUp;
  let anaToken: TokenResponse;
  let bobToken: TokenResponse;
  let key: TestKey;

  beforeAll(async () => {
    t = await createMcpTestApp();
    space = await createSpace(t.db, 'arena-mcp');
    ana = await signUp(t, 'ana.token@exemplo.com', 'Ana');
    bob = await signUp(t, 'bob.token@exemplo.com', 'Bob');
    // Ana é Dona do espaço: mesmo assim, o token do MCP é só de jogador (decisão 113).
    await t.db
      .insert(spaceMembers)
      .values({ userId: ana.id, spaceId: space.id, role: 'OWNER', status: 'ACTIVE' });
    anaToken = await connect(t, ana);
    bobToken = await connect(t, bob);
    key = await insertTestKey(t);
  });
  afterAll(() => t?.close());

  const book = (auth: readonly [string, string], body: Record<string, unknown> = {}) =>
    t
      .http()
      .post('/v1/bookings')
      .set(...auth)
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        durationMin: 60,
        peopleCount: 2,
        startsAt: slotIn(26 * 60).toISOString(),
        ...body,
      });

  it('a lista permitida, por recurso, é exatamente a de docs/14-mcp.md 3.3, 8.2, 8.3 e 8.4', () => {
    const routes = oauthRoutes(t);
    const line = (route: (typeof routes)[number]) =>
      `${route.method} ${route.path} ${route.scopes.join(',')}`;
    const byResource = {
      USER: routes.filter((route) => routeAcceptsResource('USER', route.scopes as never)),
      ADMIN: routes.filter((route) => routeAcceptsResource('ADMIN', route.scopes as never)),
    };
    expect(byResource.USER.map(line)).toEqual(ALLOWLIST.USER);
    expect(byResource.ADMIN.map(line)).toEqual(ALLOWLIST.ADMIN);
    // Nenhuma rota fica sem recurso, e nenhuma vale nos dois.
    expect(byResource.USER.length + byResource.ADMIN.length).toBe(routes.length);
    // Gestão e Super: só leitura, sempre com a lista de campos permitidos (decisão 122) e com o
    // guard de papel de sempre: o espaço da rota (SpaceRolesGuard) ou o Super (SuperGuard).
    for (const route of routes) {
      const manage = route.scopes.some((scope) => scope.startsWith('manage:'));
      const admin = route.scopes.includes('super:read');
      if (!manage && !admin) continue;
      expect(route.method, line(route)).toBe('GET');
      expect(route.hasView, line(route)).toBe(true);
      expect(route.path, line(route)).not.toMatch(/\.csv$/);
      if (manage && route.path.includes(':spaceId')) {
        expect(route.guards, line(route)).toContain('SpaceRolesGuard');
        expect(route.spaceRoles.length, line(route)).toBeGreaterThan(0);
      }
      if (admin) expect(route.guards, line(route)).toContain('SuperGuard');
    }
  });

  it('rota permitida com o escopo certo: leitura, busca pública e reserva no espaço', async () => {
    const auth = bearerOf(anaToken.access_token);
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await t
          .http()
          .get('/v1/spaces')
          .set(...auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await t
          .http()
          .get('/v1/spaces/arena-mcp')
          .set(...auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await t
          .http()
          .get('/v1/me/class-sessions')
          .set(...auth)
      ).status,
    ).toBe(200);
    // Só o resumo: sem e-mail, telefone, nascimento, gênero, papéis nem vínculos.
    const summary = await t
      .http()
      .get('/v1/me/summary')
      .set(...auth);
    expect(summary.status).toBe(200);
    expect(summary.body).toEqual({ id: ana.id, firstName: 'Ana', favoriteSports: [] });
    const sameForSession = await t
      .http()
      .get('/v1/me/summary')
      .set(...bearer(ana));
    expect(sameForSession.body).toEqual(summary.body);
  });

  it('escopo faltando: 403 OAUTH_INSUFFICIENT_SCOPE', async () => {
    const readOnly = await mintToken(key, { sub: ana.id, scope: 'spaces:read offline_access' });
    for (const res of [
      await t
        .http()
        .get('/v1/bookings')
        .set(...bearerOf(readOnly)),
      await book(bearerOf(readOnly)),
      await t
        .http()
        .get('/v1/me/class-sessions')
        .set(...bearerOf(readOnly)),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('OAUTH_INSUFFICIENT_SCOPE');
    }
    expect(
      (
        await t
          .http()
          .get('/v1/spaces')
          .set(...bearerOf(readOnly))
      ).status,
    ).toBe(200);
    // Sem nenhum escopo do MCP, nem o GET /v1/me/summary ("qualquer escopo").
    const none = await mintToken(key, { sub: ana.id, scope: 'offline_access' });
    const me = await t
      .http()
      .get('/v1/me/summary')
      .set(...bearerOf(none));
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('OAUTH_INSUFFICIENT_SCOPE');
  });

  it('fora da lista: 403 OAUTH_ROUTE_NOT_ALLOWED, mesmo para a Dona do espaço', async () => {
    const auth = bearerOf(anaToken.access_token);
    const bookingId = '00000000-0000-7000-8000-000000000000';
    for (const [method, path] of [
      // O perfil completo (contato, nascimento, gênero, papéis): só o resumo vale para o MCP.
      ['get', '/v1/me'],
      ['get', `/v1/manage/spaces/${space.id}/settings`],
      ['patch', `/v1/manage/spaces/${space.id}`],
      ['get', `/v1/manage/spaces/${space.id}/contacts`],
      ['get', '/v1/super/users'],
      ['post', '/v1/me/deletion-request'],
      ['post', '/v1/me/deactivate'],
      ['patch', '/v1/me/profile'],
      ['get', '/v1/me/favorites'],
      ['get', '/v1/me/connected-apps'],
      ['patch', `/v1/bookings/${bookingId}`],
      ['post', `/v1/bookings/${bookingId}/payment`],
      ['get', '/v1/auth/get-session'],
      ['post', '/v1/auth/change-password'],
    ] as const) {
      const res = await t
        .http()
        [method](path)
        .set(...auth)
        .send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe('OAUTH_ROUTE_NOT_ALLOWED');
    }
    // Gestão está na lista (fase 2), mas exige `manage:read`, que a conexão de jogador não tem.
    for (const path of [`/v1/manage/spaces/${space.id}`, '/v1/me/staff-spaces']) {
      const res = await t
        .http()
        .get(path)
        .set(...auth);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('OAUTH_INSUFFICIENT_SCOPE');
    }
  });

  it('token inválido: outra audiência, vencido, assinatura, emissor ou tipo errados → 401', async () => {
    const { privateKey: otherKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const valid = await mintToken(key, { sub: ana.id });
    const [header, payload, signature] = valid.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
        sub: bob.id,
      }),
    ).toString('base64url');
    const cases: Record<string, string> = {
      'outra audiência': await mintToken(key, {
        sub: ana.id,
        aud: 'https://outro.example.com/mcp',
      }),
      'audiência do próprio emissor': await mintToken(key, {
        sub: ana.id,
        aud: 'http://localhost:3333',
      }),
      vencido: await mintToken(key, { sub: ana.id }, { expiresIn: -60 }),
      'assinado por outra chave': await mintToken(key, { sub: ana.id }, { signWith: otherKey }),
      'payload adulterado': `${header}.${forgedPayload}.${signature}`,
      'outro emissor': await mintToken(key, {
        sub: ana.id,
        iss: 'https://evil.example.com/v1/auth',
      }),
      'typ de ID token': await mintToken(key, { sub: ana.id }, { typ: 'JWT' }),
      'sem cliente (azp)': await mintToken(key, { sub: ana.id, azp: undefined }),
      'cliente sem conexão': await mintToken(key, {
        sub: ana.id,
        azp: 'https://outro-cliente.example.com/client.json',
      }),
      'sub que não é usuário': await mintToken(key, { sub: 'nao-e-uuid' }),
      // BUG-MCP2-1: a conexão do token é a claim `consent_id`, conferida contra a atual.
      'sem a conexão (consent_id)': await mintToken(key, { sub: ana.id, consent_id: undefined }),
      'conexão de outra pessoa': await mintToken(key, {
        sub: ana.id,
        consent_id: decodeJwt(bobToken.access_token).payload.consent_id,
      }),
      'conexão que não existe mais': await mintToken(key, {
        sub: ana.id,
        consent_id: '00000000-0000-4000-8000-000000000000',
      }),
      'JWT qualquer': 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.assinatura',
    };
    // O token válido passa: os casos abaixo falham pelo motivo de cada um.
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearerOf(valid))
      ).status,
    ).toBe(200);
    for (const [label, token] of Object.entries(cases)) {
      const res = await t
        .http()
        .get('/v1/bookings')
        .set(...bearerOf(token));
      expect(res.status, label).toBe(401);
      expect(res.body.error.code, label).toBe('OAUTH_TOKEN_INVALID');
    }
    // Inválido também em rota pública: nunca vira acesso anônimo.
    const publicRes = await t
      .http()
      .get('/v1/spaces')
      .set(...bearerOf(cases.vencido as string));
    expect(publicRes.status).toBe(401);
  });

  it('a sessão do app e do web segue igual nas mesmas rotas', async () => {
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearer(ana))
      ).status,
    ).toBe(200);
    expect((await t.http().get('/v1/me/connected-apps').set('cookie', ana.cookie)).status).toBe(
      200,
    );
    expect(
      (
        await t
          .http()
          .get(`/v1/manage/spaces/${space.id}`)
          .set(...bearer(ana))
      ).status,
    ).toBe(200);
  });

  it('reserva pelo MCP: no espaço ou Pix; cartão recusado; canal MCP e auditoria com o cliente', async () => {
    const auth = bearerOf(anaToken.access_token);
    const card = await book(auth, { paymentOption: 'ONLINE_CARD', cardToken: 'tok_teste' });
    expect(card.status).toBe(403);
    expect(card.body.error.code).toBe('OAUTH_PAYMENT_OPTION_NOT_ALLOWED');
    expect(await t.db.select().from(bookings).where(eq(bookings.organizerUserId, ana.id))).toEqual(
      [],
    );

    const created = await book(auth, { paymentOption: 'ON_SITE' });
    expect(created.status).toBe(201);
    const [row] = await t.db
      .select({ channel: bookings.channel, source: bookings.source })
      .from(bookings)
      .where(eq(bookings.id, created.body.id));
    expect(row).toEqual({ channel: 'MCP', source: 'APP' });

    const cancelled = await t
      .http()
      .post(`/v1/bookings/${created.body.id}/cancel`)
      .set(...auth)
      .send({});
    expect(cancelled.status).toBe(200);

    const logs = await t.db
      .select({ action: auditLogs.action, actorId: auditLogs.actorId, diff: auditLogs.diff })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, ana.id), eq(auditLogs.action, 'mcp.request')));
    expect(logs.map((log) => log.diff)).toEqual(
      expect.arrayContaining([
        { method: 'POST', path: '/v1/bookings', origin: 'MCP', oauthClientId: CLIENT_ID },
        {
          method: 'POST',
          path: `/v1/bookings/${created.body.id}/cancel`,
          origin: 'MCP',
          oauthClientId: CLIENT_ID,
        },
      ]),
    );
    // Leituras não vão para a auditoria.
    expect(logs.every((log) => (log.diff as { method: string }).method !== 'GET')).toBe(true);

    // Pela sessão do app, o canal é DIRECT e nada de `mcp.request`.
    const direct = await book(bearer(bob), { startsAt: slotIn(30 * 60).toISOString() });
    expect(direct.status).toBe(201);
    const [directRow] = await t.db
      .select({ channel: bookings.channel })
      .from(bookings)
      .where(eq(bookings.id, direct.body.id));
    expect(directRow?.channel).toBe('DIRECT');
    const bobLogs = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, bob.id), eq(auditLogs.action, 'mcp.request')));
    expect(bobLogs).toEqual([]);

    // Reserva de outro usuário pelo token da Ana: some, como no app (sem IDOR).
    const other = await t
      .http()
      .get(`/v1/bookings/${direct.body.id}`)
      .set(...auth);
    expect(other.status).toBe(404);
  });

  it('decisão 119 (BUG-MCP-2): pelo MCP, conta sem nome ou telefone não reserva (422 PROFILE_INCOMPLETE)', async () => {
    const cid = await signUp(t, 'cid.token@exemplo.com', 'Cid');
    const cidToken = await connect(t, cid);
    // O consentimento já exige o cadastro completo; aqui a conta perde o telefone depois.
    await t.db.update(users).set({ phone: null }).where(eq(users.id, cid.id));
    const res = await book(bearerOf(cidToken.access_token), {
      paymentOption: 'ON_SITE',
      startsAt: slotIn(34 * 60).toISOString(),
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      message: expect.stringContaining('Complete seu cadastro'),
      details: { missing: ['phone'] },
    });
    expect(await t.db.select().from(bookings).where(eq(bookings.organizerUserId, cid.id))).toEqual(
      [],
    );
    // Leituras seguem liberadas (a regra é da reserva, que leva o contato do organizador).
    const list = await t
      .http()
      .get('/v1/bookings')
      .set(...bearerOf(cidToken.access_token));
    expect(list.status).toBe(200);
    // Só o contexto MCP: a sessão do app segue a regra do app (a tela de completar cadastro).
    const direct = await book(bearer(cid), { startsAt: slotIn(38 * 60).toISOString() });
    expect(direct.status).toBe(201);
  });

  it('grava o último uso da conexão sem escrever a cada requisição', async () => {
    const lastUsed = async () => {
      const [row] = await t.db
        .select({ lastUsedAt: oauthConsents.lastUsedAt })
        .from(oauthConsents)
        .where(and(eq(oauthConsents.userId, ana.id), eq(oauthConsents.clientId, CLIENT_ID)));
      return row?.lastUsedAt ?? null;
    };
    const deadline = Date.now() + 2_000;
    while (!(await lastUsed()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await t
      .http()
      .get('/v1/bookings')
      .set(...bearerOf(anaToken.access_token));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await lastUsed()).toEqual(first);
  });

  it('conta bloqueada, inativa ou excluída: 401, e o refresh também falha', async () => {
    const carla = await signUp(t, 'carla.token@exemplo.com', 'Carla');
    const token = await connect(t, carla);
    const auth = bearerOf(token.access_token);
    const setUser = (values: Partial<typeof users.$inferInsert>) =>
      t.db.update(users).set(values).where(eq(users.id, carla.id));

    await setUser({ status: 'BLOCKED' });
    let res = await t
      .http()
      .get('/v1/bookings')
      .set(...auth);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_BLOCKED');
    const refused = await refresh(t, token.refresh_token as string);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_grant');

    await setUser({ status: 'INACTIVE' });
    res = await t
      .http()
      .get('/v1/bookings')
      .set(...auth);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');

    await setUser({ status: 'ACTIVE', deletedAt: new Date() });
    res = await t
      .http()
      .get('/v1/bookings')
      .set(...auth);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('OAUTH_TOKEN_INVALID');
  });

  it('escopos efetivos: os do token que o consentimento atual ainda cobre', async () => {
    const where = and(eq(oauthConsents.userId, ana.id), eq(oauthConsents.clientId, CLIENT_ID));
    const [consent] = await t.db
      .select({ scopes: oauthConsents.scopes })
      .from(oauthConsents)
      .where(where);
    await t.db
      .update(oauthConsents)
      .set({ scopes: ['spaces:read', 'offline_access'] })
      .where(where);
    try {
      const auth = bearerOf(anaToken.access_token);
      const res = await t
        .http()
        .get('/v1/bookings')
        .set(...auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('OAUTH_INSUFFICIENT_SCOPE');
      const spaces = await t
        .http()
        .get('/v1/spaces')
        .set(...auth);
      expect(spaces.status).toBe(200);
    } finally {
      await t.db
        .update(oauthConsents)
        .set({ scopes: consent?.scopes ?? [] })
        .where(where);
    }
  });

  it('disponibilidade com excludeBookingId usa o usuário do token do MCP', async () => {
    const startsAt = slotIn(50 * 60);
    const created = await book(bearerOf(anaToken.access_token), {
      startsAt: startsAt.toISOString(),
    });
    expect(created.status).toBe(201);
    const query = {
      date: utcToZoned(startsAt, 'America/Sao_Paulo').date,
      durationMin: 60,
      sportId: space.sportId,
      excludeBookingId: created.body.id,
    };
    const own = await t
      .http()
      .get(`/v1/spaces/${space.id}/availability`)
      .query(query)
      .set(...bearerOf(anaToken.access_token));
    expect(own.status).toBe(200);
    // A reserva de outra pessoa não serve para ignorar o horário (como no app).
    const other = await t
      .http()
      .get(`/v1/spaces/${space.id}/availability`)
      .query(query)
      .set(...bearerOf(bobToken.access_token));
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('IDOR: a reserva de outra pessoa não é cancelada pelo token do MCP', async () => {
    const bobBooking = await book(bearer(bob), { startsAt: slotIn(54 * 60).toISOString() });
    expect(bobBooking.status).toBe(201);
    const res = await t
      .http()
      .post(`/v1/bookings/${bobBooking.body.id}/cancel`)
      .set(...bearerOf(anaToken.access_token))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    const [row] = await t.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bobBooking.body.id));
    expect(row?.status).toBe('CONFIRMED');
  });

  it('aulas: presença só nas próprias turmas (IDOR) e colegas pelo primeiro nome, sem foto', async () => {
    const teacher = await member(t, 'prof.token@exemplo.com', space.id, 'TEACHER');
    const teacherId = await teacherMemberId(t.db, teacher.id, space.id);
    const mine = await insertGroup(t.db, space, teacherId);
    const others = await insertGroup(t.db, space, teacherId);
    const bruno = await signUp(t, 'bruno.token@exemplo.com', 'Bruno Costa');
    await t.db
      .update(users)
      .set({ avatarUrl: 'https://exemplo.com/bruno.png' })
      .where(eq(users.id, bruno.id));
    const enrollIn = (userId: string, classGroupId: string) =>
      enroll(t.db, { userId, spaceId: space.id, sportId: space.sportId, classGroupId });
    await enrollIn(ana.id, mine.id);
    await enrollIn(bruno.id, mine.id);
    await enrollIn(bruno.id, others.id);
    const open = { status: 'OPEN' as const, openedAt: new Date() };
    const session = await insertSession(t.db, mine, 180, open);
    const othersSession = await insertSession(t.db, others, 180, open);
    await confirm(t.db, session.id, bruno.id);
    await confirm(t.db, othersSession.id, bruno.id);
    const auth = bearerOf(anaToken.access_token);

    // Aula de outra turma: nem ver, nem confirmar, nem desmarcar a presença de quem está nela.
    for (const res of [
      await t
        .http()
        .get(`/v1/me/class-sessions/${othersSession.id}`)
        .set(...auth),
      await t
        .http()
        .post(`/v1/me/class-sessions/${othersSession.id}/attendance`)
        .set(...auth),
      await t
        .http()
        .delete(`/v1/me/class-sessions/${othersSession.id}/attendance`)
        .set(...auth),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLASS_SESSION_NOT_FOUND');
    }
    expect((await listOf(t.db, othersSession.id)).get(bruno.id)?.status).toBe('CONFIRMED');
    expect((await listOf(t.db, othersSession.id)).has(ana.id)).toBe(false);

    // Na própria turma: confirma, e o colega aparece só pelo primeiro nome, sem foto.
    const confirmed = await t
      .http()
      .post(`/v1/me/class-sessions/${session.id}/attendance`)
      .set(...auth);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmed).toEqual(
      expect.arrayContaining([
        { userId: bruno.id, name: 'Bruno', avatarUrl: null },
        { userId: ana.id, name: 'Ana', avatarUrl: null },
      ]),
    );
    // Pela sessão do app, a lista segue como antes.
    const viaApp = await t
      .http()
      .get(`/v1/me/class-sessions/${session.id}`)
      .set(...bearer(ana));
    expect(viaApp.body.confirmed).toEqual(
      expect.arrayContaining([
        { userId: bruno.id, name: 'Bruno Costa', avatarUrl: 'https://exemplo.com/bruno.png' },
      ]),
    );
  });

  it('o token do MCP nunca vira sessão do Better Auth', async () => {
    const res = await t
      .http()
      .get('/v1/auth/get-session')
      .set(...bearerOf(anaToken.access_token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
  });
});

describe('MCP_ENABLED=false', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createMcpTestApp({ env: { MCP_ENABLED: 'false' } });
  });
  afterAll(() => t?.close());

  it('todo token do MCP recebe 503 MCP_DISABLED; a sessão do app segue normal', async () => {
    const user = await signUp(t, 'off.token@exemplo.com');
    const jwtLike = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.YXNzaW5hdHVyYQ';
    for (const path of ['/v1/bookings', '/v1/spaces', '/v1/me', '/v1/manage/spaces/x']) {
      const res = await t
        .http()
        .get(path)
        .set(...bearerOf(jwtLike));
      expect(res.status, path).toBe(503);
      expect(res.body.error.code).toBe('MCP_DISABLED');
    }
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearer(user))
      ).status,
    ).toBe(200);
  });
});
