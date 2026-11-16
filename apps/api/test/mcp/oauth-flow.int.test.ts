import { MCP_ALL_OAUTH_SCOPES, MCP_OAUTH_SCOPES } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oauthClients, oauthConsents, users } from '../../src/db/schema/index.js';
import { PHONE, type SignedUp, signUp, type TestApp, WEB_ORIGIN } from '../auth/helpers.js';
import {
  ALL_SCOPES,
  authorizeParams,
  authorizePath,
  bearerOf,
  CLIENT_ID,
  CLIENT_NAME,
  cimdDocument,
  connect,
  createMcpTestApp,
  decodeJwt,
  exchangeCode,
  ISSUER,
  MCP_RESOURCE,
  pkce,
  REDIRECT_URI,
  refresh,
  searchOf,
  signInWithOAuthQuery,
} from './helpers.js';

const NATIVE_CLIENT_ID = 'https://nativo.example.com/oauth/client.json';

// MCP.1 (docs/14-mcp.md 3.1; decisão 111): servidor de autorização do Better Auth (jwt + mcp +
// cimd) por HTTP, do metadata ao token, com o login e o consentimento como o web (MCP.3) fará.

describe('servidor de autorização do MCP (OAuth 2.1 + PKCE + CIMD)', () => {
  let t: TestApp;
  let ana: SignedUp;

  beforeAll(async () => {
    t = await createMcpTestApp({
      documents: {
        [CLIENT_ID]: cimdDocument(),
        // Documento com redirect fora de HTTPS/loopback: a API recusa antes de usar o cliente.
        [NATIVE_CLIENT_ID]: {
          ...cimdDocument(NATIVE_CLIENT_ID, 'App nativo'),
          redirect_uris: ['meuapp://oauth/callback', 'http://nativo.example.com/callback'],
        },
      },
    });
    ana = await signUp(t, 'ana.mcp@exemplo.com', 'Ana Souza');
  });
  afterAll(() => t?.close());

  it('publica o metadata RFC 8414 na raiz, com o caminho do emissor', async () => {
    const res = await t.http().get('/.well-known/oauth-authorization-server/v1/auth');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth2/authorize`,
      token_endpoint: `${ISSUER}/oauth2/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });
    expect(res.body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    // Os escopos dos dois recursos (decisão 120); cada recurso aceita só os seus.
    expect(res.body.scopes_supported).toEqual([...MCP_ALL_OAUTH_SCOPES, 'offline_access']);
    // Sem registro dinâmico por padrão (o CIMD é o caminho).
    expect(res.body.registration_endpoint).toBeUndefined();
    // O mesmo documento no caminho com o emissor no começo.
    const appended = await t.http().get('/v1/auth/.well-known/oauth-authorization-server');
    expect(appended.status).toBe(200);
    expect(appended.body).toEqual(res.body);
  });

  it('BUG-MCP-1: o metadata só anuncia o que a API atende (nada de rota desligada, backchannel ou DPoP)', async () => {
    for (const path of [
      '/.well-known/oauth-authorization-server/v1/auth',
      '/v1/auth/.well-known/oauth-authorization-server',
    ]) {
      const { body } = await t.http().get(path);
      expect(body.revocation_endpoint, path).toBe(`${ISSUER}/oauth2/revoke`);
      for (const field of Object.keys(body)) {
        expect(field, path).not.toMatch(/^(introspection|userinfo|end_session)_endpoint/);
        expect(field, path).not.toMatch(/^backchannel_logout|^dpop_/);
      }
      // Toda URL anunciada sob o emissor responde (nenhuma cai no 404 das rotas desligadas).
      for (const [field, value] of Object.entries(body)) {
        if (typeof value !== 'string' || !value.startsWith(`${ISSUER}/`) || field === 'issuer') {
          continue;
        }
        const route = new URL(value).pathname;
        const probe = field === 'jwks_uri' ? t.http().get(route) : t.http().post(route).send({});
        expect((await probe).status, `${field} ${route}`).not.toBe(404);
      }
    }
  });

  it('sem sessão, o authorize leva ao /entrar do web com a query assinada', async () => {
    const { challenge } = pkce();
    const res = await t.http().get(authorizePath(authorizeParams(challenge)));
    expect(res.status).toBe(302);
    const login = new URL(res.headers.location as string);
    expect(login.origin + login.pathname).toBe(`${WEB_ORIGIN}/entrar`);
    expect(login.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(login.searchParams.get('sig')).toBeTruthy();
    // offline_access entra sozinho: o cliente recebe o token de atualização.
    expect(login.searchParams.get('scope')).toBe(`${ALL_SCOPES} offline_access`);
    // O CIMD criou o cliente com o nome do documento.
    const [client] = await t.db
      .select({ name: oauthClients.name, redirectUris: oauthClients.redirectUris })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, CLIENT_ID));
    expect(client).toEqual({ name: CLIENT_NAME, redirectUris: [REDIRECT_URI] });
  });

  it('PKCE S256 é obrigatório', async () => {
    for (const overrides of [
      { code_challenge: undefined, code_challenge_method: undefined },
      { code_challenge_method: 'plain' },
    ]) {
      const res = await t
        .http()
        .get(authorizePath(authorizeParams('desafio', overrides)))
        .set('cookie', ana.cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    }
  });

  it('login → consentimento → token: JWT de 15 min com aud do MCP, escopos e refresh', async () => {
    const { verifier, challenge } = pkce();
    const start = await t.http().get(authorizePath(authorizeParams(challenge)));
    const loginQuery = searchOf(start.headers.location as string);

    // /entrar: o login com `oauth_query` devolve o próximo passo (o consentimento).
    const signIn = await signInWithOAuthQuery(t, ana.email, loginQuery);
    expect(signIn.status).toBe(200);
    expect(signIn.body.redirect).toBe(true);
    const consentUrl = new URL(signIn.body.url);
    expect(consentUrl.origin + consentUrl.pathname).toBe(`${WEB_ORIGIN}/autorizar`);
    const cookie = signIn.headers['set-cookie']?.[0]?.split(';')[0] as string;

    // /autorizar: o web lê o pedido pela API.
    const consentQuery = consentUrl.search.slice(1);
    const described = await t
      .http()
      .get('/v1/oauth/consent-request')
      .query({ oauthQuery: consentQuery })
      .set('cookie', cookie);
    expect(described.status).toBe(200);
    expect(described.body).toEqual({
      client: {
        clientId: CLIENT_ID,
        name: CLIENT_NAME,
        host: 'claude.example.com',
        uri: 'https://claude.example.com',
        logoUrl: 'https://claude.example.com/logo.png',
      },
      resource: { kind: 'USER', name: 'Space Sports', maxConnectionHours: null },
      scopes: [...MCP_OAUTH_SCOPES],
      // Jogador sem papel em espaço: a gestão não vale para ele.
      deniedScopes: ['manage:read', 'manage:finance:read'],
      canAuthorize: true,
      expiresAt: expect.any(String),
    });
    expect(new Date(described.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // "Permitir": volta para o redirect_uri do cliente com o código e o emissor (RFC 9207).
    const accepted = await t
      .http()
      .post('/v1/auth/oauth2/consent')
      .set('cookie', cookie)
      .set('origin', WEB_ORIGIN)
      .send({ accept: true, oauth_query: consentQuery });
    expect(accepted.status).toBe(200);
    const callback = new URL(accepted.body.url);
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('estado-123');
    expect(callback.searchParams.get('iss')).toBe(ISSUER);
    const code = callback.searchParams.get('code') as string;

    // Código com outro verifier: recusado.
    const wrong = await exchangeCode(t, code, pkce().verifier);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('invalid_grant');

    const fresh = await t
      .http()
      .get(authorizePath(authorizeParams(challenge)))
      .set('cookie', cookie);
    // Já autorizado: o authorize devolve outro código direto, sem consentimento.
    expect(fresh.status).toBe(302);
    const again = new URL(fresh.headers.location as string);
    expect(again.origin + again.pathname).toBe(REDIRECT_URI);
    const token = await exchangeCode(t, again.searchParams.get('code') as string, verifier);
    expect(token.status).toBe(200);
    expect(token.body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      scope: `${ALL_SCOPES} offline_access`,
    });
    expect(token.body.refresh_token).toEqual(expect.any(String));

    const { header, payload } = decodeJwt(token.body.access_token);
    expect(header).toMatchObject({ alg: 'EdDSA', typ: 'at+jwt' });
    expect(payload).toMatchObject({
      iss: ISSUER,
      aud: MCP_RESOURCE,
      sub: ana.id,
      azp: CLIENT_ID,
      client_id: CLIENT_ID,
      scope: `${ALL_SCOPES} offline_access`,
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);

    // O token vale na API, nas rotas da lista permitida.
    const me = await t
      .http()
      .get('/v1/me/summary')
      .set(...bearerOf(token.body.access_token));
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ id: ana.id, firstName: 'Ana', favoriteSports: [] });

    // Refresh com rotação: novo par; o antigo, fora da janela de repetição, não serve mais.
    const rotated = await refresh(t, token.body.refresh_token);
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(token.body.refresh_token);
    expect(decodeJwt(rotated.body.access_token).payload.aud).toBe(MCP_RESOURCE);
  });

  it('"Cancelar" no consentimento devolve access_denied ao cliente', async () => {
    const bia = await signUp(t, 'bia.mcp@exemplo.com', 'Bia');
    const { challenge } = pkce();
    const res = await t
      .http()
      .get(authorizePath(authorizeParams(challenge)))
      .set('cookie', bia.cookie);
    const consentUrl = new URL(res.headers.location as string);
    expect(consentUrl.pathname).toBe('/autorizar');
    const denied = await t
      .http()
      .post('/v1/auth/oauth2/consent')
      .set('cookie', bia.cookie)
      .set('origin', WEB_ORIGIN)
      .send({ accept: false, oauth_query: consentUrl.search.slice(1) });
    expect(denied.status).toBe(200);
    const callback = new URL(denied.body.url);
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    // Nada foi autorizado.
    const apps = await t.http().get('/v1/me/connected-apps').set('cookie', bia.cookie);
    expect(apps.body.items).toEqual([]);
  });

  it('já logado no web: /oauth2/continue segue do /entrar para o consentimento', async () => {
    const caio = await signUp(t, 'caio.mcp@exemplo.com', 'Caio');
    const { challenge } = pkce();
    const start = await t.http().get(authorizePath(authorizeParams(challenge)));
    const res = await t
      .http()
      .post('/v1/auth/oauth2/continue')
      .set('cookie', caio.cookie)
      .set('origin', WEB_ORIGIN)
      .send({ selected: true, oauth_query: searchOf(start.headers.location as string) });
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).pathname).toBe('/autorizar');
  });

  it('decisão 119 no servidor (BUG-MCP-2): sem nome ou telefone, nem "Permitir" nem "Continuar" emitem código', async () => {
    const duda = await signUp(t, 'semfone.mcp@exemplo.com', 'Duda');
    // Conta como a do login social: sem telefone (o `/autorizar` do web mandaria completar).
    await t.db.update(users).set({ phone: null }).where(eq(users.id, duda.id));
    const { challenge } = pkce();
    const start = await t
      .http()
      .get(authorizePath(authorizeParams(challenge)))
      .set('cookie', duda.cookie);
    const consentQuery = searchOf(start.headers.location as string);
    expect(new URL(start.headers.location as string).pathname).toBe('/autorizar');

    const post = (path: string, body: Record<string, unknown>) =>
      t
        .http()
        .post(path)
        .set('cookie', duda.cookie)
        .set('origin', WEB_ORIGIN)
        .send({ ...body, oauth_query: consentQuery });
    for (const res of [
      await post('/v1/auth/oauth2/consent', { accept: true }),
      await post('/v1/auth/oauth2/consent', { accept: true, scope: 'spaces:read' }),
      await post('/v1/auth/oauth2/continue', { selected: true }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'PROFILE_INCOMPLETE',
        error: 'access_denied',
        message: expect.stringContaining('Complete seu cadastro'),
        details: { missing: ['phone'] },
      });
      expect(JSON.stringify(res.body)).not.toContain('code=');
    }
    expect(
      await t.db.select().from(oauthConsents).where(eq(oauthConsents.userId, duda.id)),
    ).toEqual([]);

    // Nome em branco também conta (mesma regra de `profile.missing` do GET /v1/me).
    await t.db.update(users).set({ name: ' ' }).where(eq(users.id, duda.id));
    const both = await post('/v1/auth/oauth2/consent', { accept: true });
    expect(both.status).toBe(403);
    expect(both.body.details).toEqual({ missing: ['name', 'phone'] });

    // "Cancelar" não depende do cadastro: o cliente recebe access_denied.
    const denied = await post('/v1/auth/oauth2/consent', { accept: false });
    expect(denied.status).toBe(200);
    expect(new URL(denied.body.url).searchParams.get('error')).toBe('access_denied');

    // Cadastro completo: o mesmo fluxo conclui e emite o token.
    await t.db.update(users).set({ name: 'Duda', phone: PHONE }).where(eq(users.id, duda.id));
    const token = await connect(t, duda);
    expect(token.access_token).toEqual(expect.any(String));
  });

  it('decisão 119: conexão antiga de conta que ficou incompleta não renova o token nem recebe código', async () => {
    const eva = await signUp(t, 'incompleta.mcp@exemplo.com', 'Eva');
    const token = await connect(t, eva);
    await t.db.update(users).set({ phone: null }).where(eq(users.id, eva.id));
    const res = await refresh(t, token.refresh_token as string);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_grant' });

    // Já logada e com o consentimento salvo: o authorize não devolve código, manda para o
    // `/autorizar` com a query assinada (e `prompt=consent`), como no fluxo normal.
    const { verifier, challenge } = pkce();
    const again = await t
      .http()
      .get(authorizePath(authorizeParams(challenge)))
      .set('cookie', eva.cookie);
    expect(again.status).toBe(302);
    const consentUrl = new URL(again.headers.location as string);
    expect(consentUrl.origin + consentUrl.pathname).toBe(`${WEB_ORIGIN}/autorizar`);
    expect(consentUrl.searchParams.get('code')).toBeNull();
    expect(consentUrl.searchParams.get('prompt')).toBe('consent');
    expect(consentUrl.searchParams.get('sig')).toBeTruthy();
    // O web lê o pedido normalmente; "Permitir" segue recusado enquanto falta o telefone.
    const consentQuery = consentUrl.search.slice(1);
    const described = await t
      .http()
      .get('/v1/oauth/consent-request')
      .query({ oauthQuery: consentQuery })
      .set('cookie', eva.cookie);
    expect(described.status).toBe(200);
    const allow = () =>
      t
        .http()
        .post('/v1/auth/oauth2/consent')
        .set('cookie', eva.cookie)
        .set('origin', WEB_ORIGIN)
        .send({ accept: true, oauth_query: consentQuery });
    expect((await allow()).status).toBe(403);

    // O login dentro do fluxo (o `/entrar` com `oauth_query`) também não emite código.
    const { challenge: loginChallenge } = pkce();
    const start = await t.http().get(authorizePath(authorizeParams(loginChallenge)));
    const signIn = await signInWithOAuthQuery(
      t,
      eva.email,
      searchOf(start.headers.location as string),
    );
    expect(signIn.status).toBe(200);
    const next = new URL(signIn.body.url);
    expect(next.origin + next.pathname).toBe(`${WEB_ORIGIN}/autorizar`);
    expect(next.searchParams.get('code')).toBeNull();

    // `prompt=none` não admite tela: interaction_required, sem código.
    const silent = await t
      .http()
      .get(authorizePath(authorizeParams(pkce().challenge, { prompt: 'none' })))
      .set('cookie', eva.cookie);
    expect(silent.status).toBe(400);
    expect(silent.body).toMatchObject({ error: 'interaction_required' });

    // Com o cadastro completo (o web volta ao `/autorizar` com a mesma query), "Permitir" emite o
    // código e o token sai.
    await t.db.update(users).set({ phone: PHONE }).where(eq(users.id, eva.id));
    const allowed = await allow();
    expect(allowed.status).toBe(200);
    const callback = new URL(allowed.body.url);
    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
    const exchanged = await exchangeCode(t, callback.searchParams.get('code') as string, verifier);
    expect(exchanged.status).toBe(200);
  });

  it('DPoP não é oferecido: header DPoP ou dpop_jkt no authorize e no token → invalid_request', async () => {
    const fia = await signUp(t, 'dpop.mcp@exemplo.com', 'Fia');
    const { verifier, challenge } = pkce();
    const jkt = 'A'.repeat(43);
    for (const res of [
      await t
        .http()
        .get(authorizePath(authorizeParams(challenge, { dpop_jkt: jkt })))
        .set('cookie', fia.cookie),
      await t
        .http()
        .get(authorizePath(authorizeParams(challenge)))
        .set('cookie', fia.cookie)
        .set('dpop', 'eyJ0eXAiOiJkcG9wK2p3dCJ9.e30.x'),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid_request' });
    }

    // Sem DPoP o fluxo segue; a troca do código e o refresh com o header DPoP são recusados.
    const start = await t
      .http()
      .get(authorizePath(authorizeParams(challenge)))
      .set('cookie', fia.cookie);
    const consented = await t
      .http()
      .post('/v1/auth/oauth2/consent')
      .set('cookie', fia.cookie)
      .set('origin', WEB_ORIGIN)
      .send({ accept: true, oauth_query: searchOf(start.headers.location as string) });
    const code = new URL(consented.body.url).searchParams.get('code') as string;
    const tokenForm = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
      resource: MCP_RESOURCE,
    };
    const withDpop = await t
      .http()
      .post('/v1/auth/oauth2/token')
      .type('form')
      .set('dpop', 'eyJ0eXAiOiJkcG9wK2p3dCJ9.e30.x')
      .send(tokenForm);
    expect(withDpop.status).toBe(400);
    expect(withDpop.body).toMatchObject({ error: 'invalid_request' });
    // A recusa vem antes de gastar o código: sem o header, a mesma troca funciona.
    const plain = await t.http().post('/v1/auth/oauth2/token').type('form').send(tokenForm);
    expect(plain.status).toBe(200);
    expect(plain.body.token_type).toBe('Bearer');
    const refreshed = await t
      .http()
      .post('/v1/auth/oauth2/token')
      .type('form')
      .set('dpop', 'eyJ0eXAiOiJkcG9wK2p3dCJ9.e30.x')
      .send({
        grant_type: 'refresh_token',
        refresh_token: plain.body.refresh_token,
        client_id: CLIENT_ID,
        resource: MCP_RESOURCE,
      });
    expect(refreshed.status).toBe(400);
    expect(refreshed.body).toMatchObject({ error: 'invalid_request' });
  });

  it('pedido de consentimento adulterado, vencido ou sem sessão é recusado', async () => {
    const { challenge } = pkce();
    const res = await t
      .http()
      .get(authorizePath(authorizeParams(challenge)))
      .set('cookie', ana.cookie);
    // Ana já autorizou: força um pedido novo com outro cliente inexistente na query adulterada.
    const query = new URLSearchParams(searchOf(res.headers.location as string));
    query.set('scope', 'bookings:write');
    const tampered = await t
      .http()
      .get('/v1/oauth/consent-request')
      .query({ oauthQuery: query.toString() })
      .set('cookie', ana.cookie);
    expect(tampered.status).toBe(400);
    expect(tampered.body.error.code).toBe('OAUTH_REQUEST_INVALID');

    const anonymous = await t
      .http()
      .get('/v1/oauth/consent-request')
      .query({ oauthQuery: 'sig=x' });
    expect(anonymous.status).toBe(401);

    const consent = await t
      .http()
      .post('/v1/auth/oauth2/consent')
      .set('cookie', ana.cookie)
      .set('origin', WEB_ORIGIN)
      .send({ accept: true, oauth_query: query.toString() });
    expect(consent.status).toBe(400);
  });

  it('cliente CIMD com redirect_uri fora do documento é recusado', async () => {
    const { challenge } = pkce();
    const res = await t
      .http()
      .get(
        authorizePath(authorizeParams(challenge, { redirect_uri: 'https://evil.example.com/cb' })),
      )
      .set('cookie', ana.cookie);
    // Erro sem redirecionar para o endereço desconhecido.
    expect(res.headers.location ?? '').not.toContain('evil.example.com');
  });

  it('redirect_uri só HTTPS ou loopback, também para cliente CIMD (sem redirecionar para ela)', async () => {
    const { challenge } = pkce();
    for (const redirect of ['meuapp://oauth/callback', 'http://nativo.example.com/callback']) {
      const res = await t
        .http()
        .get(
          authorizePath(
            authorizeParams(challenge, { client_id: NATIVE_CLIENT_ID, redirect_uri: redirect }),
          ),
        )
        .set('cookie', ana.cookie);
      expect(res.status, redirect).toBe(400);
      expect(res.body.error).toBe('invalid_request');
      expect(res.headers.location).toBeUndefined();
    }
  });

  it('authorize com outro resource ou com vários: 400 invalid_target, sem código nem redirect', async () => {
    const { challenge } = pkce();
    const other = await t
      .http()
      .get(authorizePath(authorizeParams(challenge, { resource: 'https://outro.example.com/mcp' })))
      .set('cookie', ana.cookie);
    // Decisão 120: um recurso por token. Vários `resource` no mesmo pedido também são recusados.
    const params = new URLSearchParams(authorizeParams(challenge) as Record<string, string>);
    params.append('resource', 'https://outro.example.com/mcp');
    const many = await t
      .http()
      .get(`/v1/auth/oauth2/authorize?${params.toString()}`)
      .set('cookie', ana.cookie);
    for (const res of [other, many]) {
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_target');
      expect(res.headers.location).toBeUndefined();
    }
  });

  describe('troca do código no /oauth2/token', () => {
    let eva: SignedUp;

    beforeAll(async () => {
      eva = await signUp(t, 'eva.mcp@exemplo.com', 'Eva');
      await connect(t, eva);
    });

    /** Código novo (Eva já autorizou: o authorize devolve o código direto). */
    async function newCode() {
      const { verifier, challenge } = pkce();
      const res = await t
        .http()
        .get(authorizePath(authorizeParams(challenge)))
        .set('cookie', eva.cookie);
      const callback = new URL(res.headers.location as string);
      expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
      return { code: callback.searchParams.get('code') as string, verifier };
    }

    const token = (body: Record<string, string | undefined>) =>
      t
        .http()
        .post('/v1/auth/oauth2/token')
        .type('form')
        .send(
          Object.fromEntries(
            Object.entries({
              grant_type: 'authorization_code',
              redirect_uri: REDIRECT_URI,
              client_id: CLIENT_ID,
              resource: MCP_RESOURCE,
              ...body,
            }).filter(([, value]) => value !== undefined),
          ),
        );

    it('code_verifier ausente ou errado: invalid_grant/invalid_request', async () => {
      const missing = await newCode();
      const withoutVerifier = await token({ code: missing.code });
      expect(withoutVerifier.status).toBe(400);
      expect(['invalid_request', 'invalid_grant']).toContain(withoutVerifier.body.error);

      const wrong = await newCode();
      const withWrong = await token({ code: wrong.code, code_verifier: pkce().verifier });
      expect(withWrong.status).toBe(400);
      expect(withWrong.body.error).toBe('invalid_grant');
    });

    it('código reusado: a segunda troca falha', async () => {
      const { code, verifier } = await newCode();
      expect((await token({ code, code_verifier: verifier })).status).toBe(200);
      const again = await token({ code, code_verifier: verifier });
      expect(again.status).toBe(400);
      expect(again.body.error).toBe('invalid_grant');
    });

    it('redirect_uri diferente do pedido de autorização: recusado', async () => {
      const { code, verifier } = await newCode();
      const res = await token({
        code,
        code_verifier: verifier,
        redirect_uri: 'https://claude.example.com/outro-callback',
      });
      expect(res.status).toBe(400);
      expect(res.body.access_token).toBeUndefined();
    });
  });

  it('rotas do Better Auth fora do fluxo ficam desligadas', async () => {
    for (const path of [
      '/v1/auth/token',
      '/v1/auth/oauth2/get-clients',
      '/v1/auth/oauth2/get-consents',
      '/v1/auth/oauth2/public-client?client_id=x',
      '/v1/auth/oauth2/userinfo',
    ]) {
      const res = await t.http().get(path).set('cookie', ana.cookie);
      expect(res.status, path).toBe(404);
    }
    const register = await t
      .http()
      .post('/v1/auth/oauth2/register')
      .send({ redirect_uris: ['https://x.example.com/cb'], token_endpoint_auth_method: 'none' });
    expect(register.status).not.toBe(200);
    expect(register.status).not.toBe(201);
    // A sessão do web não ganha o header com JWT.
    const session = await t.http().get('/v1/auth/get-session').set('cookie', ana.cookie);
    expect(session.headers['set-auth-jwt']).toBeUndefined();
  });

  it('connect() de ponta a ponta para outro usuário gera o próprio token', async () => {
    const duda = await signUp(t, 'duda.mcp@exemplo.com', 'Duda');
    const token = await connect(t, duda);
    expect(decodeJwt(token.access_token).payload.sub).toBe(duda.id);
  });
});

