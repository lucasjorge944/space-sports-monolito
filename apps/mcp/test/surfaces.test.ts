import type { Client } from '@modelcontextprotocol/client';
import {
  MCP_ALL_OAUTH_SCOPES,
  MCP_RESOURCE_SCOPES,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from '@space-sports/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUPER_USER } from './support/fake-super.js';
import { callTool, type Harness, startHarness, toolsCall } from './support/harness.js';

// Superfícies (decisão 120; docs/14-mcp.md 8.1): `user` (conector "Space Sports": jogador e
// gestão) e `admin` (conector "Space Sports · Plataforma": só Super, MCP2.4) no mesmo processo,
// escolhidas pelo host e pelo caminho da requisição. Cada uma valida o token com a própria
// audiência, só conta os escopos do seu recurso, tem as suas tools e prompts e a sua chave.

const USER = 'https://mcp.a.test/mcp';
const ADMIN = 'https://mcp-admin.a.test/mcp';
const USER_METADATA = 'https://mcp.a.test/.well-known/oauth-protected-resource/mcp';
const ADMIN_METADATA = 'https://mcp-admin.a.test/.well-known/oauth-protected-resource/mcp';

const USER_ALL = [...MCP_RESOURCE_SCOPES.USER, OAUTH_OFFLINE_ACCESS_SCOPE];
const SUPER_ONLY = [...MCP_RESOURCE_SCOPES.ADMIN, OAUTH_OFFLINE_ACCESS_SCOPE];

const SUPER_TOOLS = [
  'compare_spaces',
  'get_online_payments_revenue',
  'get_platform_finance',
  'get_platform_metrics',
  'get_reviews_reports',
  'get_space_details',
  'list_spaces',
  'list_users',
  'search_audit_logs',
];

const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

/** Requisição direto no app (Web standard), com o host da URL. */
function post(h: Harness, url: string, bearer?: string, body: unknown = listTools) {
  return h.app.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** Corpo JSON-RPC da resposta (JSON ou o `data:` do SSE). */
// biome-ignore lint/suspicious/noExplicitAny: corpo JSON-RPC livre nos testes.
async function rpc(res: Response): Promise<any> {
  const text = await res.text();
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('');
  return JSON.parse(data || text);
}

/** Nomes das tools de uma resposta de `tools/list`. */
async function toolNames(res: Response): Promise<string[]> {
  const body = (await rpc(res)) as { result: { tools: { name: string }[] } };
  return body.result.tools.map((tool) => tool.name).sort();
}

describe('duas superfícies no mesmo processo (MCP_SURFACES=user,admin)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({
      surfaces: [
        { name: 'user', resourceUrl: USER, enabled: true },
        { name: 'admin', resourceUrl: ADMIN, enabled: true },
      ],
    });
  });
  afterAll(async () => {
    await h.stop();
  });
  beforeEach(() => {
    h.api.reset();
    h.logs.length = 0;
  });

  describe('metadata RFC 9728 por host', () => {
    it.each([
      ['https://mcp.a.test/.well-known/oauth-protected-resource', USER],
      [USER_METADATA, USER],
      ['https://MCP-ADMIN.a.test/.well-known/oauth-protected-resource', ADMIN],
      [ADMIN_METADATA, ADMIN],
    ])('%s', async (url, resource) => {
      const res = await h.app.fetch(new Request(url));
      expect(res.status).toBe(200);
      expect((await res.json()).resource).toBe(resource);
    });

    it('cada recurso anuncia o seu nome e os seus escopos (o do Super, só super:read)', async () => {
      const user = await (await h.app.fetch(new Request(USER_METADATA))).json();
      const admin = await (await h.app.fetch(new Request(ADMIN_METADATA))).json();
      expect(user).toMatchObject({
        resource_name: 'Space Sports',
        scopes_supported: [...MCP_RESOURCE_SCOPES.USER],
      });
      expect(admin).toEqual({
        resource: ADMIN,
        authorization_servers: [h.config.issuer],
        scopes_supported: ['super:read'],
        bearer_methods_supported: ['header'],
        resource_name: 'Space Sports · Plataforma',
      });
    });

    it('host desconhecido: 404 (nem metadata nem /mcp); caminho de outra superfície: 404', async () => {
      expect(
        (await h.app.fetch(new Request('https://outro.test/.well-known/oauth-protected-resource')))
          .status,
      ).toBe(404);
      expect((await post(h, 'https://outro.test/mcp')).status).toBe(404);
      expect((await post(h, 'https://mcp-admin.a.test/admin/mcp')).status).toBe(404);
    });
  });

  describe('tools/list de cada superfície', () => {
    it('admin: só as 9 do Super (nenhuma de jogador nem de gestão)', async () => {
      const res = await post(h, ADMIN, await h.token({ audience: ADMIN, scopes: SUPER_ONLY }));
      expect(res.status).toBe(200);
      expect(await toolNames(res)).toEqual(SUPER_TOOLS);
    });

    it('user com todos os escopos do recurso: nenhuma do Super', async () => {
      const names = await toolNames(
        await post(h, USER, await h.token({ audience: USER, scopes: USER_ALL })),
      );
      expect(names).toHaveLength(27);
      expect(names).toContain('create_booking');
      expect(names).toContain('get_revenue');
      for (const tool of SUPER_TOOLS) {
        // `list_spaces` e afins não existem na `user` (o jogador tem `search_spaces`).
        expect(names).not.toContain(tool);
      }
    });

    it('prompts: saude_da_plataforma só na admin; os da gestão só na user', async () => {
      const promptsOf = async (url: string, bearer: string) => {
        const res = await post(h, url, bearer, {
          jsonrpc: '2.0',
          id: 1,
          method: 'prompts/list',
          params: {},
        });
        const body = (await rpc(res)) as { result: { prompts: { name: string }[] } };
        return body.result.prompts.map((prompt) => prompt.name).sort();
      };
      expect(
        await promptsOf(ADMIN, await h.token({ audience: ADMIN, scopes: SUPER_ONLY })),
      ).toEqual(['saude_da_plataforma']);
      expect(await promptsOf(USER, await h.token({ audience: USER, scopes: USER_ALL }))).toEqual([
        'ocupacao_da_semana',
        'relatorio_mensal_do_espaco',
      ]);
    });

    it('chamar na admin uma tool de jogador ou de gestão: não existe (e não chama a API)', async () => {
      const bearer = await h.token({ sub: SUPER_USER, audience: ADMIN, scopes: SUPER_ONLY });
      for (const tool of ['search_spaces', 'create_booking', 'get_revenue']) {
        const res = await post(h, ADMIN, bearer, toolsCall(tool, { space: 'arena-sul' }));
        const body = (await rpc(res)) as { result?: { isError?: boolean }; error?: unknown };
        expect(body.error ?? body.result?.isError, tool).toBeTruthy();
      }
      expect(h.api.calls).toHaveLength(0);
    });

    it('chamar na user uma tool do Super: não existe (e não chama a API)', async () => {
      const bearer = await h.token({ audience: USER, scopes: USER_ALL });
      const res = await post(h, USER, bearer, toolsCall('list_users'));
      const body = (await rpc(res)) as { result?: { isError?: boolean }; error?: unknown };
      expect(body.error ?? body.result?.isError).toBeTruthy();
      expect(h.api.calls).toHaveLength(0);
    });
  });

  describe('cruzamento de tokens', () => {
    it('token do recurso do jogador na admin: 401 apontando para o metadata da admin', async () => {
      const res = await post(h, ADMIN, await h.token({ audience: USER, scopes: USER_ALL }));
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(
        `resource_metadata="${ADMIN_METADATA}"`,
      );
    });

    it('token do Super na user: 401 apontando para o metadata da user', async () => {
      const res = await post(h, USER, await h.token({ audience: ADMIN, scopes: SUPER_ONLY }));
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${USER_METADATA}"`);
    });

    it('sem token na admin: 401 com o desafio da admin (escopo super:read)', async () => {
      const res = await post(h, ADMIN);
      expect(res.status).toBe(401);
      const challenge = res.headers.get('www-authenticate') ?? '';
      expect(challenge).toContain(`resource_metadata="${ADMIN_METADATA}"`);
    });

    it('token com as duas audiências: 401 nas duas superfícies (um recurso por token)', async () => {
      const both = await h.token({ audience: [USER, ADMIN], scopes: [...MCP_ALL_OAUTH_SCOPES] });
      const onUser = await post(h, USER, both);
      expect(onUser.status).toBe(401);
      expect(onUser.headers.get('www-authenticate')).toContain(
        `resource_metadata="${USER_METADATA}"`,
      );
      const onAdmin = await post(h, ADMIN, both);
      expect(onAdmin.status).toBe(401);
      expect(onAdmin.headers.get('www-authenticate')).toContain(
        `resource_metadata="${ADMIN_METADATA}"`,
      );
      // A mesma audiência repetida também não é "uma só".
      expect(
        (await post(h, ADMIN, await h.token({ audience: [ADMIN, ADMIN], scopes: SUPER_ONLY })))
          .status,
      ).toBe(401);
      expect(h.api.calls).toHaveLength(0);
    });

    it('audiência em lista com um item só, igual à da superfície: aceita', async () => {
      const single = await h.token({ audience: [ADMIN], scopes: SUPER_ONLY });
      expect((await post(h, ADMIN, single)).status).toBe(200);
    });

    it('token do Super forjado com escopos de jogador e gestão: na admin eles não contam (403)', async () => {
      const forged = await h.token({
        audience: ADMIN,
        scopes: [...MCP_RESOURCE_SCOPES.USER, OAUTH_OFFLINE_ACCESS_SCOPE],
      });
      const res = await post(h, ADMIN, forged);
      expect(res.status).toBe(403);
      expect(res.headers.get('www-authenticate')).toContain('insufficient_scope');
      expect(res.headers.get('www-authenticate')).toContain('super:read');
    });

    it('token do jogador forjado com super:read: na user o escopo do Super não conta', async () => {
      const forged = await h.token({ audience: USER, scopes: [...MCP_ALL_OAUTH_SCOPES] });
      const names = await toolNames(await post(h, USER, forged));
      for (const tool of SUPER_TOOLS) expect(names).not.toContain(tool);
    });

    it('os logs de recusa e de chamada indicam a superfície', async () => {
      await post(h, ADMIN, await h.token({ audience: USER, scopes: USER_ALL }));
      expect(h.logs.find((line) => line.event === 'auth_rejected')).toMatchObject({
        surface: 'admin',
        status: 401,
      });
      h.logs.length = 0;
      await post(
        h,
        USER,
        await h.token({ audience: USER, scopes: ['spaces:read'] }),
        toolsCall('get_revenue'),
      );
      expect(h.logs.find((line) => line.event === 'scope_denied')).toMatchObject({
        surface: 'user',
        tool: 'get_revenue',
      });
      h.logs.length = 0;
      await rpc(
        await post(
          h,
          ADMIN,
          await h.token({ sub: SUPER_USER, audience: ADMIN, scopes: SUPER_ONLY }),
          toolsCall('get_platform_metrics'),
        ),
      );
      expect(h.logs.find((line) => line.event === 'tool_call')).toMatchObject({
        surface: 'admin',
        tool: 'get_platform_metrics',
        result: 'ok',
      });
    });
  });
});

