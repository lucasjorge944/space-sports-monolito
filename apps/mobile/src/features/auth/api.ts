import { configureApiClient } from '@space-sports/api-client';
import { API_URL } from './config';
import { clearSessionToken, getSessionToken, setSessionToken } from './token-storage';

export const SIGN_OUT_PATH = '/v1/auth/sign-out';
const AUTH_TOKEN_HEADER = 'set-auth-token';

export interface SetupApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Registra quem reage a um 401 num token que o app mandou (sessão expirada ou revogada).
 * Devolve a função que remove o registro.
 */
export function onSessionRejected(handler: UnauthorizedHandler): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

function sentBearer(init: RequestInit | undefined): boolean {
  return new Headers(init?.headers).has('authorization');
}

function pathOf(input: string | { url: string } | { href: string }): string {
  const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Rotas que vão sempre sem `Authorization`, mesmo logado: os anúncios não ligam a entrega nem as
 * métricas à pessoa (RN-ADS-03).
 */
const ANONYMOUS_PATHS = new Set(['/v1/ads', '/v1/ads/events']);

export function isAnonymousPath(url: string): boolean {
  return ANONYMOUS_PATHS.has(pathOf(url).split(/[?#]/)[0]?.replace(/\/+$/, '') ?? '');
}

/** 403 `ACCOUNT_INACTIVE`: a conta foi inativada (em outro aparelho ou pelo suporte); a sessão não vale mais. */
async function isAccountInactive(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } } | null;
    return body?.error?.code === 'ACCOUNT_INACTIVE';
  } catch {
    return false;
  }
}

/**
 * Liga o cliente da API à sessão do app: manda `Authorization: Bearer <token>` (menos nas rotas
 * anônimas dos anúncios) e guarda o token
 * novo que o login, o cadastro e a troca de senha devolvem no header `set-auth-token` (o mutator só devolve o
 * corpo, então o header é lido aqui, no `fetch`).
 */
export function setupApiClient({
  baseUrl = API_URL,
  fetch: baseFetch,
}: SetupApiClientOptions = {}): void {
  configureApiClient({
    baseUrl,
    // Sessão só por Bearer. O `fetch` do expo usa `include` por padrão e guardaria o cookie nativo;
    // o cookie seguinte faria a checagem de origem do Better Auth recusar os POSTs (sem Origin).
    credentials: 'omit',
    headers: async ({ url }) => {
      if (isAnonymousPath(url)) return undefined;
      const token = await getSessionToken();
      return token ? { Authorization: `Bearer ${token}` } : undefined;
    },
    fetch: async (input, init) => {
      const response = await (baseFetch ?? globalThis.fetch)(input, init);
      const token = response.headers.get(AUTH_TOKEN_HEADER);
      if (token) await setSessionToken(token);
      if (
        sentBearer(init) &&
        pathOf(input) !== SIGN_OUT_PATH &&
        (response.status === 401 || (await isAccountInactive(response)))
      ) {
        await clearSessionToken();
        unauthorizedHandler?.();
      }
      return response;
    },
  });
}
