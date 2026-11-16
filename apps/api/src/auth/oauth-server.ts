import { decodeBasicCredentials } from '@better-auth/core/oauth2';
import { type McpResourceKind, OAUTH_OFFLINE_ACCESS_SCOPE } from '@space-sports/shared';
import { APIError } from 'better-auth/api';
import { decodeJwt } from 'jose';
import { type McpResourceConfig, mcpResourceKindOf } from './oauth-resources.js';

// Políticas do servidor de autorização do MCP (Better Auth `mcp` + `cimd`; docs/14-mcp.md 3.1).

/** Token de acesso do MCP: 15 minutos (decisão 111). */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Token de atualização: 30 dias, com rotação a cada uso. */
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Claim própria do token de acesso do MCP com o id do consentimento (a conexão) em que ele foi
 * emitido (BUG-MCP2-1, docs/14-mcp.md 3.3). A API só aceita o token se ela for o id do
 * consentimento atual de (usuário, cliente, recurso): desconectar e conectar de novo cria outro
 * consentimento e corta os tokens da conexão anterior sem depender do relógio.
 */
export const MCP_CONSENT_CLAIM = 'consent_id';

/**
 * Rotas do Better Auth desligadas (404). Ficam só as do fluxo: `/oauth2/authorize`, `/token`,
 * `/consent`, `/continue`, `/revoke`, `/register` (só com MCP_DYNAMIC_CLIENT_REGISTRATION), o
 * metadata e `/jwks`. Os dados do pedido de consentimento vêm de `GET /v1/oauth/consent-request`, e
 * os apps conectados, de `/v1/me/connected-apps`.
 */
export const OAUTH_DISABLED_PATHS = [
  // JWT da sessão do app/web (plugin `jwt`): a sessão não vira token OAuth.
  '/token',
  // CRUD de clientes e consentimentos pelo usuário logado.
  '/oauth2/create-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/client/rotate-keys',
  '/oauth2/public-client',
  '/oauth2/public-client-prelogin',
  '/oauth2/get-consent',
  '/oauth2/get-consents',
  '/oauth2/update-consent',
  '/oauth2/delete-consent',
  // OIDC e introspecção: o MCP valida o JWT pelo JWKS e não pede `openid`.
  '/oauth2/introspect',
  '/oauth2/userinfo',
  '/oauth2/end-session',
  '/oauth2/end-session/confirm',
  '/.well-known/openid-configuration',
];

/**
 * Cliente da asserção do `private_key_jwt`: o `sub` ou, sem ele, o `iss` (como o
 * `verifyClientAssertion` do plugin). Lido sem validar: no `customAccessTokenClaims` o plugin já
 * autenticou o cliente com ela. Malformada: `null`.
 */
export function clientAssertionSubject(assertion: string): string | null {
  try {
    const { sub, iss } = decodeJwt(assertion);
    const clientId = sub ?? iss;
    return typeof clientId === 'string' && clientId ? clientId : null;
  } catch {
    return null;
  }
}

const BASIC_SCHEME = /^Basic +/i;

/**
 * `client_id` do pedido de token, na mesma ordem do `extractClientCredentials` do plugin: a
 * asserção (`client_assertion`), depois o header Basic e por fim o `client_id` do corpo. O plugin
 * já autenticou o cliente quando o `customAccessTokenClaims` roda; isto só descobre qual é, porque
 * o hook não o recebe. Sem cliente identificável: `null`.
 */
export function tokenRequestClientIdOf(
  body: unknown,
  authorization: string | null | undefined,
): string | null {
  const params = (body ?? {}) as { client_id?: unknown; client_assertion?: unknown };
  if (typeof params.client_assertion === 'string' && params.client_assertion) {
    return clientAssertionSubject(params.client_assertion);
  }
  if (authorization && BASIC_SCHEME.test(authorization)) {
    try {
      return decodeBasicCredentials(authorization).clientId || null;
    } catch {
      return null;
    }
  }
  return typeof params.client_id === 'string' && params.client_id ? params.client_id : null;
}

