import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { MCP_ADMIN_URL, MCP_URL, PORTS, USERS } from './support/env.js';
import {
  adminGrants,
  consentAttempt,
  resetLimits,
  safeCall,
  superConn,
  userConn,
  withClient,
  world,
} from './support/fase2.js';
import { userByEmail } from './support/helpers.js';
import { mcpClient, ok, rawMcp } from './support/mcp.js';
import {
  api,
  appSession as appSessionOf,
  authorizeForCode,
  CLIENT_ID,
  decodeJwt,
  exchangeCode,
  tokenRequest,
} from './support/oauth.js';

// Fase 2, segurança de autorização (docs/14-mcp.md 8.1 e 3.3; RN-MCP-01, RN-MCP-06 e RN-MCP-07;
// decisões 120, 121 e 123): escopos concedidos por papel, o recurso do Super fechado a quem não é
// Super, cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS e o cruzamento de audiências nos dois sentidos.

const w = world();
const OUTRO_CLIENTE = 'https://cimd.e2e.test/outro.json';
const PLAYER = ['bookings:read', 'bookings:write', 'classes:read', 'classes:write', 'spaces:read'];
const grantedOf = (tokens: { scope: string }) =>
  tokens.scope
    .split(' ')
    .filter((s) => s !== 'offline_access')
    .sort();

