import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { PORTS, USERS } from './support/env.js';
import { resetLimits, safeCall, world } from './support/fase2.js';
import { userByEmail } from './support/helpers.js';
import { mcpClient, ok, rawMcp } from './support/mcp.js';
import {
  api,
  authorizeUrl,
  Browser,
  type Connected,
  connect,
  pkce,
  resetTarget,
  useTarget,
} from './support/oauth.js';
import { type Running, startApi, startMcp } from './support/processes.js';

// Fase 2, chaves de emergência (docs/14-mcp.md 8.1 e 8.3; RN-MCP-08; decisão 123): `MCP_ADMIN_ENABLED=false`
// desliga SÓ o conector da Plataforma (API e apps/mcp têm uma variável cada, com o mesmo nome) e o
// conector de jogador/gestão segue de pé; `MCP_ENABLED=false` derruba os dois. Um par próprio de
// processos (API + MCP) é reiniciado a cada cenário, sobre o mesmo banco, então os tokens emitidos
// antes continuam válidos quando a chave volta.

const w = world();
const API_URL = `http://127.0.0.1:${PORTS.apiAdmin}`;
const USER_MCP = `http://127.0.0.1:${PORTS.mcpAdmin}/mcp`;
const ADMIN_MCP = `http://127.0.0.1:${PORTS.mcpAdmin}/admin/mcp`;
const ISSUER = `${API_URL}/v1/auth`;
const SCOPES_USER = [
  'spaces:read',
  'bookings:read',
  'bookings:write',
  'classes:read',
  'classes:write',
  'manage:read',
  'manage:finance:read',
].join(' ');

interface Switches {
  apiAdmin: boolean;
  mcpAdmin: boolean;
  /** `MCP_ENABLED` das duas (a chave geral). */
  general?: boolean;
}

let api_: Running | undefined;
let mcp_: Running | undefined;

async function restart({ apiAdmin, mcpAdmin, general = true }: Switches) {
  await Promise.all([api_?.stop(), mcp_?.stop()]);
  api_ = await startApi({
    port: PORTS.apiAdmin,
    mcpResource: USER_MCP,
    env: { MCP_ADMIN_ENABLED: String(apiAdmin), MCP_ENABLED: String(general) },
  });
  mcp_ = await startMcp({
    port: PORTS.mcpAdmin,
    apiUrl: API_URL,
    issuer: ISSUER,
    resource: USER_MCP,
    env: { MCP_ADMIN_ENABLED: String(mcpAdmin), MCP_ENABLED: String(general) },
  });
}

const tokens: { user?: Connected; sup?: Connected } = {};

beforeAll(async () => {
  useTarget(API_URL, USER_MCP);
  await restart({ apiAdmin: true, mcpAdmin: true });
});

afterAll(async () => {
  resetTarget();
  await Promise.all([api_?.stop(), mcp_?.stop()]);
});

