import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { MCP_OAUTH_SCOPES } from '@space-sports/shared';
import {
  API_URL,
  CIMD_ORIGIN,
  E2E_PASSWORD,
  ISSUER,
  MCP_URL,
  REDIRECT_URI,
  WEB_ORIGIN,
} from './env.js';

export const ALL_SCOPES = MCP_OAUTH_SCOPES.join(' ');

/**
 * Para onde vão as chamadas de API/OAuth. Padrão: a API principal do e2e. Os casos que sobem outra API
 * (chaves de emergência) apontam para ela com `useTarget` e voltam com `resetTarget` (os arquivos
 * rodam em sequência, então não há corrida).
 */
export const target = { api: API_URL, issuer: ISSUER, resource: MCP_URL };
export function useTarget(api: string, resource: string) {
  target.api = api;
  target.issuer = `${api}/v1/auth`;
  target.resource = resource;
}
export function resetTarget() {
  target.api = API_URL;
  target.issuer = ISSUER;
  target.resource = MCP_URL;
}
export const CLIENT_ID = `${CIMD_ORIGIN}/claude.json`;

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Pequeno "navegador": guarda os cookies da API/web e nunca segue redirect sozinho. */
export class Browser {
  private cookies = new Map<string, string>();

  constructor(private readonly base = target.api) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * `node:http` em vez de `fetch`: o fetch do Node manda `sec-fetch-mode: cors`, e o servidor de
   * autorização responde `{ redirect: true, url }` (200) a quem parece um fetch de página. Uma
   * navegação de verdade não manda esse cabeçalho e recebe o 302.
   */
  request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('cookie', this.cookieHeader);
    const url = new URL(path.startsWith('http') ? path : `${this.base}${path}`);
    const payload = typeof init.body === 'string' ? init.body : undefined;
    if (payload !== undefined) headers.set('content-length', String(Buffer.byteLength(payload)));
    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method: init.method ?? 'GET', headers: Object.fromEntries(headers) },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            const out = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              for (const v of Array.isArray(value) ? value : [value]) {
                if (v !== undefined) out.append(name, v);
              }
            }
            for (const line of out.getSetCookie()) {
              const [pair] = line.split(';');
              const index = pair?.indexOf('=') ?? -1;
              if (pair && index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
            }
            const status = incoming.statusCode ?? 0;
            const nullBody = status === 204 || status === 304;
            resolve(
              new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: out }),
            );
          });
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  /** POST JSON com a origem do web (como as chamadas do `/entrar` pelo rewrite do Next). */
  postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  }
}

export interface AuthorizeParams {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  resource?: string | null;
  challenge: string;
  method?: string | null;
  extra?: Record<string, string>;
}

export function authorizeUrl(p: AuthorizeParams): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId ?? CLIENT_ID,
    redirect_uri: p.redirectUri ?? REDIRECT_URI,
    scope: p.scope ?? ALL_SCOPES,
    state: p.state ?? 'estado-e2e',
  });
  if (p.challenge) query.set('code_challenge', p.challenge);
  if (p.method !== null) query.set('code_challenge_method', p.method ?? 'S256');
  if (p.resource !== null) query.set('resource', p.resource ?? target.resource);
  for (const [k, v] of Object.entries(p.extra ?? {})) query.set(k, v);
  return `${target.issuer}/oauth2/authorize?${query}`;
}

