import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MCP_MANAGE_SCOPES, MCP_OAUTH_SCOPES } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { API_URL, MCP_URL, USERS } from './support/env.js';
import {
  apiBookingBody,
  freshPlayerToken,
  pickSlot,
  spaceId,
  userByEmail,
} from './support/helpers.js';
import { mcpClient, ok, rawMcp } from './support/mcp.js';
import { api, appSession, connect, decodeJwt } from './support/oauth.js';

/** As 12 operações que aceitam o token do MCP (docs/14-mcp.md, 3.3): `@OAuthScopes` no handler. */
const ALLOWED = new Set([
  'GET /v1/spaces',
  'GET /v1/spaces/{slug}',
  'GET /v1/spaces/{spaceId}/availability',
  'GET /v1/spaces/{slug}/classes',
  'GET /v1/bookings',
  'GET /v1/bookings/{bookingId}',
  'POST /v1/bookings',
  'POST /v1/bookings/{bookingId}/cancel',
  'GET /v1/me/class-sessions',
  'GET /v1/me/class-sessions/{sessionId}',
  'POST /v1/me/class-sessions/{sessionId}/attendance',
  'DELETE /v1/me/class-sessions/{sessionId}/attendance',
  'GET /v1/me/summary',
]);

const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

/** Conexão de jogador e gestão (fase 2, decisões 120 e 121): o que o Dono autoriza no conector. */
const MANAGE_CONNECTION = [...MCP_OAUTH_SCOPES, ...MCP_MANAGE_SCOPES].join(' ');

/** Todas as operações do OpenAPI da API (contrato gerado), com os parâmetros de rota preenchidos. */
function openApiOperations() {
  const file = resolve(import.meta.dirname, '../../../packages/api-client/openapi.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as {
    paths: Record<string, Record<string, { 'x-oauth-scopes'?: string[] } | undefined>>;
  };
  const operations: { method: string; path: string; url: string; scopes: string[] }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method];
      if (!operation) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        url: path.replace(/\{[^}]+\}/g, PLACEHOLDER),
        scopes: operation['x-oauth-scopes'] ?? [],
      });
    }
  }
  return operations;
}

/** Leitura de gestão da lista (MCP2.1): o token de jogador, sem `manage:*`, recebe o 403 de escopo. */
const isManageRead = (op: { scopes: string[] }) =>
  op.scopes.some((scope) => scope.startsWith('manage:'));

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Chamada à API que o token do MCP não pode fazer: 403 com o código estável de rota fora da lista. */
async function expectNotAllowed(token: string, method: string, path: string, json?: unknown) {
  const res = await api(path, token, { method, ...(json !== undefined ? { json } : {}) });
  expect(
    [res.status, res.body?.error?.code],
    `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`,
  ).toEqual([403, 'OAUTH_ROUTE_NOT_ALLOWED']);
}

