import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OTHER_USER } from './support/fixtures.js';
import { type Harness, startHarness, toolsCall } from './support/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});
beforeEach(() => {
  h.api.reset();
  h.logs.length = 0;
});

const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

describe('rotas públicas', () => {
  it('/health responde 200 para o proxy', async () => {
    const res = await fetch(new URL('/health', h.resourceUrl));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
    'publica a Protected Resource Metadata (RFC 9728) em %s',
    async (path) => {
      const res = await fetch(new URL(path, h.resourceUrl));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: h.resourceUrl,
        authorization_servers: [h.config.issuer],
        scopes_supported: [
          'spaces:read',
          'bookings:read',
          'bookings:write',
          'classes:read',
          'classes:write',
          'manage:read',
          'manage:finance:read',
        ],
        bearer_methods_supported: ['header'],
        resource_name: 'Space Sports',
      });
    },
  );

  it('caminho desconhecido responde 404', async () => {
    const res = await fetch(new URL('/v1/me', h.resourceUrl));
    expect(res.status).toBe(404);
  });
});

describe('autenticação (401)', () => {
  const expectChallenge = (res: Response) => {
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(
      `resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', h.resourceUrl)}"`,
    );
  };

  it('sem token: 401 com WWW-Authenticate apontando para a metadata', async () => {
    const res = await h.post(listTools);
    expectChallenge(res);
    expect(res.headers.get('www-authenticate')).toContain('scope="spaces:read');
  });

  it('assinatura de outra chave: 401', async () => {
    expectChallenge(await h.post(listTools, await h.token({ key: h.attackerKey })));
  });

  it('outra audiência (ex.: token feito para a API): 401', async () => {
    expectChallenge(await h.post(listTools, await h.token({ audience: 'http://127.0.0.1:1/v1' })));
  });

  it('outro emissor: 401', async () => {
    expectChallenge(
      await h.post(listTools, await h.token({ issuer: 'https://malicioso.example' })),
    );
  });

  it('vencido: 401', async () => {
    const expired = await h.token({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    expectChallenge(await h.post(listTools, expired));
  });

  it('sem o id do cliente (azp): 401', async () => {
    expectChallenge(await h.post(listTools, await h.token({ clientId: null })));
  });

  it.each([
    ['JWT', 'JWT'],
    ['ausente', null],
  ])('JWT que não é token de acesso (typ %s em vez de at+jwt): 401', async (_label, typ) => {
    expectChallenge(await h.post(listTools, await h.token({ typ })));
  });

  it('token sem usuário (sub igual ao client_id, ex.: client credentials): 401', async () => {
    expectChallenge(await h.post(listTools, await h.token({ sub: 'cliente-claude' })));
    expect(h.api.calls).toHaveLength(0);
  });

  it('nada chega à API sem token válido', async () => {
    await h.post(toolsCall('list_my_bookings'));
    await h.post(toolsCall('list_my_bookings'), await h.token({ key: h.attackerKey }));
    expect(h.api.calls).toHaveLength(0);
  });
});

describe('escopos (403 e tools/list)', () => {
  it('tools/list mostra só as tools dos escopos do token', async () => {
    const client = await h.connect(await h.token({ scopes: ['spaces:read', 'classes:read'] }));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'check_availability',
      'get_my_profile',
      'get_space',
      'list_my_classes',
      'list_space_classes',
      'search_spaces',
    ]);
  });

  it('token com todos os escopos (e o offline_access da API) vê as 14 tools', async () => {
    const client = await h.connect(await h.token());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'cancel_booking',
      'cancel_class_attendance',
      'check_availability',
      'confirm_class_attendance',
      'create_booking',
      'get_booking',
      'get_my_profile',
      'get_space',
      'list_my_bookings',
      'list_my_classes',
      'list_space_classes',
      'prepare_booking',
      'prepare_cancel_booking',
      'search_spaces',
    ]);
  });

  it('tool sem o escopo: 403 insufficient_scope com os escopos exigidos, sem chamar a API', async () => {
    const res = await h.post(
      toolsCall('create_booking', { spaceId: OTHER_USER }),
      await h.token({ scopes: ['spaces:read', 'bookings:read'] }),
    );
    expect(res.status).toBe(403);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="bookings:write spaces:read"');
    expect(challenge).toContain('resource_metadata=');
    expect(h.api.calls).toHaveLength(0);
    expect(h.logs).toContainEqual(
      expect.objectContaining({
        event: 'scope_denied',
        tool: 'create_booking',
        missing: ['bookings:write'],
      }),
    );
  });

  it('escopo transitivo: as escritas exigem também os escopos das leituras que fazem', async () => {
    const writeOnly = await h.token({ scopes: ['bookings:write'] });
    for (const [tool, scope] of [
      ['prepare_booking', 'bookings:write spaces:read'],
      ['create_booking', 'bookings:write spaces:read'],
      ['prepare_cancel_booking', 'bookings:write bookings:read'],
      ['cancel_booking', 'bookings:write bookings:read'],
    ] as const) {
      const res = await h.post(toolsCall(tool), writeOnly);
      expect(res.status, tool).toBe(403);
      expect(res.headers.get('www-authenticate')).toContain(`scope="${scope}"`);
    }
    expect(h.api.calls).toHaveLength(0);
  });

  it('tools/list esconde as escritas sem os escopos de leitura de que dependem', async () => {
    const writeOnly = await h.connect(await h.token({ scopes: ['bookings:write'] }));
    // Só a saudação, que aceita qualquer escopo do MCP.
    expect((await writeOnly.listTools()).tools.map((tool) => tool.name)).toEqual([
      'get_my_profile',
    ]);

    const booking = await h.connect(await h.token({ scopes: ['bookings:write', 'spaces:read'] }));
    const names = (await booking.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['prepare_booking', 'create_booking']));
    expect(names).not.toContain('prepare_cancel_booking');
    expect(names).not.toContain('cancel_booking');
  });

  it('o 403 vale também dentro de um lote JSON-RPC', async () => {
    const res = await h.post(
      [toolsCall('search_spaces', {}, 1), toolsCall('confirm_class_attendance', {}, 2)],
      await h.token({ scopes: ['spaces:read'] }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toContain('scope="classes:write"');
  });

  it.each([[['openid', 'profile']], [['offline_access']]])(
    'token sem nenhum escopo de permissão do MCP (%j): 403',
    async (scopes) => {
      const res = await h.post(listTools, await h.token({ scopes }));
      expect(res.status).toBe(403);
      expect(res.headers.get('www-authenticate')).toContain('insufficient_scope');
    },
  );
});