/** Rotas do servidor de autorização (sob /v1/auth): desligadas com MCP_ENABLED=false. */
export function isOAuthServerPath(path: string): boolean {
  return path.startsWith('/oauth2/') || path === '/jwks' || path.startsWith('/.well-known/oauth-');
}

/** Metadata RFC 8414 servido pelo Better Auth dentro de /v1/auth (o da raiz é outro controller). */
export const AUTH_SERVER_METADATA_AUTH_PATH = '/.well-known/oauth-authorization-server';

/**
 * Recursos que o plugin anuncia e a API não oferece: logout por backchannel (não há `end-session`
 * nem cliente com `backchannel_logout_uri`) e DPoP (o MCP e a API só aceitam `Bearer`).
 */
const UNSUPPORTED_METADATA_FIELDS = [
  'backchannel_logout_supported',
  'backchannel_logout_session_supported',
  'dpop_signing_alg_values_supported',
];

/**
 * Metadata do servidor de autorização (RFC 8414) sem o que a API não atende (BUG-MCP-1): todo campo
 * que aponta para uma rota de `OAUTH_DISABLED_PATHS` sai, junto com os campos derivados dele
 * (`introspection_endpoint` leva `introspection_endpoint_auth_methods_supported` etc.), e os
 * recursos de `UNSUPPORTED_METADATA_FIELDS`. Os clientes só descobrem o que funciona.
 */
export function advertisedAuthServerMetadata(
  metadata: Record<string, unknown>,
  authBasePath: string,
): Record<string, unknown> {
  const disabled = new Set<string>(OAUTH_DISABLED_PATHS);
  const removed = Object.entries(metadata)
    .filter(([, value]) => {
      const path = typeof value === 'string' ? authPathOf(value, authBasePath) : null;
      return path !== null && disabled.has(path);
    })
    .map(([key]) => key);
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) =>
        !UNSUPPORTED_METADATA_FIELDS.includes(key) &&
        !removed.some((field) => key === field || key.startsWith(`${field}_`)),
    ),
  );
}

/** Caminho dentro de `authBasePath` de uma URL absoluta (`null` se não for uma rota do Better Auth). */
function authPathOf(value: string, authBasePath: string): string | null {
  if (!URL.canParse(value)) return null;
  const { pathname } = new URL(value);
  return pathname.startsWith(`${authBasePath}/`) ? pathname.slice(authBasePath.length) : null;
}

/** Aplica `advertisedAuthServerMetadata` à resposta do Better Auth (erros passam intactos). */
export async function advertisedAuthServerMetadataResponse(
  response: Response,
  authBasePath: string,
): Promise<Response> {
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('json')) {
    return response;
  }
  const metadata = (await response
    .clone()
    .json()
    .catch(() => null)) as unknown;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(
    JSON.stringify(advertisedAuthServerMetadata(metadata as Record<string, unknown>, authBasePath)),
    { status: response.status, headers },
  );
}

type AuthorizeContext = {
  request?: Request;
  headers?: Headers;
  query?: Record<string, unknown>;
  body?: unknown;
};

/** Mudança de parâmetros do authorize devolvida pelo hook (`query` ou `body`, onde eles estão). */
export type AuthorizeOverride = {
  context: { query: Record<string, unknown> } | { body: Record<string, unknown> };
};

/** A requisição HTTP ao próprio /oauth2/authorize (as reentradas do plugin vêm de outra rota). */
function isHttpAuthorize(ctx: AuthorizeContext): ctx is AuthorizeContext & { request: Request } {
  return Boolean(ctx.request && new URL(ctx.request.url).pathname.endsWith('/oauth2/authorize'));
}

/**
 * Onde o authorize lê os parâmetros: no corpo só no POST HTTP ao próprio /oauth2/authorize; nas
 * reentradas (login com `oauth_query`, consentimento, `continue`), na query já assinada.
 */