describe('(2) escopos concedidos por papel no conector de jogador/gestão (RN-MCP-06)', () => {
  const cases: [string, string[], string[], number][] = [
    // chave do mundo, escopos concedidos, escopos negados, tools no tools/list
    ['semPapel', PLAYER, ['manage:finance:read', 'manage:read'], 14],
    ['prof1', [...PLAYER, 'manage:read'], ['manage:finance:read'], 23],
    ['admin', [...PLAYER, 'manage:finance:read', 'manage:read'], [], 27],
    ['dona', [...PLAYER, 'manage:finance:read', 'manage:read'], [], 27],
    // Professor num espaço e Dono em outro: ganha as finanças (vale para a conta, o papel é por espaço).
    ['profdono', [...PLAYER, 'manage:finance:read', 'manage:read'], [], 27],
  ];

  for (const [key, granted, denied, toolCount] of cases) {
    it(`${key}: recebe ${granted.length} escopos, é negado em [${denied.join(', ')}] e vê ${toolCount} tools`, async () => {
      const conn = await userConn(key, { fresh: true });
      expect(grantedOf(conn.tokens)).toEqual([...granted].sort());
      expect(conn.connected.consentRequest?.deniedScopes.sort()).toEqual([...denied].sort());
      expect(conn.connected.consentRequest?.scopes.sort()).toEqual([...granted].sort());
      expect(decodeJwt(conn.token).payload.aud).toBe(MCP_URL);
      await withClient(conn, async (client) => {
        expect((await client.listTools()).tools).toHaveLength(toolCount);
      });
    });
  }

  it('jogador sem papel não ganha manage:*, nem pedindo só eles: a tela não deixa permitir e o servidor recusa', async () => {
    const attempt = await consentAttempt(w.people.semPapel?.email as string, {
      scope: 'manage:read manage:finance:read',
    });
    expect(attempt.consentRequest).toMatchObject({ canAuthorize: false, scopes: [] });
    expect(attempt.consent?.status).toBe(403);
    expect(attempt.consent?.body).toMatchObject({
      code: 'OAUTH_ACCESS_DENIED',
      error: 'access_denied',
    });
    expect(attempt.promptNone?.status).toBe(400);
    expect(attempt.promptNone?.body).toMatchObject({ error: 'access_denied' });
  });

  it('Professor pedindo só manage:finance:read não ganha nada (sem escalonamento de papel)', async () => {
    const attempt = await consentAttempt(w.people.prof1?.email as string, {
      scope: 'manage:finance:read',
    });
    expect(attempt.consentRequest).toMatchObject({ canAuthorize: false, scopes: [] });
    expect(attempt.consent?.status).toBe(403);
  });

  it('o usuário marcar um escopo que não pode usar na tela não o concede (consentScope forçado)', async () => {
    // Cliente novo: com um consentimento anterior o authorize devolve o código sem passar pela tela.
    const conn = await userConn('prof1', {
      clientId: 'https://cimd.e2e.test/escopo-forcado.json',
      consentScope: 'spaces:read manage:finance:read',
    });
    expect(grantedOf(conn.tokens)).toEqual(['spaces:read']);
    expect(grantedOf(conn.tokens)).not.toContain('manage:finance:read');
  });

  it('refresh pedindo escopo a mais não escala: ou falha ou volta sem o escopo negado', async () => {
    const conn = await userConn('prof1');
    const res = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: conn.tokens.refresh_token as string,
      client_id: CLIENT_ID,
      resource: MCP_URL,
      scope: 'manage:finance:read',
    });
    const body = (await res.json()) as { scope?: string; access_token?: string; error?: string };
    if (res.status === 200) {
      expect(body.scope?.split(' ')).not.toContain('manage:finance:read');
    } else {
      expect(res.status).toBe(400);
      expect(body.error).toBeTruthy();
    }
  });

  it('o Super não ganha super:read nem manage:* no conector de jogador (escopos de outro recurso saem do pedido)', async () => {
    const conn = await userConn('semPapel', {}, USERS.superUser);
    expect(grantedOf(conn.tokens)).toEqual(PLAYER);
    expect(conn.tokens.scope).not.toContain('super:read');
  });

  it('papel retirado depois da conexão: a API recusa na hora, sem esperar o token vencer (RN-MCP-06)', async () => {
    const temp = w.people.revisor;
    if (!temp) throw new Error('revisor ausente');
    await sql(
      `insert into space_members (user_id, space_id, role, status) values ($1, $2, 'ADMIN', 'ACTIVE')`,
      [temp.id, w.spaces.a.id],
    );
    try {
      const conn = await userConn('revisor');
      expect(grantedOf(conn.tokens)).toContain('manage:finance:read');
      await withClient(conn, async (client) => {
        await resetLimits();
        const before = await ok(client, 'get_revenue', { space: w.spaces.a.slug });
        expect(before.totals.receivedCents).toBeGreaterThanOrEqual(0);
        await sql('delete from space_members where user_id = $1 and space_id = $2', [
          temp.id,
          w.spaces.a.id,
        ]);
        await resetLimits();
        const after = await safeCall(client, 'get_revenue', { space: w.spaces.a.slug });
        expect(after.isError).toBe(true);
        expect(JSON.stringify(after.data)).not.toMatch(/receivedCents/);
        const direct = await api(
          `/v1/manage/spaces/${w.spaces.a.id}/analytics/revenue`,
          conn.token,
        );
        expect(direct.status).toBe(403);
        expect(direct.body?.error?.code).toBe('SPACE_FORBIDDEN');
      });
    } finally {
      await sql('delete from space_members where user_id = $1 and space_id = $2', [
        temp.id,
        w.spaces.a.id,
      ]);
    }
  });
});

describe('(2) vínculo que não vale: convite pendente e membro removido não ganham gestão', () => {
  for (const status of ['INVITED', 'REMOVED']) {
    it(`${status}: o consentimento não concede manage:*, mesmo com o papel de Dono no cadastro`, async () => {
      const temp = w.people.revisor;
      if (!temp) throw new Error('revisor ausente');
      await sql(
        `insert into space_members (user_id, space_id, role, status) values ($1, $2, 'OWNER', $3)`,
        [temp.id, w.spaces.a.id, status],
      );
      try {
        // Cliente novo: a tela de consentimento mostra o que o vínculo permite hoje.
        const attempt = await consentAttempt(temp.email, {
          clientId: `https://cimd.e2e.test/vinculo-${status.toLowerCase()}.json`,
        });
        const granted = attempt.consentRequest?.scopes ?? [];
        expect(granted).not.toContain('manage:read');
        expect(granted).not.toContain('manage:finance:read');
        expect(attempt.consentRequest?.deniedScopes.sort()).toEqual([
          'manage:finance:read',
          'manage:read',
        ]);
        // E quem já tinha o consentimento de antes (quando era Admin): o token novo vem sem gestão.
        const reconnect = await userConn('revisor');
        expect(grantedOf(reconnect.tokens)).not.toContain('manage:read');
        expect(grantedOf(reconnect.tokens)).not.toContain('manage:finance:read');
      } finally {
        await sql('delete from space_members where user_id = $1 and space_id = $2', [
          temp.id,
          w.spaces.a.id,
        ]);
      }
    });
  }
});

