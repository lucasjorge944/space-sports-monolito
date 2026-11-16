import { MCP_OAUTH_SCOPES } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import {
  API_URL,
  CIMD_ORIGIN,
  ISSUER,
  MCP_URL,
  PORTS,
  REDIRECT_URI,
  USERS,
} from './support/env.js';
import { signUpUser } from './support/helpers.js';
import { call, mcpClient, ok } from './support/mcp.js';
import {
  api,
  appSession,
  authorizeUrl,
  Browser,
  CLIENT_ID,
  connect,
  decodeJwt,
  exchangeCode,
  OAuthError,
  pkce,
  refreshTokens,
  tokenRequest,
} from './support/oauth.js';
import { startApi } from './support/processes.js';

/** authorize cru (sem seguir redirect): devolve status, Location e corpo. */
async function rawAuthorize(params: Parameters<typeof authorizeUrl>[0]) {
  const res = await new Browser().request(authorizeUrl(params));
  return {
    status: res.status,
    location: res.headers.get('location'),
    text: await res.text(),
  };
}

/**
 * O authorize recusou: 4xx, ou 302 para a página de erro da própria API (`/v1/auth/error`), nunca
 * para o `redirect_uri` do pedido (cliente ainda não verificado).
 */
function expectRefused(res: Awaited<ReturnType<typeof rawAuthorize>>, redirectUri?: string) {
  if (res.status === 302) {
    expect(new URL(res.location ?? '').pathname, res.location ?? '').toBe('/v1/auth/error');
  } else {
    expect(res.status, res.text).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }
  if (redirectUri) expect(res.location ?? '').not.toContain(redirectUri);
}