describe('registro dinâmico (MCP_DYNAMIC_CLIENT_REGISTRATION=true)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createMcpTestApp({ env: { MCP_DYNAMIC_CLIENT_REGISTRATION: 'true' } });
  });
  afterAll(() => t?.close());

  const register = (redirectUris: string[]) =>
    t
      .http()
      .post('/v1/auth/oauth2/register')
      .send({
        client_name: 'Cliente local',
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });

  it('aceita redirect HTTPS ou loopback e recusa esquema próprio ou HTTP público', async () => {
    const meta = await t.http().get('/.well-known/oauth-authorization-server/v1/auth');
    expect(meta.body.registration_endpoint).toBe(`${ISSUER}/oauth2/register`);

    const https = await register(['https://cliente.example.com/callback']);
    expect(https.status).toBe(201);
    expect(https.body.client_id).toEqual(expect.any(String));
    expect(https.body.client_secret).toBeUndefined();

    const loopback = await register(['http://127.0.0.1:33418/callback']);
    expect(loopback.status).toBe(201);

    for (const uris of [
      ['cursor://anysphere.cursor-retrieval/oauth/callback'],
      ['http://cliente.example.com/callback'],
      ['https://ok.example.com/cb', 'javascript:alert(1)'],
    ]) {
      const res = await register(uris);
      expect(res.status, uris.join()).toBe(400);
      expect(res.body.error).toBe('invalid_redirect_uri');
    }
  });
});

describe('MCP_ENABLED=false desliga o servidor de autorização', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createMcpTestApp({ env: { MCP_ENABLED: 'false' } });
  });
  afterAll(() => t?.close());

  it('metadata, authorize e token respondem 503 MCP_DISABLED; o login segue normal', async () => {
    const { challenge } = pkce();
    for (const res of [
      await t.http().get('/.well-known/oauth-authorization-server/v1/auth'),
      await t.http().get(authorizePath(authorizeParams(challenge))),
      await t
        .http()
        .post('/v1/auth/oauth2/token')
        .type('form')
        .send({ grant_type: 'refresh_token' }),
    ]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('MCP_DISABLED');
    }
    const user = await signUp(t, 'off.mcp@exemplo.com');
    const me = await t.http().get('/v1/me').set('authorization', `Bearer ${user.token}`);
    expect(me.status).toBe(200);
  });
});