export const searchOf = (url: string) => new URL(url).search.slice(1);

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${message} (${status}): ${JSON.stringify(body)}`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: corpos JSON livres das rotas sob teste.
async function json(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Login por e-mail e senha DENTRO do fluxo OAuth (como o `/entrar`), com a query assinada. */
export async function signInInFlow(
  browser: Browser,
  email: string,
  oauthQuery: string,
  password = E2E_PASSWORD,
) {
  const res = await browser.postJson('/v1/auth/sign-in/email', {
    email,
    password,
    oauth_query: oauthQuery,
  });
  return { res, body: await json(res) };
}

export interface ConnectOptions extends Partial<AuthorizeParams> {
  browser?: Browser;
  /** Escopos que o usuário MARCA no consentimento (subconjunto do pedido). */
  consentScope?: string;
  /** Clica em "Cancelar" no consentimento. */
  deny?: boolean;
  /** Conta já tem sessão: pula o login. */
  loggedIn?: boolean;
  password?: string;
}

/** Resposta de `GET /v1/oauth/consent-request`. */
export interface ConsentRequest {
  client: {
    clientId: string;
    name: string;
    host: string;
    uri: string | null;
    logoUrl: string | null;
  };
  scopes: string[];
  expiresAt: string;
  /** Fase 2 (MCP2.1/2.5): o conector, o que a conta não pode usar e se há algo a permitir. */
  resource: { kind: 'USER' | 'ADMIN'; name: string; maxConnectionHours: number | null };
  deniedScopes: string[];
  canAuthorize: boolean;
}

export interface Connected {
  browser: Browser;
  tokens: TokenSet;
  verifier: string;
  clientId: string;
  consentRequest?: ConsentRequest;
}

export interface Authorized {
  browser: Browser;
  code: string;
  verifier: string;
  clientId: string;
  consentRequest?: ConsentRequest;
}

/**
 * Fluxo por HTTP, sem navegador, até o CÓDIGO: authorize (PKCE S256) → 302 para o `/entrar` do web →
 * login com a query assinada → `/autorizar` → consent-request → consentimento → código.
 */
export async function authorizeForCode(
  email: string,
  options: ConnectOptions = {},
): Promise<Authorized> {
  const browser = options.browser ?? new Browser();
  const { verifier, challenge } = pkce();
  const clientId = options.clientId ?? CLIENT_ID;
  const url = authorizeUrl({ ...options, clientId, challenge });

  const res = await browser.request(url);
  if (res.status !== 302) throw new OAuthError('authorize', res.status, await json(res));
  let location = new URL(res.headers.get('location') ?? '', WEB_ORIGIN);

  if (location.pathname === '/entrar' && !options.loggedIn) {
    const login = await signInInFlow(browser, email, location.search.slice(1), options.password);
    if (login.res.status !== 200) throw new OAuthError('login', login.res.status, login.body);
    location = new URL(login.body.url, WEB_ORIGIN);
  } else if (location.pathname === '/entrar') {
    const next = await browser.postJson('/v1/auth/oauth2/continue', {
      selected: true,
      oauth_query: location.search.slice(1),
    });
    const body = await json(next);
    if (next.status !== 200) throw new OAuthError('continue', next.status, body);
    location = new URL(body.url, WEB_ORIGIN);
  }

  let consentRequest: ConsentRequest | undefined;
  if (location.pathname === '/autorizar') {
    const oauthQuery = location.search.slice(1);
    const info = await browser.request(
      `/v1/oauth/consent-request?oauthQuery=${encodeURIComponent(oauthQuery)}`,
    );
    consentRequest = await json(info);
    if (info.status !== 200) throw new OAuthError('consent-request', info.status, consentRequest);
    const consent = await browser.postJson('/v1/auth/oauth2/consent', {
      accept: !options.deny,
      ...(options.consentScope ? { scope: options.consentScope } : {}),
      oauth_query: oauthQuery,
    });
    const body = await json(consent);
    if (consent.status !== 200) throw new OAuthError('consent', consent.status, body);
    location = new URL(body.url);
  }

  const redirect = options.redirectUri ?? REDIRECT_URI;
  if (!`${location.origin}${location.pathname}`.startsWith(redirect.split('?')[0] ?? redirect)) {
    throw new OAuthError('redirect inesperado', 0, location.href);
  }
  const error = location.searchParams.get('error');
  if (error) throw new OAuthError(`cliente recebeu erro ${error}`, 0, location.href);
  const code = location.searchParams.get('code');
  if (!code) throw new OAuthError('sem código', 0, location.href);
  return { browser, code, verifier, clientId, consentRequest };
}

/** Fluxo completo: o código acima trocado por tokens. */
export async function connect(email: string, options: ConnectOptions = {}): Promise<Connected> {
  const authorized = await authorizeForCode(email, options);
  const tokens = await exchangeCode(authorized.code, authorized.verifier, options);
  return {
    browser: authorized.browser,
    tokens,
    verifier: authorized.verifier,
    clientId: authorized.clientId,
    consentRequest: authorized.consentRequest,
  };
}

export async function tokenRequest(form: Record<string, string>): Promise<Response> {
  return fetch(`${target.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
}

export async function exchangeCode(
  code: string,
  verifier: string,
  options: { clientId?: string; redirectUri?: string; resource?: string | null } = {},
): Promise<TokenSet> {
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: options.redirectUri ?? REDIRECT_URI,
    client_id: options.clientId ?? CLIENT_ID,
    code_verifier: verifier,
  };
  if (options.resource !== null) form.resource = options.resource ?? target.resource;
  const res = await tokenRequest(form);
  const body = await json(res);
  if (res.status !== 200) throw new OAuthError('token', res.status, body);
  return body as TokenSet;
}

export async function refreshTokens(refreshToken: string, clientId = CLIENT_ID) {
  const res = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource: target.resource,
  });
  return { status: res.status, body: await json(res) };
}

export function decodeJwt(token: string) {
  const [header, payload] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header ?? '', 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
  };
}

/** Sessão normal do app/web (e-mail e senha): cookie + token opaco do app (`set-auth-token`). */
export async function appSession(email: string, password = E2E_PASSWORD) {
  const browser = new Browser();
  const res = await browser.postJson('/v1/auth/sign-in/email', { email, password });
  const body = await json(res);
  if (res.status !== 200) throw new OAuthError('sign-in', res.status, body);
  const token = res.headers.get('set-auth-token') ?? body.token;
  return { browser, token: token as string, body };
}

/** Chamada direta à API com Bearer. */
export async function api(
  path: string,
  token: string,
  init: RequestInit & { json?: unknown } = {},
  baseUrl = target.api,
) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  return { status: res.status, headers: res.headers, body: await json(res) };
}

/** Apps conectados da conta (sessão do app): lista e desconecta todos. Devolve quantos desconectou. */
export async function disconnectAll(email: string): Promise<number> {
  const { token } = await appSession(email);
  const list = await api('/v1/me/connected-apps', token);
  for (const app of list.body.items as { id: string }[]) {
    const res = await api(`/v1/me/connected-apps/${app.id}`, token, { method: 'DELETE' });
    if (res.status !== 204) throw new OAuthError('desconectar', res.status, res.body);
  }
  return (list.body.items as unknown[]).length;
}
