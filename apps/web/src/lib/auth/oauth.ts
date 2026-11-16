// Fluxo OAuth do MCP no web (docs/14-mcp.md seção 3.5): /entrar → /autorizar → redirect_uri do cliente.
// A query assinada pelo Better Auth vem do authorize da API e é repassada sem alteração; quem monta
// o `oauth_query` dos POSTs é o `oauthProviderClient()` do authClient.

export const AUTHORIZE_PATH = '/autorizar';
export const CONNECTED_APPS_PATH = '/conta/apps-conectados';

import type { SearchParams } from './search-params';

type ParamsLike = { get(name: string): string | null };

/** O `/entrar` reconhece o fluxo OAuth pela presença de `sig` e `client_id` na URL. */
export function isOAuthFlow(params: ParamsLike): boolean {
  return Boolean(params.get('sig') && params.get('client_id'));
}

/** `/entrar` com a query assinada (sem o `?`), para voltar ao fluxo depois de entrar/trocar de conta. */
export function oauthLoginPath(query: string): string {
  return query ? `/entrar?${query}` : '/entrar';
}

/** O pedido de consentimento aponta o Permitir/Cancelar para o cliente: `https:` ou `http:` em loopback. */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Destino devolvido pela API nas rotas do fluxo (`{ redirect: true, url }`): o `/autorizar` (caminho
 * interno) ou o `redirect_uri` do cliente. Só aceita caminho interno, `https:` ou `http:` em loopback;
 * qualquer outro esquema (`javascript:`, `data:`…) é descartado, mesmo que a API já valide.
 */
export function safeOAuthRedirect(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return parsed.toString();
    if (parsed.protocol === 'http:' && isLoopback(parsed.hostname)) return parsed.toString();
  } catch {
    // URL inválida
  }
  return undefined;
}

/** Corpo `{ redirect, url }` das respostas do sign-in, `continue` e `consent`. */
export function redirectTarget(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { redirect, url } = data as { redirect?: unknown; url?: unknown };
  return redirect === true ? safeOAuthRedirect(url) : undefined;
}

/** `http(s)` apenas: logo e página do cliente vêm do documento dele e não são confiáveis. */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Só `https:`: a logo é um subrecurso carregado da origem do cliente, e `http:` é conteúdo misto. */
export function safeHttpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

type FailureLike = { status?: number; error?: string; code?: string } | null | undefined;

/**
 * Falha do `consent`/`continue` que não se resolve tentando de novo: pedido adulterado, vencido ou
 * de cliente que não existe mais (400/404 ou `invalid_signature`). A pessoa precisa recomeçar no assistente.
 */
export function isConsentRequestGone(failure: FailureLike): boolean {
  if (!failure) return false;
  return (
    failure.status === 400 ||
    failure.status === 404 ||
    failure.error === 'invalid_signature' ||
    failure.error === 'invalid_request' ||
    failure.code === 'OAUTH_REQUEST_INVALID' ||
    failure.code === 'OAUTH_CLIENT_NOT_FOUND'
  );
}

/**
 * "Permitir" recusado por cadastro incompleto (decisão 119): 403 `PROFILE_INCOMPLETE`, que a API
 * manda com `error: access_denied` (RFC 6749) e por isso se parece com a falta de acesso. A tela
 * leva a `/completar-cadastro` e volta ao pedido, em vez de dizer "sem acesso".
 */
export function isConsentProfileIncomplete(failure: FailureLike): boolean {
  return failure?.code === 'PROFILE_INCOMPLETE';
}

/**
 * "Permitir" recusado porque a conta ou o cliente não pode usar o conector: 403 `OAUTH_ACCESS_DENIED`
 * (nenhum escopo concedível, RN-MCP-06) ou 400 `unauthorized_client` (cliente fora da lista do Super).
 * A tela mostra "sua conta não tem acesso" e nada é gravado. Vem antes do 400 genérico de "pedido
 * vencido" (`isConsentRequestGone`), que também cobre status 400.
 */
export function isConsentAccessDenied(failure: FailureLike): boolean {
  if (!failure || isConsentProfileIncomplete(failure)) return false;
  return (
    failure.code === 'OAUTH_ACCESS_DENIED' ||
    failure.error === 'unauthorized_client' ||
    (failure.status === 403 && failure.error === 'access_denied')
  );
}

/** O conector está desligado no servidor (503 `MCP_DISABLED`): tentar de novo não resolve agora. */
export function isConsentUnavailable(failure: FailureLike): boolean {
  if (!failure) return false;
  return failure.code === 'MCP_DISABLED' || failure.error === 'temporarily_unavailable';
}

/** O pedido de consentimento já passou do prazo (`expiresAt`)? */
export function isConsentExpired(expiresAt: string, now: number = Date.now()): boolean {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) && now >= end;
}

/** Parâmetros da página de volta em query string (sem o `?`), na ordem em que vieram. */
export function queryStringOf(params: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item);
    }
  }
  return query.toString();
}
