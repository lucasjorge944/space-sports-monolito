import {
  MCP_ADMIN_CONNECTION_MAX_AGE_SECONDS,
  MCP_RESOURCE_SCOPES,
  type McpOAuthScope,
  type McpResourceKind,
  mcpScopesOf,
  OAUTH_OFFLINE_ACCESS_SCOPE,
  type PlatformRole,
  type SpaceRole,
} from '@space-sports/shared';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { oauthConsents, spaceMembers, users } from '../db/schema/index.js';

// Recursos OAuth do MCP (decisão 120; docs/14-mcp.md 8.1): o do jogador (`MCP_RESOURCE_URL`,
// jogador e gestão) e o do Super (`MCP_ADMIN_RESOURCE_URL`). Um token vale para um recurso só.

/**
 * `referenceId` do consentimento do recurso do Super (`postLogin.consentReferenceId` do Better
 * Auth). O do jogador fica sem referência (como na fase 1): o mesmo cliente (ex.: o Claude) pode
 * estar conectado aos dois recursos, cada um com o seu consentimento, os seus escopos e os seus
 * tokens de atualização.
 */
export const MCP_ADMIN_CONSENT_REFERENCE = 'mcp-admin';

/** Duração máxima da conexão com o recurso do Super, em ms (decisão 123). */
export const MCP_ADMIN_CONNECTION_MAX_AGE_MS = MCP_ADMIN_CONNECTION_MAX_AGE_SECONDS * 1000;

export type McpResourceConfig = {
  /** `MCP_RESOURCE_URL`. */
  user: string;
  /** `MCP_ADMIN_RESOURCE_URL`; nulo = o recurso do Super não existe. */
  admin: string | null;
};

export function mcpResourceConfigOf(
  env: Pick<Env, 'MCP_RESOURCE_URL' | 'MCP_ADMIN_RESOURCE_URL'>,
): McpResourceConfig {
  return { user: env.MCP_RESOURCE_URL, admin: env.MCP_ADMIN_RESOURCE_URL ?? null };
}

/** Recurso de uma URL (`resource`/`aud`); `null` se não for um dos recursos configurados. */
export function mcpResourceKindOf(config: McpResourceConfig, url: unknown): McpResourceKind | null {
  if (typeof url !== 'string') return null;
  if (url === config.user) return 'USER';
  if (config.admin && url === config.admin) return 'ADMIN';
  return null;
}

/** `referenceId` do consentimento de cada recurso (nulo no do jogador). */
export function consentReferenceOf(kind: McpResourceKind): string | null {
  return kind === 'ADMIN' ? MCP_ADMIN_CONSENT_REFERENCE : null;
}

/** Recurso de um consentimento pelo `referenceId` (sem referência: o do jogador). */
export function resourceKindOfReference(reference: string | null | undefined): McpResourceKind {
  return reference === MCP_ADMIN_CONSENT_REFERENCE ? 'ADMIN' : 'USER';
}

/** Condição SQL do consentimento do recurso (o do jogador aceita referência nula ou vazia). */
export function consentReferenceCondition(kind: McpResourceKind) {
  return kind === 'ADMIN'
    ? eq(oauthConsents.referenceId, MCP_ADMIN_CONSENT_REFERENCE)
    : or(isNull(oauthConsents.referenceId), eq(oauthConsents.referenceId, ''));
}

/** Papel na plataforma e papéis ativos em algum espaço: o que decide os escopos concedíveis. */
export type OAuthEligibility = {
  platformRole: PlatformRole;
  spaceRoles: ReadonlySet<SpaceRole>;
};

/**
 * Escopos que a conta pode receber em cada recurso (RN-MCP-06, decisões 121 e 123):
 * - jogador: os cinco da fase 1, sempre;
 * - `manage:read`: papel ativo (Dono, Admin ou Professor) em algum espaço;
 * - `manage:finance:read`: Dono ou Admin em algum espaço;
 * - `super:read` (só no recurso do Super): ser Super.
 * O papel em cada espaço continua valendo nas rotas (o Professor nunca vê valores, decisão 53).
 */
export function eligibleScopes(
  kind: McpResourceKind,
  { platformRole, spaceRoles }: OAuthEligibility,
): McpOAuthScope[] {
  const eligible = new Set<McpOAuthScope>();
  if (kind === 'ADMIN') {
    if (platformRole === 'SUPER') eligible.add('super:read');
  } else {
    for (const scope of [
      'spaces:read',
      'bookings:read',
      'bookings:write',
      'classes:read',
      'classes:write',
    ] as const) {
      eligible.add(scope);
    }
    if (spaceRoles.size > 0) eligible.add('manage:read');
    if (spaceRoles.has('OWNER') || spaceRoles.has('ADMIN')) eligible.add('manage:finance:read');
  }
  return MCP_RESOURCE_SCOPES[kind].filter((scope) => eligible.has(scope));
}

/** Papel na plataforma e papéis ativos em espaços do usuário (nulo se a conta não existe). */
export async function loadOAuthEligibility(
  db: Database,
  userId: string,
): Promise<OAuthEligibility | null> {
  const rows = await db
    .select({ platformRole: users.platformRole, role: spaceMembers.role })
    .from(users)
    .leftJoin(
      spaceMembers,
      and(eq(spaceMembers.userId, users.id), eq(spaceMembers.status, 'ACTIVE')),
    )
    .where(eq(users.id, userId));
  const [first] = rows;
  if (!first) return null;
  return {
    platformRole: first.platformRole,
    spaceRoles: new Set(rows.flatMap((row) => (row.role ? [row.role] : []))),
  };
}

/**
 * O authorize pediu só escopos de protocolo (`offline_access`), sem nenhum do recurso? O Claude
 * (CIMD) conecta assim, mesmo com o `scope` no desafio do 401 e no metadata. Vale como pedido sem
 * `scope`: todos os do recurso, que a elegibilidade da conta ainda filtra. Só no authorize, nunca
 * no "Permitir" (lá, a escolha da tela manda).
 */
export function requestsOnlyProtocolScopes(scope: unknown): boolean {
  return (
    typeof scope === 'string' &&
    scope.split(' ').every((item) => item === '' || item === OAUTH_OFFLINE_ACCESS_SCOPE)
  );
}

/**
 * `scope` do pedido restrito ao recurso (escopos de outro recurso e desconhecidos saem), na ordem
 * canônica e com `offline_access` (o token de atualização). Sem `scope`, todos os do recurso.
 * `permission` diz quantos escopos de permissão sobraram.
 */
export function scopeForResource(
  kind: McpResourceKind,
  scope: unknown,
  eligible?: readonly McpOAuthScope[],
): { scope: string; permissions: McpOAuthScope[] } {
  const requested =
    typeof scope === 'string' ? mcpScopesOf(scope, kind) : [...MCP_RESOURCE_SCOPES[kind]];
  const permissions = eligible ? requested.filter((item) => eligible.includes(item)) : requested;
  return { scope: [...permissions, OAUTH_OFFLINE_ACCESS_SCOPE].join(' '), permissions };
}

/** A conexão com o recurso do Super passou das 24 horas desde o consentimento (decisão 123)? */
export function adminConnectionExpired(consentCreatedAt: Date, now = Date.now()): boolean {
  return consentCreatedAt.getTime() + MCP_ADMIN_CONNECTION_MAX_AGE_MS <= now;
}
