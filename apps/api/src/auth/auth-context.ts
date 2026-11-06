import type { PlatformRole, SpaceRole, SpaceStatus, UserStatus } from '@space-sports/shared';
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

export interface AuthContext {
  user: AuthUser;
  session: { id: string; expiresAt: Date };
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
