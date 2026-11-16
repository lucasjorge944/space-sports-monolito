import {
  MCP_OAUTH_SCOPE_LABELS,
  MCP_SCOPE_GROUP_LABELS,
  MCP_SCOPE_GROUPS,
  type McpScopeGroup,
  mcpScopeGroupOf,
  mcpScopesOf,
} from '@space-sports/shared';
import { formatDateTime, formatInstantDate } from '@/lib/datetime';

// Textos de "Apps conectados" (RF-MCP-05; docs/14-mcp.md, 3.4; docs/05, "Apps conectados").

/** Padrão: o MCP de produção (docs/14-mcp.md). Staging e dev trocam por `EXPO_PUBLIC_MCP_URL`. */
export const DEFAULT_MCP_CONNECT_URL = 'https://mcp.spacesports.com.br/mcp';

/** Valor de `EXPO_PUBLIC_MCP_URL` sem espaços nem barra final; vazio cai no padrão. */
export function normalizeMcpUrl(raw: string | undefined): string {
  const url = raw?.trim().replace(/\/+$/, '');
  return url || DEFAULT_MCP_CONNECT_URL;
}

// O Expo só injeta `process.env.EXPO_PUBLIC_*` quando a leitura é literal.
/** URL do servidor MCP que a pessoa cola no assistente para conectar (por ambiente). */
export const MCP_CONNECT_URL = normalizeMcpUrl(process.env.EXPO_PUBLIC_MCP_URL);

/** Grupo de escopos já com os textos em português (RF-MCP-06; docs/14-mcp.md, 8.1). */
export type ScopeGroupView = { group: McpScopeGroup; title: string; labels: string[] };

/**
 * Escopos agrupados como no consentimento ("Como jogador", "Gestão dos seus espaços", "Painel da
 * plataforma"), na ordem canônica; grupos sem escopo não aparecem.
 */
export function scopeGroups(scopes: readonly string[]): ScopeGroupView[] {
  const granted = mcpScopesOf(scopes);
  return MCP_SCOPE_GROUPS.map((group) => ({
    group,
    title: MCP_SCOPE_GROUP_LABELS[group],
    labels: granted
      .filter((s) => mcpScopeGroupOf(s) === group)
      .map((s) => MCP_OAUTH_SCOPE_LABELS[s]),
  })).filter((g) => g.labels.length > 0);
}

/** Os títulos dos grupos só ajudam quando há mais de um grupo ou o grupo não é o de jogador. */
export function showScopeGroupTitles(groups: readonly ScopeGroupView[]): boolean {
  return groups.length > 1 || groups.some((g) => g.group !== 'PLAYER');
}

/** "Conectado em 13/11/2026". */
export function connectedAtLabel(authorizedAt: string): string {
  return `Conectado em ${formatInstantDate(authorizedAt)}`;
}

/** "Último uso: 13/11/2026" ou "Ainda não usado". */
export function lastUsedLabel(lastUsedAt: string | null): string {
  return lastUsedAt ? `Último uso: ${formatInstantDate(lastUsedAt)}` : 'Ainda não usado';
}

/**
 * Prazo da conexão (só o conector da plataforma tem): "Esta conexão expira em 13/11/2026, 19:00"
 * ou, vencida, "Conexão expirada em 13/11/2026, 19:00. Conecte de novo no assistente.". Sem prazo,
 * `null`.
 */
export function expiresAtLabel(
  expiresAt: string | null,
  now: number = Date.now(),
): { text: string; expired: boolean } | null {
  if (!expiresAt) return null;
  const when = formatDateTime(expiresAt);
  return Date.parse(expiresAt) <= now
    ? { text: `Conexão expirada em ${when}. Conecte de novo no assistente.`, expired: true }
    : { text: `Esta conexão expira em ${when}`, expired: false };
}

/** Título e texto do alerta de confirmação do "Desconectar". */
export function disconnectConfirmation(appName: string): { title: string; message: string } {
  return {
    title: `Desconectar ${appName}?`,
    message:
      'Ele perde o acesso à sua conta na hora e não consegue mais ver nem fazer reservas ou aulas por você. Você pode conectar de novo quando quiser.',
  };
}