describe('MCP_ADMIN_ENABLED=false: 503 só na admin', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ admin: { enabled: false } });
  });
  afterAll(async () => {
    await h.stop();
  });

  it('admin: 503 no endpoint e no metadata, mesmo com token válido, sem chamar a API', async () => {
    const res = await h.post(listTools, await h.adminToken(), {}, h.adminResourceUrl);
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toContain('Space Sports · Plataforma');
    const metadata = await fetch(
      new URL('/.well-known/oauth-protected-resource/admin/mcp', h.adminResourceUrl),
    );
    expect(metadata.status).toBe(503);
    expect(h.api.calls).toHaveLength(0);
  });

  it('user segue no ar: metadata, tools e chamadas', async () => {
    const metadata = await fetch(
      new URL('/.well-known/oauth-protected-resource/mcp', h.resourceUrl),
    );
    expect(metadata.status).toBe(200);
    const client = await h.connect(await h.token());
    const { isError } = await callTool(client, 'search_spaces', { query: 'arena' });
    expect(isError).toBe(false);
  });
});

describe('superfície no mesmo host, caminho diferente (desenvolvimento)', () => {
  let h: Harness;
  let admin: Client;
  beforeAll(async () => {
    h = await startHarness({ admin: {} });
    admin = await h.connect(await h.adminToken({ sub: SUPER_USER }), { url: h.adminResourceUrl });
  });
  afterAll(async () => {
    await h.stop();
  });

  it('o cliente MCP de verdade fala com a admin pelo caminho e com a user pelo outro', async () => {
    expect((await admin.listTools()).tools.map((tool) => tool.name).sort()).toEqual(SUPER_TOOLS);
    const user = await h.connect(await h.token());
    expect((await user.listTools()).tools.map((tool) => tool.name)).toContain('search_spaces');
  });

  it('metadata de cada caminho', async () => {
    const metadataOf = async (path: string) =>
      (
        await (
          await fetch(new URL(`/.well-known/oauth-protected-resource${path}`, h.resourceUrl))
        ).json()
      ).resource;
    expect(await metadataOf('/admin/mcp')).toBe(h.adminResourceUrl);
    expect(await metadataOf('/mcp')).toBe(h.resourceUrl);
    // Duas superfícies no mesmo host: o metadata sem caminho não escolhe por nenhuma.
    expect(
      (await fetch(new URL('/.well-known/oauth-protected-resource', h.resourceUrl))).status,
    ).toBe(404);
  });
});