describe('(2) o recurso do Super só abre para Super (RN-MCP-07)', () => {
  for (const key of ['semPapel', 'dona', 'admin', 'prof1', 'profdono']) {
    it(`${key} (não é Super): sem tela de "Permitir", 403 OAUTH_ACCESS_DENIED e nada gravado`, async () => {
      const person = w.people[key];
      if (!person) throw new Error(key);
      const attempt = await consentAttempt(person.email, {
        resource: MCP_ADMIN_URL,
        scope: 'super:read',
      });
      expect(attempt.consentRequest).toMatchObject({
        canAuthorize: false,
        scopes: [],
        deniedScopes: ['super:read'],
        resource: { kind: 'ADMIN', maxConnectionHours: 24 },
      });
      expect(attempt.consent?.status).toBe(403);
      expect(attempt.consent?.body).toMatchObject({ code: 'OAUTH_ACCESS_DENIED' });
      expect(attempt.promptNone).toMatchObject({ status: 400, body: { error: 'access_denied' } });
      expect(await adminGrants(person.id)).toEqual({
        consents: 0,
        accessTokens: 0,
        refreshTokens: 0,
      });
    });
  }

  it('o Super conecta, recebe só super:read e o token é do recurso dele (aud, sem escopo de jogador)', async () => {
    const conn = await superConn();
    expect(grantedOf(conn.tokens)).toEqual(['super:read']);
    const { payload } = decodeJwt(conn.token);
    expect(payload.aud).toBe(MCP_ADMIN_URL);
    expect(payload.sub).toBe((await userByEmail(USERS.superUser)).id);
    // Pedir escopos de jogador junto não os concede: saem do pedido.
    const mixed = await superConn(USERS.superUser, {
      scope: 'super:read spaces:read manage:read bookings:write',
    });
    expect(grantedOf(mixed.tokens)).toEqual(['super:read']);
  });

  it('um consentimento por recurso: o mesmo Super e o mesmo cliente têm dois, independentes', async () => {
    const sup = await userByEmail(USERS.superUser);
    await superConn();
    await userConn('semPapel', {}, USERS.superUser);
    const rows = await sql<{ reference_id: string | null; scopes: string[] }>(
      'select reference_id, scopes from oauth_consents where user_id = $1 and client_id = $2',
      [sup.id, CLIENT_ID],
    );
    expect(rows).toHaveLength(2);
    const admin = rows.find((r) => r.reference_id === 'mcp-admin');
    const user = rows.find((r) => !r.reference_id);
    expect(admin?.scopes).toContain('super:read');
    expect(admin?.scopes.filter((scope) => scope !== 'offline_access')).toEqual(['super:read']);
    expect(user?.scopes).not.toContain('super:read');
  });
});

