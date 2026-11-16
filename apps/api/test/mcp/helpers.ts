import { createHash, randomBytes } from 'node:crypto';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { MCP_OAUTH_SCOPES } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { expect } from 'vitest';
import { OAUTH_SCOPES, OAUTH_VIEW, SPACE_ROLES } from '../../src/auth/auth.metadata.js';
import { CIMD_FETCH } from '../../src/auth/auth.tokens.js';
import { consentReferenceCondition } from '../../src/auth/oauth-resources.js';
import { MCP_CONSENT_CLAIM } from '../../src/auth/oauth-server.js';
import { jwks, oauthConsents } from '../../src/db/schema/index.js';
import {
  API_URL,
  createTestApp,
  PASSWORD,
  type SignedUp,
  type TestApp,
  WEB_ORIGIN,
} from '../auth/helpers.js';

/** Recurso MCP dos testes (o padrão de dev do env). */
export const MCP_RESOURCE = 'http://localhost:3340/mcp';
/** Recurso do Super nos testes que o ligam (MCP_ADMIN_RESOURCE_URL; decisão 120). */
export const ADMIN_RESOURCE = 'http://localhost:3341/mcp';
/** `iss` dos tokens: a URL base do Better Auth. */
export const ISSUER = `${API_URL}/v1/auth`;
/** Cliente do Client ID Metadata Document (servido pelo fetch falso). */
export const CLIENT_ID = 'https://claude.example.com/oauth/client.json';
export const CLIENT_NAME = 'Claude (teste)';
export const REDIRECT_URI = 'https://claude.example.com/api/mcp/auth_callback';
export const ALL_SCOPES = MCP_OAUTH_SCOPES.join(' ');

/** Documento CIMD de um cliente público (PKCE, sem segredo). */
export function cimdDocument(clientId = CLIENT_ID, name = CLIENT_NAME) {
  return {
    client_id: clientId,
    client_name: name,
    client_uri: new URL(clientId).origin,
    logo_uri: `${new URL(clientId).origin}/logo.png`,
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** Fetch falso do CIMD: devolve os documentos conhecidos e 404 para o resto. */
export function fakeCimdFetch(
  documents: Record<string, unknown> = { [CLIENT_ID]: cimdDocument() },
): ClientMetadataResourceFetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const document = documents[url];
    if (!document) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(document), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' },
    });
  };
}

/** App de teste com o CIMD falso. */
export function createMcpTestApp(
  options: Parameters<typeof createTestApp>[0] & { documents?: Record<string, unknown> } = {},
): Promise<TestApp> {
  const { documents, providers = [], ...rest } = options;
  return createTestApp({
    ...rest,
    providers: [{ provide: CIMD_FETCH, useValue: fakeCimdFetch(documents) }, ...providers],
  });
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizePath(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  return `/v1/auth/oauth2/authorize?${query.toString()}`;
}

/** Parâmetros do pedido de autorização do Claude (CIMD + PKCE + recurso do MCP). */
export function authorizeParams(
  challenge: string,
  overrides: Record<string, string | undefined> = {},
) {
  return {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: ALL_SCOPES,
    state: 'estado-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_RESOURCE,
    ...overrides,
  };
}

/** Query de uma URL (sem o `?`). */
export const searchOf = (url: string) => new URL(url).search.slice(1);

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

export async function exchangeCode(
  t: TestApp,
  code: string,
  verifier: string,
  resource = MCP_RESOURCE,
  clientId = CLIENT_ID,
) {
  return t.http().post('/v1/auth/oauth2/token').type('form').send({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
    resource,
  });
}

export async function refresh(
  t: TestApp,
  refreshToken: string,
  resource = MCP_RESOURCE,
  clientId = CLIENT_ID,
) {
  return t.http().post('/v1/auth/oauth2/token').type('form').send({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource,
  });
}

/**
 * Conecta o cliente para o usuário logado (cookie do web): authorize → `/autorizar` → "Permitir"
 * → token. Se o usuário já autorizou o cliente, o authorize devolve o código direto.
 */
export async function connect(
  t: TestApp,
  user: SignedUp,
  overrides: Record<string, string | undefined> = {},
): Promise<TokenResponse> {
  const { verifier, challenge } = pkce();
  const res = await t
    .http()
    .get(authorizePath(authorizeParams(challenge, overrides)))
    .set('cookie', user.cookie);
  expect(res.status).toBe(302);
  let callback = new URL(res.headers.location as string);
  if (callback.href.startsWith(`${WEB_ORIGIN}/autorizar`)) {
    const consent = await t
      .http()
      .post('/v1/auth/oauth2/consent')
      .set('cookie', user.cookie)
      .set('origin', WEB_ORIGIN)
      .send({ accept: true, oauth_query: callback.search.slice(1) });
    expect(consent.status).toBe(200);
    callback = new URL(consent.body.url);
  }
  expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error(`Sem código: ${callback.href}`);
  const token = await exchangeCode(
    t,
    code,
    verifier,
    overrides.resource ?? MCP_RESOURCE,
    overrides.client_id ?? CLIENT_ID,
  );
  expect(token.status).toBe(200);
  return token.body as TokenResponse;
}

/** Login por e-mail no fluxo OAuth (como o `/entrar` do web), com a query assinada. */
export function signInWithOAuthQuery(t: TestApp, email: string, oauthQuery: string) {
  return t
    .http()
    .post('/v1/auth/sign-in/email')
    .set('origin', WEB_ORIGIN)
    .send({ email, password: PASSWORD, oauth_query: oauthQuery });
}

export function decodeJwt(token: string): { header: Record<string, unknown>; payload: JWTPayload } {
  const [header, payload] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header ?? '', 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
  };
}

