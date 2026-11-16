import { AsyncLocalStorage } from 'node:async_hooks';

/** Requisição feita com o token OAuth do MCP; preenchida pelo OAuthOriginInterceptor. */
export const oauthOriginContext = new AsyncLocalStorage<{ clientId: string }>();

/** Origem gravada no `diff` da auditoria das escritas pelo MCP (RN-MCP-03). */
export const MCP_AUDIT_ORIGIN = 'MCP';

/**
 * Toda requisição com o token do recurso do Super (decisão 123): uma linha em `audit_logs` gravada
 * logo depois de conferir a assinatura e a audiência, completada com o resultado ao fim da resposta.
 */
export const MCP_ADMIN_AUDIT_ACTION = 'mcp.admin_request';

/** Parâmetros da query gravados na auditoria: no máximo 30, com 500 caracteres. */
const AUDIT_QUERY_MAX_KEYS = 30;
const AUDIT_QUERY_MAX_LENGTH = 500;

/** Query crua da requisição para a auditoria (nunca o corpo da resposta nem o token). */
export function auditQueryOf(originalUrl: string): Record<string, string | string[]> {
  const search = originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?') + 1) : '';
  const params = new URLSearchParams(search);
  const query: Record<string, string | string[]> = {};
  for (const key of [...new Set(params.keys())].slice(0, AUDIT_QUERY_MAX_KEYS)) {
    const values = params.getAll(key).map((value) => value.slice(0, AUDIT_QUERY_MAX_LENGTH));
    query[key.slice(0, AUDIT_QUERY_MAX_LENGTH)] = values.length === 1 ? (values[0] ?? '') : values;
  }
  return query;
}