function authorizeParamsIn(ctx: AuthorizeContext): 'body' | 'query' {
  return isHttpAuthorize(ctx) && ctx.request.method === 'POST' ? 'body' : 'query';
}

const invalidRequest = (description: string) =>
  new APIError('BAD_REQUEST', { error: 'invalid_request', error_description: description });

/** Consentimento recusado por cadastro incompleto (decisão 119). */
export const OAUTH_PROFILE_INCOMPLETE_MESSAGE =
  'Complete seu cadastro (nome e telefone) no Space Sports antes de conectar um assistente.';

/**
 * Pedidos que concluem o consentimento e podem emitir o código de autorização: "Permitir" no
 * `/autorizar` (`/oauth2/consent` com `accept: true`) e "Continuar como …" no `/entrar`
 * (`/oauth2/continue`). "Cancelar" (`accept: false`) passa: negar não depende do cadastro.
 */
export function concludesOAuthConsent(path: string | undefined, body: unknown): boolean {
  if (path === '/oauth2/continue') return true;
  return path === '/oauth2/consent' && (body as { accept?: unknown } | null)?.accept === true;
}

/**
 * Decisão 119 no servidor (BUG-MCP-2): conta sem nome ou telefone não conclui o consentimento.
 * 403 com `code: PROFILE_INCOMPLETE` (o vocabulário da API, lido pelo web) e `error: access_denied`
 * (RFC 6749, o das rotas OAuth); `details.missing` diz o que falta, como `profile.missing` do
 * `GET /v1/me`.
 */
export const oauthProfileIncomplete = (missing: readonly string[]) =>
  new APIError('FORBIDDEN', {
    error: 'access_denied',
    error_description: `profile incomplete: ${missing.join(', ')}`,
    code: 'PROFILE_INCOMPLETE',
    message: OAUTH_PROFILE_INCOMPLETE_MESSAGE,
    details: { missing },
  });

/**
 * Antes do `/oauth2/authorize`:
 * - PKCE com S256 é obrigatório para todo cliente (o Better Auth exige só para clientes públicos).
 * - `redirect_uri` só HTTPS ou HTTP em loopback, para todo cliente (CIMD inclusive: o documento
 *   poderia listar um esquema próprio de app). Recusa com 400, sem redirecionar para ela.
 * - `offline_access` entra no `scope`: todo cliente do MCP recebe o token de atualização (30 dias,
 *   com rotação), mesmo os que pedem só os escopos do recurso (o metadata do recurso não anuncia
 *   `offline_access`).
 * - Sem `resource` (RFC 8707), o recurso é o do MCP: o token sai sempre como JWT com `aud` do MCP.
 */
export function prepareAuthorizeRequest(
  ctx: AuthorizeContext,
  mcpResource: string,
): AuthorizeOverride | undefined {
  // O consentimento, o `continue` e o login com `oauth_query` rodam o authorize por dentro, com a
  // query já assinada (e já preparada aqui na primeira chamada): só a requisição HTTP ao próprio
  // /oauth2/authorize passa por estas regras.
  if (!isHttpAuthorize(ctx)) return;
  const fromBody = ctx.request.method === 'POST';
  const source = fromBody ? ctx.body : ctx.query;
  const params: Record<string, unknown> =
    source && typeof source === 'object' ? { ...(source as Record<string, unknown>) } : {};

  const challenge = params.code_challenge;
  if (typeof challenge !== 'string' || !challenge || params.code_challenge_method !== 'S256') {
    throw invalidRequest('PKCE is required: send code_challenge with code_challenge_method=S256');
  }
  if (!isAllowedRedirectUri(params.redirect_uri)) {
    throw invalidRequest('redirect_uri must use https, or http on a loopback host');
  }
  if (typeof params.scope === 'string') {
    const scopes = params.scope.split(' ').filter(Boolean);
    if (!scopes.includes(OAUTH_OFFLINE_ACCESS_SCOPE)) scopes.push(OAUTH_OFFLINE_ACCESS_SCOPE);
    params.scope = scopes.join(' ');
  }
  if (params.resource === undefined) params.resource = mcpResource;
  return { context: fromBody ? { body: params } : { query: params } };
}