export const bearerOf = (token: string) => ['authorization', `Bearer ${token}`] as const;

/**
 * Chave de teste no JWKS local (tabela `jwks`), mais antiga que a do Better Auth (que segue
 * assinando os tokens do fluxo). Chame depois de o Better Auth criar a dele (GET /v1/auth/jwks).
 */
export async function insertTestKey(t: TestApp) {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const [row] = await t.db
    .insert(jwks)
    .values({
      publicKey: JSON.stringify(await exportJWK(publicKey)),
      // Nunca usada pelo Better Auth: a chave dele é mais nova.
      privateKey: 'chave-de-teste-fora-do-better-auth',
      alg: 'EdDSA',
      crv: 'Ed25519',
      createdAt: new Date('2000-01-01T00:00:00Z'),
    })
    .returning({ id: jwks.id });
  if (!row) throw new Error('Chave não criada.');
  return { kid: row.id, privateKey, db: t.db };
}

export type TestKey = Awaited<ReturnType<typeof insertTestKey>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Token de acesso como o do Better Auth, assinado com a chave de teste (claims sobrescrevíveis).
 * Como o emissor, leva em `consent_id` o consentimento atual de (`sub`, `azp`, recurso da `aud`),
 * se houver; passe `consent_id` nas claims para fixar outro (ou `undefined` para tirar).
 */
export async function mintToken(
  key: TestKey,
  claims: JWTPayload & { sub: string },
  options: { typ?: string; expiresIn?: number; signWith?: CryptoKey | Uint8Array } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    aud: MCP_RESOURCE,
    iss: ISSUER,
    azp: CLIENT_ID,
    client_id: CLIENT_ID,
    scope: `${ALL_SCOPES} offline_access`,
    iat: now,
    exp: now + (options.expiresIn ?? 900),
    jti: randomBytes(16).toString('hex'),
    ...claims,
  };
  const consentId =
    MCP_CONSENT_CLAIM in claims
      ? claims[MCP_CONSENT_CLAIM]
      : await currentConsentId(key, base.sub, base.azp, base.aud);
  return new SignJWT({ ...base, [MCP_CONSENT_CLAIM]: consentId })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: options.typ ?? 'at+jwt' })
    .sign(options.signWith ?? key.privateKey);
}

/** Consentimento atual de (usuário, cliente, recurso), como o emissor o lê na emissão. */
async function currentConsentId(
  key: TestKey,
  sub: string,
  clientId: unknown,
  aud: unknown,
): Promise<string | undefined> {
  if (!UUID.test(sub) || typeof clientId !== 'string') return undefined;
  const kind = aud === ADMIN_RESOURCE ? 'ADMIN' : 'USER';
  const [consent] = await key.db
    .select({ id: oauthConsents.id })
    .from(oauthConsents)
    .where(
      and(
        eq(oauthConsents.userId, sub),
        eq(oauthConsents.clientId, clientId),
        consentReferenceCondition(kind),
      ),
    )
    .limit(1);
  return consent?.id;
}

/** Rota que aceita o token do MCP (`@OAuthScopes` no handler), como o teste da lista a lê. */
export type OAuthRoute = {
  method: string;
  /** Caminho completo com os parâmetros (`/v1/manage/spaces/:spaceId/...`). */
  path: string;
  scopes: string[];
  hasView: boolean;
  /** Guards da rota (classe e handler), pelo nome. */
  guards: string[];
  /** Papéis do `@SpaceRoles`/`@SpacePermission` (handler ou classe). */
  spaceRoles: string[];
};

/** Todas as rotas da lista permitida do MCP, lidas dos controllers da app. */
export function oauthRoutes(t: TestApp): OAuthRoute[] {
  const routes: OAuthRoute[] = [];
  for (const module of t.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!type) continue;
      const base = Reflect.getMetadata(PATH_METADATA, type) as string;
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = (type.prototype as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const scopes = Reflect.getMetadata(OAUTH_SCOPES, handler) as string[] | undefined;
        if (!scopes) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const full = ['/v1', base, path].filter((part) => part && part !== '/').join('/');
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, type) as { name: string }[] | undefined) ?? []),
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) as { name: string }[] | undefined) ??
            []),
        ].map((guard) => guard.name);
        routes.push({
          method: method ?? '?',
          path: full.replace(/\/+/g, '/'),
          scopes,
          hasView: Reflect.getMetadata(OAUTH_VIEW, handler) !== undefined,
          guards,
          spaceRoles:
            (Reflect.getMetadata(SPACE_ROLES, handler) as string[] | undefined) ??
            (Reflect.getMetadata(SPACE_ROLES, type) as string[] | undefined) ??
            [],
        });
      }
    }
  }
  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}