describe('(2) MCP_ADMIN_ENABLED=false desliga só o conector da Plataforma (decisão 123)', () => {
  it('com tudo ligado: o Dono usa o conector de jogador/gestão e o Super usa o da Plataforma', async () => {
    tokens.user = await connect(w.people.dona?.email as string, { scope: SCOPES_USER });
    tokens.sup = await connect(USERS.superUser, { scope: 'super:read', resource: ADMIN_MCP });
    const owner = await mcpClient(tokens.user.tokens.access_token, USER_MCP);
    const sup = await mcpClient(tokens.sup.tokens.access_token, ADMIN_MCP);
    try {
      expect((await ok(owner, 'list_my_managed_spaces')).spaces).toHaveLength(1);
      expect((await ok(sup, 'list_spaces', { pageSize: 1 })).total).toBeGreaterThan(0);
    } finally {
      await owner.close();
      await sup.close();
    }
  });

  it('API e MCP com a chave desligada: o token do Super leva 503 nos dois, o metadata dela some, e o jogador/gestão nem sente', async () => {
    await restart({ apiAdmin: false, mcpAdmin: false });
    await resetLimits();
    const sup = tokens.sup?.tokens.access_token as string;
    const user = tokens.user?.tokens.access_token as string;

    // apps/mcp: endpoint e metadata da superfície admin respondem 503; a de jogador/gestão segue.
    const endpoint = await rawMcp({ authorization: `Bearer ${sup}` }, undefined, ADMIN_MCP);
    expect(endpoint.status).toBe(503);
    const adminMeta = await fetch(
      `http://127.0.0.1:${PORTS.mcpAdmin}/.well-known/oauth-protected-resource/admin/mcp`,
    );
    expect(adminMeta.status).toBe(503);
    const userMeta = await fetch(
      `http://127.0.0.1:${PORTS.mcpAdmin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(userMeta.status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${PORTS.mcpAdmin}/health`)).status).toBe(200);

    // API: o token do Super leva 503 MCP_DISABLED (auditado); o de jogador/gestão lê normalmente.
    const direct = await api('/v1/super/spaces?pageSize=1', sup, {}, API_URL);
    expect([direct.status, direct.body?.error?.code]).toEqual([503, 'MCP_DISABLED']);
    const manage = await api(`/v1/manage/spaces/${w.spaces.a.id}/courts`, user, {}, API_URL);
    expect(manage.status).toBe(200);

    // O conector de jogador/gestão continua completo, com a mesma sessão de antes.
    const owner = await mcpClient(user, USER_MCP);
    try {
      expect((await owner.listTools()).tools).toHaveLength(27);
      expect(
        (await ok(owner, 'get_booking_metrics', { space: w.spaces.a.slug })).totals.bookings,
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await owner.close();
    }

    // Conexão NOVA: o jogador/gestão conecta; o Super não consegue nem chegar à tela (503 no authorize).
    const fresh = await connect(w.people.admin?.email as string, { scope: SCOPES_USER });
    expect(fresh.tokens.scope).toContain('manage:finance:read');
    const attempt = await new Browser().request(
      authorizeUrl({ challenge: pkce().challenge, resource: ADMIN_MCP, scope: 'super:read' }),
    );
    expect(attempt.status).toBe(503);
    expect(await attempt.json()).toMatchObject({
      code: 'MCP_DISABLED',
      error: 'temporarily_unavailable',
    });
    // O metadata do servidor de autorização (comum aos dois) segue no ar.
    expect((await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).status).toBeLessThan(
      500,
    );
    expect((await fetch(`${API_URL}/.well-known/oauth-authorization-server/v1/auth`)).status).toBe(
      200,
    );

    // A recusa por chave também fica na auditoria do Super (decisão 123).
    const sup0 = await userByEmail(USERS.superUser);
    const rows = await sql<{ diff: { result?: { status?: number; code?: string } } }>(
      `select diff from audit_logs where action = 'mcp.admin_request' and actor_id = $1
          and diff->'result'->>'code' = 'MCP_DISABLED'`,
      [sup0.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.diff.result?.status).toBe(503);
  });

  it('só a API com a chave desligada: o MCP encaminha, a API recusa e a tool devolve MCP_DISABLED sem dados', async () => {
    await restart({ apiAdmin: false, mcpAdmin: true });
    await resetLimits();
    const sup = await mcpClient(tokens.sup?.tokens.access_token as string, ADMIN_MCP);
    try {
      const res = await safeCall(sup, 'list_spaces', { pageSize: 1 });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.data)).not.toMatch(/"rows"/);
      if (res.code) expect(res.code).toBe('MCP_DISABLED');
    } finally {
      await sup.close();
    }
  });

  it('só o apps/mcp com a chave desligada: o endpoint do Super dá 503, a API do Super ainda responderia, o jogador/gestão segue', async () => {
    await restart({ apiAdmin: true, mcpAdmin: false });
    await resetLimits();
    const sup = tokens.sup?.tokens.access_token as string;
    expect((await rawMcp({ authorization: `Bearer ${sup}` }, undefined, ADMIN_MCP)).status).toBe(
      503,
    );
    expect(
      (
        await fetch(
          `http://127.0.0.1:${PORTS.mcpAdmin}/.well-known/oauth-protected-resource/admin/mcp`,
        )
      ).status,
    ).toBe(503);
    const owner = await mcpClient(tokens.user?.tokens.access_token as string, USER_MCP);
    try {
      expect((await ok(owner, 'list_my_managed_spaces')).spaces).toHaveLength(1);
    } finally {
      await owner.close();
    }
  });

  it('MCP_ENABLED=false (chave geral) derruba os dois conectores; app e web não dependem dele', async () => {
    await restart({ apiAdmin: true, mcpAdmin: true, general: false });
    const sup = tokens.sup?.tokens.access_token as string;
    const user = tokens.user?.tokens.access_token as string;
    expect((await rawMcp({ authorization: `Bearer ${sup}` }, undefined, ADMIN_MCP)).status).toBe(
      503,
    );
    expect((await rawMcp({ authorization: `Bearer ${user}` }, undefined, USER_MCP)).status).toBe(
      503,
    );
    for (const token of [sup, user]) {
      const res = await api('/v1/spaces', token, {}, API_URL);
      expect([res.status, res.body?.error?.code]).toEqual([503, 'MCP_DISABLED']);
    }
    // O authorize dos dois recursos também cai (503), e o login normal do app continua.
    for (const resource of [USER_MCP, ADMIN_MCP]) {
      const res = await new Browser().request(
        authorizeUrl({
          challenge: pkce().challenge,
          resource,
          scope: resource === ADMIN_MCP ? 'super:read' : 'spaces:read',
        }),
      );
      expect(res.status, resource).toBe(503);
    }
    const login = await new Browser().postJson('/v1/auth/sign-in/email', {
      email: w.people.dona?.email,
      password: w.password,
    });
    expect(login.status).toBe(200);
  });

  it('religando as chaves, os mesmos tokens voltam a valer (a chave não destrói estado)', async () => {
    await restart({ apiAdmin: true, mcpAdmin: true });
    await resetLimits();
    const sup = await mcpClient(tokens.sup?.tokens.access_token as string, ADMIN_MCP);
    const owner = await mcpClient(tokens.user?.tokens.access_token as string, USER_MCP);
    try {
      expect((await ok(sup, 'list_spaces', { pageSize: 1 })).total).toBeGreaterThan(0);
      expect((await ok(owner, 'list_my_managed_spaces')).spaces).toHaveLength(1);
    } finally {
      await sup.close();
      await owner.close();
    }
  });
});
