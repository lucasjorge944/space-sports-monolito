import { z } from 'zod';

// Servidor MCP (docs/14-mcp.md; decisões 110 a 117 e 120 a 123; RF-MCP / RN-MCP).

/**
 * Escopos de jogador da fase 1 (decisão 111), na ordem em que o consentimento os mostra. Não mudam
 * na fase 2: os de gestão e do Super ficam em `MCP_MANAGE_SCOPES` e `MCP_SUPER_SCOPES`, e a lista
 * de cada recurso em `MCP_RESOURCE_SCOPES`.
 */
export const MCP_OAUTH_SCOPES = [
  'spaces:read',
  'bookings:read',
  'bookings:write',
  'classes:read',
  'classes:write',
] as const;
/** Alias legível dos escopos de jogador (os mesmos de `MCP_OAUTH_SCOPES`). */
export const MCP_PLAYER_SCOPES = MCP_OAUTH_SCOPES;

/**
 * Gestão em leitura (decisão 121), no recurso do jogador: `manage:read` para quem tem papel ativo
 * em algum espaço; `manage:finance:read` (valores) para quem é Dono ou Admin em algum espaço. O
 * papel em cada espaço continua valendo na API: o Professor nunca vê valores (decisão 53).
 */
export const MCP_MANAGE_SCOPES = ['manage:read', 'manage:finance:read'] as const;

/** Painel da plataforma em leitura (decisão 123), só no recurso do Super. */
export const MCP_SUPER_SCOPES = ['super:read'] as const;

/** Todos os escopos de permissão do MCP, na ordem canônica (a das telas). */
export const MCP_ALL_OAUTH_SCOPES = [
  ...MCP_OAUTH_SCOPES,
  ...MCP_MANAGE_SCOPES,
  ...MCP_SUPER_SCOPES,
] as const;
export const mcpOAuthScopeSchema = z.enum(MCP_ALL_OAUTH_SCOPES);
export type McpOAuthScope = z.infer<typeof mcpOAuthScopeSchema>;

/** Texto de cada escopo no consentimento (`/autorizar`) e em "Apps conectados". */
export const MCP_OAUTH_SCOPE_LABELS: Record<McpOAuthScope, string> = {
  'spaces:read': 'Ver espaços, quadras, horários e aulas',
  'bookings:read': 'Ver suas reservas',
  'bookings:write': 'Reservar e cancelar quadras em seu nome',
  'classes:read': 'Ver suas aulas',
  'classes:write': 'Confirmar e desmarcar presença em aulas',
  'manage:read':
    'Ver a agenda, as reservas, as quadras, as aulas, a presença, as avaliações e a equipe dos espaços em que você trabalha',
  'manage:finance:read':
    'Ver recebimentos, extrato, mensalidades, inadimplência e pagamentos online dos espaços em que você é Dono ou Admin',
  'super:read': 'Ler os dados de todos os espaços, usuários e pagamentos da plataforma',
};

/**
 * Recursos OAuth (decisão 120): `USER` é o conector "Space Sports" (`MCP_RESOURCE_URL`: jogador e
 * gestão); `ADMIN` é o conector "Space Sports · Plataforma" (`MCP_ADMIN_RESOURCE_URL`: só Super).
 * Cada token vale para um recurso só.
 */
export const MCP_RESOURCE_KINDS = ['USER', 'ADMIN'] as const;
export const mcpResourceKindSchema = z.enum(MCP_RESOURCE_KINDS);
export type McpResourceKind = z.infer<typeof mcpResourceKindSchema>;

/** Nome do conector de cada recurso (consentimento e "Apps conectados"). */
export const MCP_RESOURCE_NAMES: Record<McpResourceKind, string> = {
  USER: 'Space Sports',
  ADMIN: 'Space Sports · Plataforma',
};

/** Escopos de permissão que cada recurso aceita, na ordem canônica. */
export const MCP_RESOURCE_SCOPES: Record<McpResourceKind, readonly McpOAuthScope[]> = {
  USER: [...MCP_OAUTH_SCOPES, ...MCP_MANAGE_SCOPES],
  ADMIN: [...MCP_SUPER_SCOPES],
};

/**
 * Decisão 123: a conexão com o recurso do Super vale no máximo 24 horas desde o consentimento
 * (nem o token nem a renovação passam disso); depois, é preciso entrar e autorizar de novo.
 */
export const MCP_ADMIN_CONNECTION_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Grupos de escopos nas telas: "Como jogador", "Gestão dos seus espaços", "Painel da plataforma". */
export const MCP_SCOPE_GROUPS = ['PLAYER', 'MANAGE', 'SUPER'] as const;
export type McpScopeGroup = (typeof MCP_SCOPE_GROUPS)[number];
export const MCP_SCOPE_GROUP_LABELS: Record<McpScopeGroup, string> = {
  PLAYER: 'Como jogador',
  MANAGE: 'Gestão dos seus espaços',
  SUPER: 'Painel da plataforma',
};

/** Grupo de um escopo (para agrupar no consentimento e em "Apps conectados"). */
export function mcpScopeGroupOf(scope: McpOAuthScope): McpScopeGroup {
  if ((MCP_MANAGE_SCOPES as readonly string[]).includes(scope)) return 'MANAGE';
  if ((MCP_SUPER_SCOPES as readonly string[]).includes(scope)) return 'SUPER';
  return 'PLAYER';
}

/**
 * Escopo de protocolo (não é permissão): pede o token de atualização (30 dias, com rotação; 24 h no
 * recurso do Super). O servidor de autorização o acrescenta a todo pedido do MCP; as telas não o
 * mostram como permissão.
 */