describe('(2) segurança — OAuth: PKCE, redirect_uri e cliente (RN-MCP-01; docs/14-mcp.md 3.1)', () => {
  it('sem code_challenge: 400 invalid_request', async () => {
    const res = await rawAuthorize({ challenge: '', method: null });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).error).toBe('invalid_request');
  });

  it('code_challenge_method=plain e code_challenge sem método: 400 invalid_request', async () => {
    const { challenge } = pkce();
    for (const method of ['plain', null]) {
      const res = await rawAuthorize({ challenge, method });
      expect(res.status, String(method)).toBe(400);
      expect(JSON.parse(res.text).error).toBe('invalid_request');
    }
  });

  it('redirect_uri inseguro (esquema próprio, HTTP público, javascript:) é recusado sem redirecionar', async () => {
    const { challenge } = pkce();
    for (const redirect of ['myapp://callback', 'http://evil.example/cb', 'javascript:alert(1)']) {
      // O documento CIMD do cliente lista exatamente esse redirect_uri (a defesa é da API, não do documento).
      const clientId = `${CIMD_ORIGIN}/inseguro.json?redirect=${encodeURIComponent(redirect)}`;
      const res = await rawAuthorize({ challenge, clientId, redirectUri: redirect });
      expectRefused(res, redirect);
      expect(res.status, redirect).toBe(400);
    }
  });

  it('redirect_uri fora do documento do cliente: recusado e sem redirect', async () => {
    const { challenge } = pkce();
    const res = await rawAuthorize({ challenge, redirectUri: 'https://evil.example/callback' });
    expectRefused(res, 'https://evil.example/callback');
  });

  it('cliente desconhecido, documento CIMD inválido e client_id não-HTTPS são recusados', async () => {
    const { challenge } = pkce();
    for (const clientId of [
      'https://outro-dominio.example/client.json', // o fetch falso responde 404
      `${CIMD_ORIGIN}/bad-sem-redirects.json`, // documento sem redirect_uris
      'http://cimd.e2e.test/claude.json', // HTTP
      'cliente-que-nao-existe',
    ]) {
      expectRefused(await rawAuthorize({ challenge, clientId }), REDIRECT_URI);
    }
  });

  it('pedido de authorize adulterado depois do /entrar (query assinada) é recusado no login', async () => {
    const browser = new Browser();
    const { challenge } = pkce();
    const res = await browser.request(authorizeUrl({ challenge }));
    const location = new URL(res.headers.get('location') ?? '', API_URL);
    // Troca o escopo sem refazer a assinatura.
    const query = new URLSearchParams(location.search);
    query.set('scope', `${query.get('scope')} bookings:write extra:admin`);
    const login = await browser.postJson('/v1/auth/sign-in/email', {
      email: USERS.a,
      password: 'senha-e2e-1234',
      oauth_query: query.toString(),
    });
    expect(login.status).toBeGreaterThanOrEqual(400);
    expect(login.status).toBeLessThan(500);
  });

  it('o /oauth2/consent com query adulterada ou de outro pedido não emite código', async () => {
    const browser = new Browser();
    const { challenge } = pkce();
    const first = await browser.request(authorizeUrl({ challenge }));
    const location = new URL(first.headers.get('location') ?? '', API_URL);
    const login = await browser.postJson('/v1/auth/sign-in/email', {
      email: USERS.b,
      password: 'senha-e2e-1234',
      oauth_query: location.search.slice(1),
    });
    expect(login.status).toBe(200);
    const next = new URL(((await login.json()) as { url: string }).url, API_URL);
    // Já autorizado: o login pode ter ido direto ao cliente; nesse caso não há o que adulterar.
    if (next.pathname !== '/autorizar') return;
    const tampered = new URLSearchParams(next.search);
    tampered.set('scope', `${tampered.get('scope')} classes:write`);
    const consent = await browser.postJson('/v1/auth/oauth2/consent', {
      accept: true,
      oauth_query: tampered.toString(),
    });
    expect(consent.status).toBeGreaterThanOrEqual(400);
    const info = await browser.request(
      `/v1/oauth/consent-request?oauthQuery=${encodeURIComponent(tampered.toString())}`,
    );
    expect(info.status).toBe(400);
    expect(((await info.json()) as { error: { code: string } }).error.code).toBe(
      'OAUTH_REQUEST_INVALID',
    );
  });

  it('"Cancelar" no consentimento volta ao cliente com access_denied e sem código', async () => {
    const user = await signUpUser('deny');
    await expect(connect(user.email, { deny: true })).rejects.toThrow(/access_denied/);
    // Nada foi autorizado: o app não aparece em Apps conectados.
    const { token } = await appSession(user.email);
    expect((await api('/v1/me/connected-apps', token)).body.items).toEqual([]);
  });

  it('o código só vale uma vez, com o verifier certo, o mesmo redirect_uri e o mesmo cliente', async () => {
    const user = await signUpUser('code');
    // Captura o código sem trocá-lo: refaz o fluxo à mão até o redirect final.
    const grab = async () => {
      const browser = new Browser();
      const { verifier, challenge } = pkce();
      const res = await browser.request(authorizeUrl({ challenge }));
      const location = new URL(res.headers.get('location') ?? '', API_URL);
      const login = await browser.postJson('/v1/auth/sign-in/email', {
        email: user.email,
        password: 'senha-e2e-1234',
        oauth_query: location.search.slice(1),
      });
      let next = new URL(((await login.json()) as { url: string }).url, API_URL);
      if (next.pathname === '/autorizar') {
        const consent = await browser.postJson('/v1/auth/oauth2/consent', {
          accept: true,
          oauth_query: next.search.slice(1),
        });
        next = new URL(((await consent.json()) as { url: string }).url);
      }
      const code = next.searchParams.get('code') as string;
      expect(code).toBeTruthy();
      // RFC 9207: o `iss` vem no redirect.
      expect(next.searchParams.get('iss')).toBe(ISSUER);
      expect(next.searchParams.get('state')).toBe('estado-e2e');
      return { code, verifier };
    };

    const a = await grab();
    const wrongVerifier = await tokenRequest({
      grant_type: 'authorization_code',
      code: a.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce().verifier,
      resource: MCP_URL,
    });
    expect(wrongVerifier.status).toBe(400);
    expect((await wrongVerifier.json()).error).toBe('invalid_grant');

    // Um código com tentativa errada não vale mais para ninguém (ou é refeito): com o verifier certo
    // pode funcionar uma vez só.
    const b = await grab();
    const noVerifier = await tokenRequest({
      grant_type: 'authorization_code',
      code: b.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      resource: MCP_URL,
    });
    expect(noVerifier.status).toBe(400);

    const c = await grab();
    const wrongRedirect = await tokenRequest({
      grant_type: 'authorization_code',
      code: c.code,
      redirect_uri: 'https://evil.example/callback',
      client_id: CLIENT_ID,
      code_verifier: c.verifier,
      resource: MCP_URL,
    });
    expect(wrongRedirect.status).toBe(400);

    const d = await grab();
    const wrongClient = await tokenRequest({
      grant_type: 'authorization_code',
      code: d.code,
      redirect_uri: REDIRECT_URI,
      client_id: `${CIMD_ORIGIN}/outro-cliente.json`,
      code_verifier: d.verifier,
      resource: MCP_URL,
    });
    expect(wrongClient.status).toBe(400);

    const e = await grab();
    const first = await exchangeCode(e.code, e.verifier);
    expect(first.access_token).toBeTruthy();
    const replay = await tokenRequest({
      grant_type: 'authorization_code',
      code: e.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: e.verifier,
      resource: MCP_URL,
    });
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe('invalid_grant');
  });

  it('o token sai sempre com a audiência do MCP, mesmo sem `resource` no pedido', async () => {
    const user = await signUpUser('aud');
    const noResource = await connect(user.email, { resource: null });
    expect(decodeJwt(noResource.tokens.access_token).payload.aud).toBe(MCP_URL);
    const client = await mcpClient(noResource.tokens.access_token);
    try {
      expect((await ok(client, 'get_my_profile')).firstName).toBe('Qa');
    } finally {
      await client.close();
    }
  });

  it('rotas do plugin desligadas respondem 404 (CRUD de clientes e consentimentos, userinfo, introspecção, JWT da sessão)', async () => {
    const { browser } = await appSession(USERS.a);
    const disabled: [string, string][] = [
      ['POST', '/v1/auth/oauth2/create-client'],
      ['GET', '/v1/auth/oauth2/get-clients'],
      ['POST', '/v1/auth/oauth2/delete-consent'],
      ['GET', '/v1/auth/oauth2/get-consents'],
      ['GET', '/v1/auth/oauth2/userinfo'],
      ['POST', '/v1/auth/oauth2/introspect'],
      ['GET', '/v1/auth/oauth2/end-session'],
      ['GET', '/v1/auth/token'],
      ['GET', '/v1/auth/.well-known/openid-configuration'],
    ];
    for (const [method, path] of disabled) {
      const res = await browser.request(path, {
        method,
        headers: { origin: 'http://localhost:43330', 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // A sessão do app não vira JWT: nem no header de resposta de um login.
    const login = await new Browser().postJson('/v1/auth/sign-in/email', {
      email: USERS.a,
      password: 'senha-e2e-1234',
    });
    expect(login.headers.get('set-auth-jwt')).toBeNull();
  });

  // BUG-MCP-1 (corrigido): o metadata RFC 8414 anunciava rotas que a API desliga (docs/14-mcp.md 3.1).
  it('BUG-MCP-1: o metadata não anuncia endpoints desligados (introspecção, end-session/logout)', async () => {
    const meta = await (
      await fetch(`${API_URL}/.well-known/oauth-authorization-server/v1/auth`)
    ).json();
    const introspection = meta.introspection_endpoint
      ? await fetch(meta.introspection_endpoint, { method: 'POST' })
      : undefined;
    // Se anuncia, a rota precisa existir (não ser 404); o esperado pela doc é nem anunciar.
    expect(meta.introspection_endpoint, 'introspection_endpoint anunciado').toBeUndefined();
    expect(introspection?.status).not.toBe(404);
    expect(meta.backchannel_logout_supported).not.toBe(true);
  });
});

describe('(2) segurança — escopos: consentimento reduzido e escalonamento (decisão 111)', () => {
  it('consentir só spaces:read + bookings:read: o token traz só isso e as tools de escrita somem', async () => {
    const user = await signUpUser('escopo');
    const granted = await connect(user.email, { consentScope: 'spaces:read bookings:read' });
    const scopes = granted.tokens.scope.split(' ').filter((s) => s !== 'offline_access');
    expect(scopes.sort()).toEqual(['bookings:read', 'spaces:read']);

    const client = await mcpClient(granted.tokens.access_token);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          'check_availability',
          'get_booking',
          'get_my_profile',
          'get_space',
          'list_my_bookings',
          'list_space_classes',
          'search_spaces',
        ].sort(),
      );
      // Chamar uma tool que sumiu da lista também falha.
      for (const name of [
        'create_booking',
        'prepare_booking',
        'cancel_booking',
        'list_my_classes',
        'confirm_class_attendance',
      ]) {
        const res = await call(client, name, {}).catch((error: unknown) => ({
          isError: true,
          text: String(error),
        }));
        expect(res.isError, name).toBe(true);
      }
    } finally {
      await client.close();
    }

    // Na API (o cliente MCP pode chamar as rotas direto): escopo faltando = 403 com os escopos exigidos.
    const token = granted.tokens.access_token;
    const classes = await api('/v1/me/class-sessions', token);
    expect([classes.status, classes.body.error.code]).toEqual([403, 'OAUTH_INSUFFICIENT_SCOPE']);
    expect(classes.body.error.details.requiredScopes).toEqual(['classes:read']);
    const write = await api('/v1/bookings', token, {
      method: 'POST',
      json: {},
      headers: { 'Idempotency-Key': 'qa-escopo' },
    });
    expect([write.status, write.body.error.code]).toEqual([403, 'OAUTH_INSUFFICIENT_SCOPE']);
    expect((await api('/v1/spaces', token)).status).toBe(200);
  });

  it('consentir um escopo só (classes:read): tools só de aulas e perfil; o resto responde 403 no MCP', async () => {
    const user = await signUpUser('escopo1');
    const granted = await connect(user.email, { consentScope: 'classes:read' });
    const client = await mcpClient(granted.tokens.access_token);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(['get_my_profile', 'list_my_classes']);
    } finally {
      await client.close();
    }
  });

  it('o refresh não amplia os escopos concedidos', async () => {
    const user = await signUpUser('escopo2');
    const granted = await connect(user.email, { consentScope: 'spaces:read' });
    const widened = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: granted.tokens.refresh_token as string,
      client_id: CLIENT_ID,
      resource: MCP_URL,
      scope: 'spaces:read bookings:write classes:write',
    });
    expect(widened.status).toBe(400);
    expect(['invalid_scope', 'invalid_grant']).toContain((await widened.json()).error);
    // Com o pedido normal o refresh mantém só o concedido.
    const same = await refreshTokens(granted.tokens.refresh_token as string);
    // (o refresh anterior pode ter sido consumido pela tentativa recusada; ambos os desfechos mantêm o escopo)
    if (same.status === 200) {
      expect(
        String(same.body.scope)
          .split(' ')
          .filter((s: string) => s !== 'offline_access'),
      ).toEqual(['spaces:read']);
    }
  });

  it('novo pedido com mais escopos do que o consentido anteriormente pede consentimento de novo', async () => {
    const user = await signUpUser('escopo3');
    const browser = new Browser();
    const narrow = await connect(user.email, { browser, consentScope: 'spaces:read' });
    expect(narrow.tokens.scope).not.toContain('bookings:write');
    const wide = await connect(user.email, { browser, loggedIn: true });
    expect(wide.consentRequest, 'o consentimento não foi pedido de novo').toBeDefined();
    expect(wide.tokens.scope.split(' ')).toEqual(expect.arrayContaining([...MCP_OAUTH_SCOPES]));
  });

  it('escopo fora do catálogo (admin, openid) no pedido não vira permissão', async () => {
    const user = await signUpUser('escopo4');
    const res = await rawAuthorize({
      challenge: pkce().challenge,
      scope: 'spaces:read admin:all manage:spaces',
    });
    // O pedido é recusado (invalid_scope) ou os extras são descartados; nunca concedidos.
    if (res.status >= 400) return;
    const granted = await connect(user.email, {
      scope: 'spaces:read admin:all manage:spaces',
    }).catch((error: unknown) => error);
    if (granted instanceof OAuthError || granted instanceof Error) return;
    expect((granted as Awaited<ReturnType<typeof connect>>).tokens.scope).not.toMatch(
      /admin|manage/,
    );
  });
});

