import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type SpaceRole, SUPPORT_SESSION_HEADER } from '@space-sports/shared';
import { z } from 'zod';
import {
  spaceForbidden,
  spaceReadOnly,
  supportSessionInvalid,
  unauthenticated,
} from '../auth.errors.js';
import { SPACE_ID_PARAM, SPACE_ROLES } from '../auth.metadata.js';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../auth-context.js';

const uuid = z.uuid();
/** Métodos que não alteram nada: liberados no espaço suspenso/encerrado. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * RN-AUTH-01/RN-AUTH-03: resolve (usuário, `:spaceId` da rota) → papéis ACTIVE em space_members e
 * exige um dos papéis do `@SpaceRoles`. O vínculo vale só para aquele espaço. O SUPER não tem
 * acesso automático: o acesso dele a um espaço é o modo suporte (RF-SUPER-04), com o header
 * `X-Support-Session` de uma sessão ativa daquele espaço; vale como Dono, só naquele espaço, e
 * cada requisição é auditada pelo SupportModeInterceptor.
 * Espaço fora de ACTIVE (suspenso/encerrado) fica só leitura (RF-SUPER-03): escrita → 403
 * SPACE_READ_ONLY.
 */
@Injectable()
export class SpaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<SpaceRole[] | undefined>(SPACE_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) throw new Error('SpaceRolesGuard sem papéis: use @SpaceRoles(...).');

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth) throw unauthenticated();
    const spaceId = req.params[SPACE_ID_PARAM];
    if (typeof spaceId !== 'string') {
      throw new Error(`SpaceRolesGuard: a rota precisa do parâmetro :${SPACE_ID_PARAM}.`);
    }
    // Id malformado não tem vínculo: mesma resposta de "sem permissão", sem erro do Postgres.
    if (!uuid.safeParse(spaceId).success) throw spaceForbidden();

    const support = await this.supportSessionOf(req, spaceId);
    const access = await this.authService.spaceAccess(req.auth.user.id, spaceId);
    if (!access) throw spaceForbidden();
    const roles: SpaceRole[] = support ? ['OWNER'] : access.roles;
    if (!roles.some((role) => required.includes(role))) throw spaceForbidden();
    if (access.status !== 'ACTIVE' && !READ_METHODS.has(req.method)) throw spaceReadOnly();
    req.spaceAccess = {
      spaceId,
      roles,
      spaceStatus: access.status,
      ...(support ? { support } : {}),
    };
    return true;
  }

  /** Modo suporte: valida o header `X-Support-Session`; sem header, não há modo suporte. */
  private async supportSessionOf(
    req: AuthenticatedRequest,
    spaceId: string,
  ): Promise<{ sessionId: string } | null> {
    const header = req.headers[SUPPORT_SESSION_HEADER];
    if (header === undefined) return null;
    const user = req.auth?.user;
    if (
      user?.platformRole !== 'SUPER' ||
      typeof header !== 'string' ||
      !uuid.safeParse(header).success ||
      !(await this.authService.isSupportSessionValid(header, user.id, spaceId))
    ) {
      throw supportSessionInvalid();
    }
    return { sessionId: header };
  }
}