export const OAUTH_OFFLINE_ACCESS_SCOPE = 'offline_access';

/** `true` para os escopos de permissão do MCP (descarta `offline_access` e desconhecidos). */
export function isMcpOAuthScope(scope: string): scope is McpOAuthScope {
  return (MCP_ALL_OAUTH_SCOPES as readonly string[]).includes(scope);
}

/**
 * Escopos de permissão de uma lista (ou do `scope` separado por espaços), na ordem canônica. Com
 * `resource`, só os que esse recurso aceita.
 */
export function mcpScopesOf(
  scopes: string | readonly string[] | null | undefined,
  resource?: McpResourceKind,
): McpOAuthScope[] {
  const list = typeof scopes === 'string' ? scopes.split(' ') : (scopes ?? []);
  const granted = new Set(list);
  const universe = resource ? MCP_RESOURCE_SCOPES[resource] : MCP_ALL_OAUTH_SCOPES;
  return universe.filter((scope) => granted.has(scope));
}

/** Cliente OAuth como o consentimento e "Apps conectados" mostram. */
const oauthClientInfo = {
  /** `client_id` OAuth (no CIMD, a URL do documento de metadados do cliente). */
  clientId: z.string(),
  /** Nome declarado pelo cliente; sem nome, o domínio do `client_id` ou "Aplicativo sem nome". */
  name: z.string(),
  /**
   * Domínio do `client_id` quando ele é uma URL (CIMD): o documento foi buscado nele, então o
   * domínio é verificado. Nulo para clientes de registro dinâmico.
   */
  host: z.string().nullable(),
  /** Página do cliente (`client_uri`), quando informada. */
  uri: z.string().nullable(),
  /** Logo do cliente (`logo_uri`), quando informada. A API não busca nem valida a imagem. */
  logoUrl: z.string().nullable(),
};

/** Recurso (conector) de um pedido de consentimento ou de uma conexão. */
export const mcpResourceInfoSchema = z.object({
  kind: mcpResourceKindSchema,
  /** `MCP_RESOURCE_NAMES[kind]`. */
  name: z.string(),
});
export type McpResourceInfo = z.infer<typeof mcpResourceInfoSchema>;

/**
 * GET /v1/oauth/consent-request: o web manda a query inteira de `/autorizar` (sem o `?`), como o
 * Better Auth a assinou.
 */
export const oauthConsentRequestQuerySchema = z.object({
  oauthQuery: z.string().min(1).max(8192),
});
export type OAuthConsentRequestQuery = z.infer<typeof oauthConsentRequestQuerySchema>;

/** Pedido de consentimento validado (assinatura e validade da query conferidas pela API). */
export const oauthConsentRequestSchema = z.object({
  client: z.object(oauthClientInfo),
  /** Conector pedido (`resource` do authorize). */
  resource: mcpResourceInfoSchema.extend({
    /** Duração máxima da conexão em horas (24 no recurso do Super, decisão 123); nula = sem limite. */
    maxConnectionHours: z.number().int().positive().nullable(),
  }),
  /**
   * Escopos que o servidor vai conceder se a pessoa clicar "Permitir": os pedidos ∩ os que a conta
   * pode usar agora (RN-MCP-06), na ordem canônica (textos em `MCP_OAUTH_SCOPE_LABELS`, grupos em
   * `mcpScopeGroupOf`).
   */
  scopes: z.array(mcpOAuthScopeSchema),
  /**
   * Escopos do conector que esta conta não pode usar (ex.: `manage:*` para quem não é da equipe de
   * nenhum espaço, `super:read` para quem não é Super), para a tela explicar. Nunca são concedidos.
   */
  deniedScopes: z.array(mcpOAuthScopeSchema),
  /**
   * `false` quando nenhum escopo pode ser concedido (ex.: quem não é Super no recurso do Super):
   * a tela mostra "sua conta não tem acesso", sem "Permitir" (só voltar ao assistente, que recebe
   * `access_denied`).
   */
  canAuthorize: z.boolean(),
  /** Fim da validade do pedido: depois disso, o "Permitir" falha e o assistente precisa recomeçar. */
  expiresAt: z.iso.datetime(),
});
export type OAuthConsentRequest = z.infer<typeof oauthConsentRequestSchema>;

/** App conectado (decisão 116, RF-MCP-05): um cliente que o usuário autorizou em um conector. */
export const connectedAppSchema = z.object({
  /** Id da conexão (use em `DELETE /v1/me/connected-apps/{id}`). */
  id: z.uuid(),
  ...oauthClientInfo,
  /** Conector da conexão: o mesmo cliente pode estar conectado aos dois. */
  resource: mcpResourceInfoSchema,
  scopes: z.array(mcpOAuthScopeSchema),
  /** Quando o usuário autorizou (a última vez que clicou "Permitir"). */
  authorizedAt: z.iso.datetime(),
  /** Último uso do token pelo assistente (precisão de até 1 hora); nulo se ainda não usou. */
  lastUsedAt: z.iso.datetime().nullable(),
  /**
   * Fim da conexão (recurso do Super: 24 h depois da autorização, decisão 123); nulo = vale até
   * desconectar.
   */
  expiresAt: z.iso.datetime().nullable(),
});
export type ConnectedApp = z.infer<typeof connectedAppSchema>;

export const connectedAppListSchema = z.object({ items: z.array(connectedAppSchema) });
export type ConnectedAppList = z.infer<typeof connectedAppListSchema>;