/** Parâmetros efetivos do authorize: os já preparados pelo hook ou os do contexto, e onde ficam. */
export function authorizeParamsOf(
  ctx: AuthorizeContext,
  prepared?: AuthorizeOverride,
): { where: 'body' | 'query'; params: Record<string, unknown> } {
  const where = authorizeParamsIn(ctx);
  const preparedParams = prepared
    ? 'body' in prepared.context
      ? prepared.context.body
      : prepared.context.query
    : undefined;
  const source = preparedParams ?? (where === 'body' ? ctx.body : ctx.query);
  const params: Record<string, unknown> =
    source && typeof source === 'object' ? { ...(source as Record<string, unknown>) } : {};
  return { where, params };
}

/** Mudança dos parâmetros do authorize, onde eles estão. */
export function authorizeOverride(
  where: 'body' | 'query',
  params: Record<string, unknown>,
): AuthorizeOverride {
  return { context: where === 'body' ? { body: params } : { query: params } };
}

/**
 * Manda o authorize para a tela de consentimento (`prompt=consent`): o plugin redireciona para o
 * `/autorizar` com a query assinada. `prompt=none` não admite tela: 400 com `noPromptError`.
 */
export function withConsentPrompt(
  params: Record<string, unknown>,
  noPromptError: { error: string; error_description: string },
): Record<string, unknown> {
  const prompts = typeof params.prompt === 'string' ? params.prompt.split(' ').filter(Boolean) : [];
  if (prompts.includes('none')) throw new APIError('BAD_REQUEST', noPromptError);
  if (!prompts.includes('consent')) prompts.push('consent');
  return { ...params, prompt: prompts.join(' ') };
}

/**
 * Decisão 119 no authorize (toda entrada: HTTP, login com `oauth_query`, consentimento e
 * `continue`): com sessão e cadastro incompleto, nenhum código sai, nem com o consentimento já
 * salvo. O hook acrescenta `prompt=consent`, e o próprio plugin manda para o `/autorizar` com a
 * query assinada (o web leva ao completar cadastro e volta). Ao "Permitir" com o cadastro completo,
 * o plugin tira o `consent` do prompt e emite o código. `prompt=none` não admite tela: responde
 * `interaction_required` (400, sem redirecionar).
 */
export function requireConsentPage(
  ctx: AuthorizeContext,
  prepared: AuthorizeOverride | undefined,
): AuthorizeOverride {
  const { where, params } = authorizeParamsOf(ctx, prepared);
  return authorizeOverride(
    where,
    withConsentPrompt(params, {
      error: 'interaction_required',
      error_description: 'user profile is incomplete',
    }),
  );
}

/** Política de recursos do authorize (decisões 120 e 123). */
export type AuthorizeResourcePolicy = {
  resources: McpResourceConfig;
  /** `MCP_ADMIN_ENABLED`: desligado, o recurso do Super responde 503 `MCP_DISABLED`. */
  adminEnabled: boolean;
  /** `MCP_ADMIN_ALLOWED_CLIENT_IDS` (vazia recusa todos). */
  adminClientIds: ReadonlySet<string>;
};

const invalidTarget = (description: string) =>
  new APIError('BAD_REQUEST', { error: 'invalid_target', error_description: description });

/** `MCP_ADMIN_ENABLED=false`: o recurso do Super fora do ar (o do jogador segue). */
export const mcpAdminDisabledError = () =>
  new APIError('SERVICE_UNAVAILABLE', {
    error: 'temporarily_unavailable',
    error_description: 'the platform resource is disabled',
    code: 'MCP_DISABLED',
    message: 'O acesso do painel da plataforma por assistentes de IA está desligado no momento.',
  });