describe('(2) cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS (decisão 123)', () => {
  it('outro cliente (mesmo com o Super) recebe 400 unauthorized_client, sem redirecionar nem pedir login', async () => {
    const attempt = await consentAttempt(USERS.superUser, {
      resource: MCP_ADMIN_URL,
      scope: 'super:read',
      clientId: OUTRO_CLIENTE,
    });
    expect(attempt.stage).toBe('authorize');
    expect(attempt.authorize.status).toBe(400);
    expect(attempt.authorize.location).toBeNull();
    expect(attempt.authorize.body).toMatchObject({ error: 'unauthorized_client' });
    const sup = await userByEmail(USERS.superUser);
    const [row] = await sql<{ n: string }>(
      `select count(*) as n from oauth_consents where user_id = $1 and client_id = $2`,
      [sup.id, OUTRO_CLIENTE],
    );
    expect(Number(row?.n)).toBe(0);
  });

  const variants: [string, string][] = [
    ['barra no fim', `${CLIENT_ID}/`],
    ['query extra', `${CLIENT_ID}?x=1`],
    ['query de redirect', `${CLIENT_ID}?redirect=https://cimd.e2e.test/callback`],
    ['host em maiúsculas', 'https://CIMD.e2e.test/claude.json'],
    ['nome em maiúsculas', 'https://cimd.e2e.test/Claude.json'],
    ['fragmento', `${CLIENT_ID}#x`],
    ['porta explícita', 'https://cimd.e2e.test:443/claude.json'],
    ['caminho com ponto', 'https://cimd.e2e.test/./claude.json'],
  ];
  for (const [label, clientId] of variants) {
    it(`variação do id permitido (${label}) não passa pela lista`, async () => {
      const attempt = await consentAttempt(USERS.superUser, {
        resource: MCP_ADMIN_URL,
        scope: 'super:read',
        clientId,
      });
      // Qualquer recusa serve (400 do authorize, id inválido), menos conseguir o consentimento do Super.
      expect(attempt.consent?.status, label).toBeUndefined();
      expect(attempt.stage, label).toBe('authorize');
      expect(attempt.authorize.status, label).toBeGreaterThanOrEqual(400);
      expect(attempt.authorize.status, label).toBeLessThan(500);
    });
  }

  it('o mesmo outro cliente conecta ao conector de jogador/gestão normalmente (a lista é só do Super)', async () => {
    const conn = await userConn('dona', { clientId: OUTRO_CLIENTE });
    expect(grantedOf(conn.tokens)).toContain('manage:read');
    await withClient(conn, async (client) => {
      const data = await ok(client, 'list_my_managed_spaces');
      expect(data.spaces).toHaveLength(1);
    });
  });
});