describe('(2) segurança — registro dinâmico de cliente (RFC 7591, ligado só neste e2e)', () => {
  const register = (body: unknown, ip = '198.51.100.7', issuer = ISSUER) =>
    fetch(`${issuer}/oauth2/register`, {
      method: 'POST',
      // O limite é por IP do cliente (cabeçalho do proxy); sem IP o limitador não conta (como no login).
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });

  it('registra cliente público com redirect HTTPS e conclui o fluxo com PKCE', async () => {
    const res = await register({
      client_name: 'Cliente registrado (e2e)',
      redirect_uris: ['https://registrado.e2e.test/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const client = await res.json();
    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeUndefined();

    const user = await signUpUser('dcr');
    const connected = await connect(user.email, {
      clientId: client.client_id,
      redirectUri: 'https://registrado.e2e.test/callback',
    });
    expect(connected.consentRequest?.client.name).toBe('Cliente registrado (e2e)');
    const mcp = await mcpClient(connected.tokens.access_token);
    try {
      expect(decodeJwt(connected.tokens.access_token).payload.azp).toBe(client.client_id);
      expect((await ok(mcp, 'get_my_profile')).firstName).toBe('Qa');
    } finally {
      await mcp.close();
    }
  });

  it('recusa redirect_uri com esquema próprio, HTTP público ou javascript: (400 invalid_redirect_uri)', async () => {
    for (const uri of ['myapp://cb', 'http://publico.example/cb', 'javascript:alert(1)']) {
      const res = await register({
        client_name: 'Inseguro',
        redirect_uris: [uri],
        token_endpoint_auth_method: 'none',
      });
      expect(res.status, uri).toBe(400);
      expect((await res.json()).error).toBe('invalid_redirect_uri');
    }
  });

  it('limita os registros por IP (5 a cada 10 min): o excedente responde 429', async () => {
    // O rate limit de auth fica desligado fora da produção (e atrapalharia os muitos logins do e2e):
    // sobe uma API à parte, com ele ligado, só para este caso.
    const limited = await startApi({
      port: PORTS.apiRl,
      env: { AUTH_RATE_LIMIT_ENABLED: 'true', BETTER_AUTH_URL: `http://127.0.0.1:${PORTS.apiRl}` },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await register(
        {
          client_name: `Rajada ${i}`,
          redirect_uris: [`https://rajada${i}.e2e.test/callback`],
          token_endpoint_auth_method: 'none',
        },
        '198.51.100.99',
        `http://127.0.0.1:${PORTS.apiRl}/v1/auth`,
      );
      statuses.push(res.status);
    }
    await limited.stop();
    expect(statuses.slice(0, 5).every((status) => status === 201)).toBe(true);
    expect(statuses.slice(5)).toContain(429);
  });
});

describe('(2) segurança — refresh token: rotação e revogação (RN-MCP-04)', () => {
  it('RFC 7009: revogar o refresh token impede novas renovações', async () => {
    const user = await signUpUser('revoke');
    const connected = await connect(user.email);
    const refresh = connected.tokens.refresh_token as string;
    const revoke = await fetch(`${ISSUER}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: refresh,
        token_type_hint: 'refresh_token',
        client_id: CLIENT_ID,
      }),
    });
    expect(revoke.status).toBeLessThan(300);
    const after = await refreshTokens(refresh);
    expect(after.status).toBe(400);
    expect(after.body.error).toBe('invalid_grant');
  });

  it('o refresh rotacionado não pode ser reutilizado depois da janela de 30 s', async () => {
    const user = await signUpUser('rotacao');
    const connected = await connect(user.email);
    const first = connected.tokens.refresh_token as string;
    const rotated = await refreshTokens(first);
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(first);
    // Dentro da janela de repetição (30 s) o mesmo refresh ainda é tolerado; fora dela, não.
    await new Promise((resolve) => setTimeout(resolve, 31_500));
    const replay = await refreshTokens(first);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
  }, 60_000);

  it('o refresh de um cliente não serve a outro cliente', async () => {
    const user = await signUpUser('xclient');
    const connected = await connect(user.email);
    const other = await refreshTokens(
      connected.tokens.refresh_token as string,
      `${CIMD_ORIGIN}/outro-cliente.json`,
    );
    expect(other.status).toBeGreaterThanOrEqual(400);
  });
});
