import {
  MCP_OAUTH_SCOPE_LABELS,
  MCP_SCOPE_GROUP_LABELS,
  MCP_SCOPE_GROUPS,
  type McpResourceKind,
  type McpScopeGroup,
  mcpScopeGroupOf,
  mcpScopesOf,
} from '@space-sports/shared';

// Escopos do MCP nas telas (consentimento e Apps conectados; docs/14-mcp.md 8.1, decisões 120 a 123).
// Os textos dos escopos e dos grupos vêm de `packages/shared`; aqui ficam só as regras de exibição.

export type ScopeGroupView = {
  group: McpScopeGroup;
  label: string;
  items: { scope: string; label: string }[];
  /** Explicação que acompanha o grupo (só a gestão: vale por espaço e o Professor não vê valores). */
  note: string | null;
};

const GROUP_NOTES: Partial<Record<McpScopeGroup, string>> = {
  MANAGE:
    'Vale para os espaços em que você é da equipe, com o seu papel em cada um. O Professor não vê valores.',
};

/**
 * Escopos agrupados na ordem das telas (jogador, gestão, plataforma), com os textos de
 * `packages/shared`. Escopo que o web não conhece (API mais nova) e `offline_access` são descartados,
 * e grupo vazio não aparece.
 */
export function groupScopes(scopes: readonly string[]): ScopeGroupView[] {
  const known = mcpScopesOf(scopes);
  return MCP_SCOPE_GROUPS.flatMap((group) => {
    const items = known
      .filter((scope) => mcpScopeGroupOf(scope) === group)
      .map((scope) => ({ scope, label: MCP_OAUTH_SCOPE_LABELS[scope] }));
    return items.length > 0
      ? [{ group, label: MCP_SCOPE_GROUP_LABELS[group], items, note: GROUP_NOTES[group] ?? null }]
      : [];
  });
}

/** O assistente poderá gravar (reservar, cancelar, confirmar presença) com estes escopos? */
export function canWrite(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope === 'bookings:write' || scope === 'classes:write');
}

/**
 * Por que a conta não recebe algum escopo do conector (`deniedScopes`), em frases para a tela.
 * Sem papel em espaço nenhum, a gestão inteira some (e o financeiro junto, sem nota repetida);
 * com papel mas sem ser Dono ou Admin, só os valores ficam de fora.
 */
export function deniedNotes(denied: readonly string[]): string[] {
  const notes: string[] = [];
  if (denied.includes('manage:read')) {
    notes.push(
      'Gestão dos seus espaços: sua conta não é da equipe de nenhum espaço, então esse acesso não será concedido.',
    );
  } else if (denied.includes('manage:finance:read')) {
    notes.push(
      'Valores e financeiro dos espaços: só Dono e Admin têm acesso, então esse acesso não será concedido.',
    );
  }
  if (denied.includes('super:read')) {
    notes.push('Painel da plataforma: só quem administra a plataforma tem acesso.');
  }
  return notes;
}

/** Texto fixo do aviso do conector da plataforma (decisão 123). */
export function platformNotice(maxConnectionHours: number | null): string {
  const base =
    'O assistente vai poder LER dados de todos os espaços da plataforma. Somente leitura';
  return maxConnectionHours
    ? `${base}; a conexão vale por até ${maxConnectionHours} horas.`
    : `${base}.`;
}

/** Conexão com prazo (conector da plataforma): ainda vale ou já venceu? Sem prazo, `null`. */
export function connectionExpiry(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): { expiresAt: string; expired: boolean } | null {
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return null;
  return { expiresAt, expired: now >= end };
}

export function isPlatformResource(kind: McpResourceKind | string): boolean {
  return kind === 'ADMIN';
}