describe('Origin (DNS rebinding e páginas web)', () => {
  it.each(['https://malicioso.example', 'null', 'http://localhost:3000'])(
    'Origin %s fora da lista: 403, antes do token e sem chamar a API',
    async (origin) => {
      const res = await h.post(listTools, await h.token(), { origin });
      expect(res.status).toBe(403);
      expect(h.api.calls).toHaveLength(0);
    },
  );

  it('Origin da lista passa', async () => {
    const res = await h.post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'teste', version: '1' },
        },
      },
      await h.token(),
      { origin: 'https://app.example.com' },
    );
    expect(res.status).toBe(200);
  });

  it('sem Origin (cliente fora do navegador) segue para a validação do token', async () => {
    expect((await h.post(listTools)).status).toBe(401);
  });
});

describe('transporte sem estado', () => {
  it('GET /mcp (stream de sessão) não existe: 405', async () => {
    const res = await fetch(h.resourceUrl, {
      headers: { authorization: `Bearer ${await h.token()}`, accept: 'text/event-stream' },
    });
    expect(res.status).toBe(405);
  });

  it('corpo que não é JSON: 415', async () => {
    const res = await h.post(listTools, await h.token(), { 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('não devolve id de sessão (cada requisição traz o token)', async () => {
    const res = await h.post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'teste', version: '1' },
        },
      },
      await h.token(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });
});

describe('MCP_ENABLED=false', () => {
  let off: Harness;
  beforeAll(async () => {
    off = await startHarness({ enabled: false });
  });
  afterAll(async () => {
    await off.stop();
  });

  it('responde 503 em /mcp, mesmo com token válido, e não chama a API', async () => {
    const res = await off.post(listTools, await off.token());
    expect(res.status).toBe(503);
    expect(off.api.calls).toHaveLength(0);
  });

  it('/health continua respondendo', async () => {
    const res = await fetch(new URL('/health', off.resourceUrl));
    expect(res.status).toBe(200);
  });
});
