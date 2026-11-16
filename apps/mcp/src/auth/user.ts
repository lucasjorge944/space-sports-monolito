import type { AuthInfo } from '@modelcontextprotocol/server';
import { type McpOAuthScope, type McpResourceKind, mcpScopesOf } from '@space-sports/shared';

/** Quem chama, a partir do token já validado: só o necessário para chamar a API e para os logs. */
export interface McpUser {
  /** Id do usuário (`sub`). */
  sub: string;
  /** Id do cliente OAuth (`azp`/`client_id`). */
  clientId: string;
  /**
   * Escopos de permissão do MCP que a superfície aceita (`offline_access`, de protocolo, e os de
   * outro recurso ficam de fora).
   */
  scopes: ReadonlySet<McpOAuthScope>;
  /** O mesmo Bearer do usuário, repassado à API. Nunca vai para log nem para a saída das tools. */
  token: string;
}

/**
 * Claims verificados (assinatura, `iss`, `aud`, `exp`) → `AuthInfo` do SDK; `null` se faltar algo
 * ou se o token tiver mais de uma audiência. Os escopos ficam só os do recurso da superfície
 * (`resource`).
 */
export function toAuthInfo(
  claims: Record<string, unknown>,
  token: string,
  resourceUrl: string,
  resource: McpResourceKind,
): AuthInfo | null {
  // Um recurso por token (RN-MCP-01): o `jose` aceita um `aud` em lista que CONTENHA a URL do
  // recurso, então um token emitido para os dois recursos passaria nas duas superfícies. Só vale a
  // audiência única e igual à da superfície (texto, ou lista com um item só).
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length !== 1 || audiences[0] !== resourceUrl) return null;
  const sub = claims.sub;
  const clientId = claims.client_id ?? claims.azp;
  if (typeof sub !== 'string' || !sub || typeof clientId !== 'string' || !clientId) return null;
  // Token sem usuário (ex.: client credentials, em que o `sub` é o próprio cliente): recusado.
  if (sub === clientId) return null;
  return {
    token,
    clientId,
    scopes: typeof claims.scope === 'string' ? mcpScopesOf(claims.scope, resource) : [],
    ...(typeof claims.exp === 'number' ? { expiresAt: claims.exp } : {}),
    resource: new URL(resourceUrl),
    extra: { sub },
  };
}

export function userFromAuthInfo(info: AuthInfo | undefined): McpUser | undefined {
  const sub = info?.extra?.sub;
  if (!info || typeof sub !== 'string') return undefined;
  return {
    sub,
    clientId: info.clientId,
    scopes: new Set(mcpScopesOf(info.scopes)),
    token: info.token,
  };
}