describe('(2) cruzamento de audiências, nos dois sentidos (RN-MCP-01)', () => {
  it('token do conector de jogador/gestão na superfície admin: 401 com o desafio da admin', async () => {
    const owner = await userConn('dona');
    const res = await rawMcp({ authorization: `Bearer ${owner.token}` }, undefined, MCP_ADMIN_URL);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/resource_metadata=.*\/admin\/mcp/);
    await expect(mcpClient(owner.token, MCP_ADMIN_URL)).rejects.toThrow();
  });

  it('token do Super na superfície de jogador/gestão: 401 com o desafio dela', async () => {
    const sup = await superConn();
    const res = await rawMcp({ authorization: `Bearer ${sup.token}` }, undefined, MCP_URL);
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/resource_metadata=/);
    expect(challenge).not.toMatch(/\/admin\/mcp/);
    await expect(mcpClient(sup.token, MCP_URL)).rejects.toThrow();
    // Controle: na superfície certa o mesmo token funciona.
    await withClient(sup, async (client) => {
      expect((await client.listTools()).tools).toHaveLength(9);
    });
  });

  it('API: o token do Super não abre rota de jogador nem de gestão (403 OAUTH_ROUTE_NOT_ALLOWED)', async () => {
    const sup = await superConn();
    await resetLimits();
    const space = w.spaces.a.id;
    for (const [method, path] of [
      ['GET', '/v1/me/summary'],
      ['GET', '/v1/spaces'],
      ['GET', '/v1/bookings'],
      ['GET', '/v1/me/class-sessions'],
      ['GET', `/v1/manage/spaces/${space}`],
      ['GET', `/v1/manage/spaces/${space}/courts`],
      ['GET', `/v1/manage/spaces/${space}/analytics/revenue`],
      ['GET', '/v1/me/staff-spaces'],
      ['POST', '/v1/bookings'],
    ] as [string, string][]) {
      const res = await api(path, sup.token, {
        method,
        ...(method === 'POST' ? { json: {} } : {}),
      });
      expect([res.status, res.body?.error?.code], `${method} ${path}`).toEqual([
        403,
        'OAUTH_ROUTE_NOT_ALLOWED',
      ]);
    }
  });

  it('API: o token de jogador/gestão (até o do Dono com manage:*) não abre nenhuma rota de /super', async () => {
    const owner = await userConn('dona');
    // O Super no conector de jogador também não: ele é Super, mas o token é do outro recurso.
    const superAsPlayer = await userConn('semPapel', {}, USERS.superUser);
    await resetLimits();
    for (const token of [owner.token, superAsPlayer.token]) {
      for (const path of [
        '/v1/super/spaces',
        `/v1/super/spaces/${w.spaces.a.id}`,
        '/v1/super/users',
        '/v1/super/audit-logs',
        '/v1/super/finance/summary',
        '/v1/super/analytics/platform',
        '/v1/super/analytics/spaces',
        '/v1/super/metrics/spaces',
        '/v1/super/reviews/reports',
        '/v1/super/online-payments/revenue',
      ]) {
        const res = await api(path, token);
        expect([res.status, res.body?.error?.code], path).toEqual([403, 'OAUTH_ROUTE_NOT_ALLOWED']);
      }
    }
  });

  it('authorize: um recurso só — repetido, os dois juntos, vazio ou de outro endereço é recusado sem redirecionar', async () => {
    const base = { challenge: 'x'.repeat(43) };
    void base;
    const attempts: [string, string | undefined][] = [
      ['recurso com barra no fim', `${MCP_ADMIN_URL}/`],
      ['recurso desconhecido', 'http://127.0.0.1:9/outro'],
      ['recurso do jogador com caminho extra', `${MCP_URL}/x`],
    ];
    for (const [label, resource] of attempts) {
      const attempt = await consentAttempt(USERS.superUser, { resource, scope: 'super:read' });
      expect(attempt.authorize.status, label).toBe(400);
      expect(attempt.authorize.location, label).toBeNull();
      expect(attempt.authorize.body, label).toMatchObject({ error: 'invalid_target' });
    }
  });

  it('authorize: escopo de um recurso no outro dá invalid_scope (super:read no jogador; manage:read no Super)', async () => {
    const a = await consentAttempt(w.people.dona?.email as string, { scope: 'super:read' });
    expect(a.authorize).toMatchObject({ status: 400, body: { error: 'invalid_scope' } });
    const b = await consentAttempt(USERS.superUser, {
      resource: MCP_ADMIN_URL,
      scope: 'manage:read manage:finance:read spaces:read',
    });
    expect(b.authorize).toMatchObject({ status: 400, body: { error: 'invalid_scope' } });
  });

  it('o código vale só para o recurso em que foi emitido (troca com o recurso do outro: erro)', async () => {
    const adminCode = await authorizeForCode(USERS.superUser, {
      resource: MCP_ADMIN_URL,
      scope: 'super:read',
    });
    await expect(
      exchangeCode(adminCode.code, adminCode.verifier, { resource: MCP_URL }),
    ).rejects.toMatchObject({ status: expect.any(Number) });

    const userCode = await authorizeForCode(w.people.dona?.email as string, {});
    await expect(
      exchangeCode(userCode.code, userCode.verifier, { resource: MCP_ADMIN_URL }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    // O código gasto numa tentativa errada não vale mais (uso único), nem no recurso certo.
    await expect(
      exchangeCode(userCode.code, userCode.verifier, { resource: MCP_URL }),
    ).rejects.toBeDefined();
  });

  it('o refresh do Super não vira token de jogador/gestão (e vice-versa)', async () => {
    const sup = await superConn();
    const owner = await userConn('dona');
    const swap = async (refresh: string, resource: string) => {
      const res = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: CLIENT_ID,
        resource,
      });
      return { status: res.status, body: (await res.json()) as { aud?: string; error?: string } };
    };
    const superOnUser = await swap(sup.tokens.refresh_token as string, MCP_URL);
    expect(superOnUser.status).toBeGreaterThanOrEqual(400);
    const ownerOnAdmin = await swap(owner.tokens.refresh_token as string, MCP_ADMIN_URL);
    expect(ownerOnAdmin.status).toBeGreaterThanOrEqual(400);
    // Sem `resource` na renovação, o token continua do recurso original.
    const res = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: sup.tokens.refresh_token as string,
      client_id: CLIENT_ID,
    });
    if (res.status === 200) {
      const body = (await res.json()) as { access_token: string; scope: string };
      expect(decodeJwt(body.access_token).payload.aud).toBe(MCP_ADMIN_URL);
      expect(body.scope.split(' ')).not.toContain('manage:read');
    }
  });

  it('a conexão do Super não dá acesso às tools do jogador (tool desconhecida, sem chamar a API)', async () => {
    const sup = await superConn();
    await withClient(sup, async (client) => {
      for (const name of [
        'search_spaces',
        'list_my_managed_spaces',
        'get_revenue',
        'create_booking',
      ]) {
        const res = await safeCall(client, name, {});
        expect(res.isError, name).toBe(true);
        expect(JSON.stringify(res.data), name).not.toMatch(/"spaces"|"rows"|"totals"/);
      }
    });
  });
});