describe('(2) segurança — sem token e token de outra audiência (RN-MCP-01)', () => {
  it('sem token: POST e GET em /mcp respondem 401 com o desafio Bearer', async () => {
    for (const method of ['POST', 'GET']) {
      const res = await rawMcp({}, undefined, MCP_URL, method);
      expect(res.status, method).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/Bearer .*resource_metadata=/);
    }
  });

  it('esquemas que não são Bearer, token vazio e lixo respondem 401', async () => {
    for (const authorization of ['Basic dXNlcjpzZW5oYQ==', 'Bearer', 'Bearer ', 'Bearer lixo']) {
      expect((await rawMcp({ authorization })).status, authorization).toBe(401);
    }
  });

  it('só o cabeçalho Authorization vale: cookie de sessão e token na query não autenticam', async () => {
    const { browser } = await appSession(USERS.a);
    expect((await rawMcp({ cookie: browser.cookieHeader })).status).toBe(401);
    const mcp = await connect(USERS.a);
    const viaQuery = await rawMcp(
      {},
      undefined,
      `${MCP_URL}?access_token=${mcp.tokens.access_token}`,
    );
    expect(viaQuery.status).toBe(401);
  });

  it('a sessão normal do app (token opaco) NÃO vale no MCP', async () => {
    const { token } = await appSession(USERS.a);
    const res = await rawMcp({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    await expect(mcpClient(token)).rejects.toThrow();
  });

  it('o token do MCP NÃO vira sessão do app: /v1/auth/get-session e a rota do app respondem não', async () => {
    const mcp = await connect(USERS.a);
    const token = mcp.tokens.access_token;
    const session = await fetch(`${API_URL}/v1/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(session.status).toBeGreaterThanOrEqual(400);
    await expectNotAllowed(token, 'GET', '/v1/me');
  });

  it('token com assinatura adulterada (sub trocado para outro usuário) é recusado no MCP e na API', async () => {
    const mcp = await connect(USERS.a);
    const other = await userByEmail(USERS.b);
    const [header, , signature] = mcp.tokens.access_token.split('.');
    const payload = { ...decodeJwt(mcp.tokens.access_token).payload, sub: other.id };
    const forged = `${header}.${b64(payload)}.${signature}`;
    expect((await rawMcp({ authorization: `Bearer ${forged}` })).status).toBe(401);
    const direct = await api('/v1/me/summary', forged);
    expect([direct.status, direct.body?.error?.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
  });

  it('token sem assinatura (alg none) e token assinado com chave do atacante são recusados', async () => {
    const mcp = await connect(USERS.a);
    const { header, payload } = decodeJwt(mcp.tokens.access_token);
    const none = `${b64({ ...header, alg: 'none' })}.${b64(payload)}.`;
    const { privateKey } = generateKeyPairSync('ed25519');
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const forged = `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString('base64url')}`;
    for (const token of [none, forged]) {
      expect((await rawMcp({ authorization: `Bearer ${token}` })).status).toBe(401);
      const direct = await api('/v1/me/summary', token);
      expect(direct.status).toBe(401);
      expect(['OAUTH_TOKEN_INVALID', 'UNAUTHENTICATED']).toContain(direct.body?.error?.code);
    }
  });

  it('token emitido para OUTRA audiência (resource) não vale no MCP nem na API', async () => {
    let issued: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      issued = await connect(USERS.a, { resource: 'http://127.0.0.1:9/outro-recurso' });
    } catch {
      // O servidor de autorização recusou o recurso desconhecido: também é uma defesa válida.
      return;
    }
    const token = issued.tokens.access_token;
    expect(decodeJwt(token).payload.aud).not.toBe(MCP_URL);
    expect((await rawMcp({ authorization: `Bearer ${token}` })).status).toBe(401);
    const direct = await api('/v1/me/summary', token);
    expect([direct.status, direct.body?.error?.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
  });

  it('Origin de página web em /mcp é recusado com 403 antes de olhar o token', async () => {
    const mcp = await connect(USERS.a);
    const res = await rawMcp({
      authorization: `Bearer ${mcp.tokens.access_token}`,
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
  });
});

describe('(2) segurança — o token do MCP fora da lista permitida (decisões 112, 113 e 115)', () => {
  it('varredura: TODA operação do OpenAPI fora da lista de jogador responde 403 (rota fora da lista ou, nas leituras de gestão, escopo)', async () => {
    const operations = openApiOperations().filter((op) => !ALLOWED.has(`${op.method} ${op.path}`));
    expect(operations.length).toBeGreaterThan(150);
    const failures: string[] = [];
    let user = await freshPlayerToken();
    let writes = 0;
    let reads = 0;
    for (const op of operations) {
      // Um jogador novo a cada tanto de chamadas: os limites por usuário não podem mascarar o resultado.
      if (op.method === 'GET' ? ++reads > 45 : ++writes > 8) {
        user = await freshPlayerToken();
        reads = 0;
        writes = 0;
      }
      const res = await api(op.url, user.token, {
        method: op.method,
        ...(op.method === 'GET' || op.method === 'DELETE' ? {} : { json: {} }),
      });
      // Leituras de gestão estão na lista do recurso do jogador desde a MCP2.1, mas exigem
      // `manage:*`, que a conexão de jogador não tem (decisões 120 e 121).
      const expected = isManageRead(op)
        ? ['OAUTH_INSUFFICIENT_SCOPE', 'OAUTH_ROUTE_NOT_ALLOWED']
        : ['OAUTH_ROUTE_NOT_ALLOWED'];
      if (res.status !== 403 || !expected.includes(res.body?.error?.code)) {
        failures.push(`${op.method} ${op.path} → ${res.status} ${res.body?.error?.code ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('contas: nada mudou depois da varredura (a conta do jogador segue ativa e com o mesmo nome)', async () => {
    const { tokens } = await connect(USERS.a);
    const token = tokens.access_token;
    for (const [method, path, json] of [
      ['GET', '/v1/me'],
      ['PATCH', '/v1/me/profile', { name: 'Invasor' }],
      ['POST', '/v1/me/deactivate'],
      ['POST', '/v1/me/deletion-request'],
      ['POST', '/v1/auth/change-email', { newEmail: 'invasor@exemplo.com' }],
      ['POST', '/v1/auth/change-password', { currentPassword: 'x', newPassword: 'y-12345678' }],
      ['POST', '/v1/auth/delete-user', {}],
      ['POST', '/v1/auth/sign-out'],
    ] as [string, string, unknown?][]) {
      const res = await api(path, token, { method, ...(json !== undefined ? { json } : {}) });
      expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(
        401,
      );
      expect(res.status).toBeLessThan(500);
    }
    const [row] = await sql<{ name: string; email: string; status: string }>(
      'select name, email, status from users where email=$1',
      [USERS.a],
    );
    expect(row).toMatchObject({ name: 'Jogador E2E', status: 'ACTIVE' });
    // A senha também segue a mesma: o login do fluxo continua funcionando.
    expect((await appSession(USERS.a)).token).toBeTruthy();
  });

  it('reservas: editar e pagar fora da lista; ONLINE_CARD proibido na criação (decisão 115)', async () => {
    const { tokens } = await connect(USERS.a);
    const token = tokens.access_token;
    const mcp = await mcpClient(token);
    try {
      const slot = await pickSlot(mcp, 'arena-e2e-norte', 9);
      const prepared = await ok(mcp, 'prepare_booking', {
        space: 'arena-e2e-norte',
        date: slot.date,
        startTime: slot.startTime,
        durationMin: 60,
        peopleCount: 2,
        sport: 'futevolei',
        court: slot.court,
        paymentOption: 'ONLINE_PIX',
      });
      const body = apiBookingBody(prepared.confirmation.createBookingInput);
      const card = await api('/v1/bookings', token, {
        method: 'POST',
        json: { ...body, paymentOption: 'ONLINE_CARD', cardToken: 'tok_teste_nao_real' },
        headers: { 'Idempotency-Key': `qa-card-${Date.now()}` },
      });
      expect([card.status, card.body?.error?.code]).toEqual([
        403,
        'OAUTH_PAYMENT_OPTION_NOT_ALLOWED',
      ]);
      // Nada foi criado nesse horário.
      const rows = await sql(
        'select id from bookings where court_id=$1 and status <> $2 and lower(period) = $3',
        [body.courtId, 'CANCELLED', body.startsAt],
      ).catch(() => []);
      expect(rows).toEqual([]);
    } finally {
      await mcp.close();
    }
    // PATCH/pagamento: o id nem precisa existir, a rota é barrada antes.
    const fake = '00000000-0000-4000-8000-000000000000';
    await expectNotAllowed(token, 'PATCH', `/v1/bookings/${fake}`, { peopleCount: 3 });
    await expectNotAllowed(token, 'POST', `/v1/bookings/${fake}/payment`, { cardToken: 'tok_x' });
  });

  it('Dono do espaço: sem manage:* a gestão pede o escopo; com ele, só as leituras da lista (decisões 120 e 121)', async () => {
    const arena = await spaceId('arena-e2e');
    const manage = (path: string) => `/v1/manage/spaces/${arena}${path}`;
    // Com a sessão do app o Dono lê o próprio painel (prova de que o papel existe e a rota é válida).
    const session = await appSession(USERS.owner);
    expect((await api(manage('/courts'), session.token)).status).toBe(200);

    // Conexão de jogador: as leituras de gestão da lista exigem `manage:*`.
    const player = (await connect(USERS.owner)).tokens.access_token;
    for (const path of ['/courts', '/team', '/online-payments/wallet']) {
      const res = await api(manage(path), player);
      expect([res.status, res.body?.error?.code], path).toEqual([403, 'OAUTH_INSUFFICIENT_SCOPE']);
    }

    // Conexão com a gestão: lê o que está na lista, e nada fora dela nem escrita (somente leitura).
    const token = (await connect(USERS.owner, { scope: MANAGE_CONNECTION })).tokens.access_token;
    for (const path of ['/courts', '/team', '/online-payments/wallet']) {
      expect((await api(manage(path), token)).status, path).toBe(200);
    }
    for (const [method, path, json] of [
      ['GET', manage('/online-payments/settings')],
      ['GET', manage('/contacts')],
      ['PATCH', manage(''), { name: 'Invadida' }],
      ['POST', manage('/courts'), { name: 'Quadra Fantasma' }],
      ['PUT', manage('/online-payments/settings'), {}],
    ] as [string, string, unknown?][]) {
      await expectNotAllowed(token, method, path, json);
    }
    const [space] = await sql<{ name: string }>('select name from spaces where id=$1', [arena]);
    expect(space?.name).toBe('Arena E2E');
  });

  it('Super: o token do MCP NÃO abre /super, nem com o papel', async () => {
    const { tokens } = await connect(USERS.superUser);
    const token = tokens.access_token;
    const session = await appSession(USERS.superUser);
    expect((await api('/v1/super/users', session.token)).status).toBe(200);
    for (const [method, path] of [
      ['GET', '/v1/super/users'],
      ['GET', '/v1/super/admins'],
      ['GET', '/v1/super/deletion-requests'],
      ['GET', '/v1/super/finance/summary'],
      ['GET', '/v1/super/catalog/sports'],
      ['GET', '/v1/super/audit-logs'],
      ['GET', '/v1/super/online-payments/simulator/charges'],
      ['POST', `/v1/super/spaces/${await spaceId('arena-e2e')}/support-sessions`],
    ] as [string, string][]) {
      await expectNotAllowed(token, method, path);
    }
  });

  it('o MCP não oferece tool de conta, Super ou cartão; as de gestão só com manage:*', async () => {
    const forbidden = /admin|super|account|delete|email|password|card/i;
    const player = await mcpClient((await connect(USERS.owner)).tokens.access_token);
    try {
      const names = (await player.listTools()).tools.map((t) => t.name);
      expect(names.filter((n) => forbidden.test(n) || /manage|pay/i.test(n))).toEqual([]);
      expect(names).toHaveLength(14);
    } finally {
      await player.close();
    }
    const owner = await mcpClient(
      (await connect(USERS.owner, { scope: MANAGE_CONNECTION })).tokens.access_token,
    );
    try {
      const names = (await owner.listTools()).tools.map((t) => t.name);
      expect(names.filter((n) => forbidden.test(n))).toEqual([]);
      expect(names).toHaveLength(27);
      expect(names).toContain('list_my_managed_spaces');
    } finally {
      await owner.close();
    }
  });
});
