import type {
  McpOAuthScope,
  McpResourceKind,
  PlatformRole,
  SpaceRole,
  SpaceStatus,
  UserStatus,
} from '@space-sports/shared';
import type { Request } from 'express';

/** Usuário autenticado, lido de `users` a cada requisição (papel e status sempre atuais). */
export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  avatarUrl: string | null;
  platformRole: PlatformRole;
  status: UserStatus;
}

/** Token OAuth do MCP validado (decisão 112): a requisição vem de um assistente conectado. */
export interface OAuthAccess {
  /** `client_id` do cliente OAuth (no CIMD, a URL do documento de metadados). */
  clientId: string;
  /** Recurso (audiência) do token: `USER` (jogador e gestão) ou `ADMIN` (Super), decisão 120. */
  resource: McpResourceKind;
  /** Escopos de permissão do token. */
  scopes: McpOAuthScope[];
  /** `jti` do token de acesso. */
  tokenId: string;
  expiresAt: Date;
}

export interface AuthContext {
  user: AuthUser;
  /** Sessão do app ou do web; nula com o token do MCP, que não vira sessão. */
  session: { id: string; expiresAt: Date } | null;
  /**
   * Presente só com o token do MCP (origem MCP): o acesso de jogador, a gestão em leitura (com
   * `manage:*`) ou o Super em leitura (recurso do Super), decisões 113 e 120.
   */
  oauth?: OAuthAccess;
}

/** Papéis ativos do usuário no espaço da rota e o status do espaço, resolvidos pelo SpaceRolesGuard. */
export interface SpaceAccess {
  spaceId: string;
  roles: SpaceRole[];
  /** Fora de ACTIVE (suspenso/encerrado), o painel é só leitura (RF-SUPER-03). */
  spaceStatus: SpaceStatus;
  /** Presente quando um Super acessa o painel em modo suporte (RF-SUPER-04). */
  support?: { sessionId: string };
}

export interface AuthenticatedRequest extends Request {
  /** Preenchido pelo AuthGuard global; `null` em rota pública sem sessão. */
  auth?: AuthContext | null;
  spaceAccess?: SpaceAccess;
}