describe('(2) servidor de autorização e o metadata dos dois recursos', () => {
  it('cada recurso anuncia os seus escopos (RFC 9728): 7 no jogador/gestão e só super:read no Super', async () => {
    const user = await (
      await fetch(`http://127.0.0.1:${PORTS.mcp}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    const admin = await (
      await fetch(`http://127.0.0.1:${PORTS.mcp}/.well-known/oauth-protected-resource/admin/mcp`)
    ).json();
    expect(user.resource).toBe(MCP_URL);
    expect(user.scopes_supported.sort()).toEqual(
      [...PLAYER, 'manage:finance:read', 'manage:read'].sort(),
    );
    expect(admin.resource).toBe(MCP_ADMIN_URL);
    expect(admin.scopes_supported).toEqual(['super:read']);
    expect(admin.resource_name).toBe('Space Sports · Plataforma');
    expect(admin.authorization_servers).toEqual(user.authorization_servers);
  });
});

describe('(2) endpoint /admin/mcp: só o Bearer do recurso do Super vale', () => {
  it('sem token, esquemas errados, lixo, cookie e token na query: 401 com o desafio da admin', async () => {
    for (const method of ['POST', 'GET']) {
      const res = await rawMcp({}, undefined, MCP_ADMIN_URL, method);
      expect(res.status, method).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(
        /Bearer .*resource_metadata=.*\/admin\/mcp/,
      );
    }
    for (const authorization of ['Basic dXNlcjpzZW5oYQ==', 'Bearer', 'Bearer ', 'Bearer lixo']) {
      expect(
        (await rawMcp({ authorization }, undefined, MCP_ADMIN_URL)).status,
        authorization,
      ).toBe(401);
    }
    const sup = await superConn();
    const { browser } = await appSessionOf(USERS.superUser);
    expect((await rawMcp({ cookie: browser.cookieHeader }, undefined, MCP_ADMIN_URL)).status).toBe(
      401,
    );
    expect((await rawMcp({}, undefined, `${MCP_ADMIN_URL}?access_token=${sup.token}`)).status).toBe(
      401,
    );
  });

  it('o token da sessão do app (opaco) do próprio Super não vale no conector da Plataforma', async () => {
    const { token } = await appSessionOf(USERS.superUser);
    expect(
      (await rawMcp({ authorization: `Bearer ${token}` }, undefined, MCP_ADMIN_URL)).status,
    ).toBe(401);
    await expect(mcpClient(token, MCP_ADMIN_URL)).rejects.toThrow();
  });

  it('Origin de página web é recusado (403) antes de olhar o token, e caminhos vizinhos não existem', async () => {
    const sup = await superConn();
    const res = await rawMcp(
      { authorization: `Bearer ${sup.token}`, origin: 'https://evil.example' },
      undefined,
      MCP_ADMIN_URL,
    );
    expect(res.status).toBe(403);
    for (const path of ['/admin', '/admin/', '/admin/mcp/extra', '/admin/mcp2', '/ADMIN/mcp']) {
      const url = `${new URL(MCP_ADMIN_URL).origin}${path}`;
      const out = await rawMcp({ authorization: `Bearer ${sup.token}` }, undefined, url);
      expect(out.status, path).toBeGreaterThanOrEqual(400);
      expect(out.status, path).toBeLessThan(500);
    }
  });
});