/** Cliente fora de `MCP_ADMIN_ALLOWED_CLIENT_IDS` pedindo o recurso do Super. */
export const mcpAdminClientNotAllowedError = () =>
  new APIError('BAD_REQUEST', {
    error: 'unauthorized_client',
    error_description: 'client is not allowed to request this resource',
  });

/**
 * Recurso do pedido de autorização (RFC 8707): exatamente um, e um dos configurados (o token é
 * emitido para um recurso só). Vários `resource`, vazio ou desconhecido: 400 `invalid_target`, sem
 * redirecionar (o `redirect_uri` ainda não foi conferido). No recurso do Super: 503 com
 * `MCP_ADMIN_ENABLED=false` e 400 `unauthorized_client` para cliente fora da lista (`onRejected`
 * recebe o `client_id`, para o log).
 */
export function authorizeResourceOf(
  params: Record<string, unknown>,
  policy: AuthorizeResourcePolicy,
  onRejectedClient: (clientId: string) => void,
): { kind: McpResourceKind; resource: string } {
  const values = Array.isArray(params.resource) ? params.resource : [params.resource];
  if (values.length !== 1) throw invalidTarget('request exactly one resource');
  const [resource] = values;
  const kind = mcpResourceKindOf(policy.resources, resource);
  if (!kind || typeof resource !== 'string')
    throw invalidTarget('requested resource is not available');
  if (kind === 'ADMIN') {
    if (!policy.adminEnabled) throw mcpAdminDisabledError();
    const clientId = typeof params.client_id === 'string' ? params.client_id : '';
    if (!policy.adminClientIds.has(clientId)) {
      onRejectedClient(clientId);
      throw mcpAdminClientNotAllowedError();
    }
  }
  return { kind, resource };
}

/** Nenhum escopo do pedido pode ser concedido à conta (ex.: quem não é Super no recurso do Super). */
export const OAUTH_ACCESS_DENIED_MESSAGE =
  'Sua conta não tem acesso a este conector do Space Sports.';

/**
 * "Permitir" sem nenhum escopo concedível (RN-MCP-06): 403 com `code: OAUTH_ACCESS_DENIED` (lido
 * pelo web) e `error: access_denied` (RFC 6749). Nada é gravado em `oauth_consents`.
 */
export const oauthAccessDenied = () =>
  new APIError('FORBIDDEN', {
    error: 'access_denied',
    error_description: 'no requested scope can be granted to this account',
    code: 'OAUTH_ACCESS_DENIED',
    message: OAUTH_ACCESS_DENIED_MESSAGE,
  });

/**
 * DPoP (RFC 9449) não é oferecido: o MCP e a API só aceitam `Bearer`, e um token preso a uma chave
 * que ninguém confere passaria por Bearer comum. O header `DPoP` e o `dpop_jkt` no authorize ou no
 * token respondem 400 `invalid_request`, em vez de sair um token `DPoP` que o cliente não usaria.
 */
export function rejectDpop(ctx: AuthorizeContext): void {
  const header = ctx.headers?.get('dpop') ?? ctx.request?.headers.get('dpop') ?? null;
  const hasJkt = [ctx.query, ctx.body].some(
    (params) => params !== null && typeof params === 'object' && 'dpop_jkt' in params,
  );
  if (header !== null || hasJkt) {
    throw invalidRequest('DPoP is not supported: use Bearer access tokens');
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `redirect_uri` aceito (registro e authorize): HTTPS ou HTTP em loopback (cliente local). */
export function isAllowedRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false;
  try {
    const url = new URL(uri);
    if (url.username || url.password || url.hash) return false;
    return (
      url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * Registro dinâmico (RFC 7591, só com MCP_DYNAMIC_CLIENT_REGISTRATION): recusa `redirect_uris`
 * fora de HTTPS/loopback (esquemas próprios de app, `javascript:` etc.), antes do Better Auth.
 */
export function rejectInsecureRegistration(body: unknown): void {
  const uris = (body as { redirect_uris?: unknown } | null)?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every(isAllowedRedirectUri)) {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must use https, or http on a loopback host',
    });
  }
}
