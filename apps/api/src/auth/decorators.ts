import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type SpacePermission as Permission,
  SPACE_PERMISSIONS,
  type SpaceRole,
} from '@space-sports/shared';
import { ErrorResponseDto } from '../common/error-response.js';
import { IS_PUBLIC, SPACE_ROLES } from './auth.metadata.js';
import type { AuthenticatedRequest, AuthUser, SpaceAccess } from './auth-context.js';
import { SpaceRolesGuard } from './guards/space-roles.guard.js';
import { SuperGuard } from './guards/super.guard.js';

/**
 * Rota sem login. Toda rota exige sessão por padrão (AuthGuard global); a pública não lê a
 * sessão (`@CurrentUser()` vem vazio).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Documenta no OpenAPI que a rota exige sessão (cookie ou bearer) e pode responder 401. */
export const ApiAuth = () =>
  applyDecorators(
    ApiBearerAuth('bearerAuth'),
    ApiCookieAuth('sessionCookie'),
    ApiUnauthorizedResponse({
      description: '`UNAUTHENTICATED`: sem sessão válida.',
      type: ErrorResponseDto,
    }),
    ApiForbiddenResponse({
      description:
        '`USER_BLOCKED`: conta bloqueada pelo Super. `ACCOUNT_INACTIVE`: conta inativada pelo titular (RF-AUTH-03).',
      type: ErrorResponseDto,
    }),
  );

/** Só usuários com platform_role SUPER (RN-AUTH-02). */
export const SuperOnly = () =>
  applyDecorators(
    UseGuards(SuperGuard),
    ApiForbiddenResponse({
      description: '`SUPER_REQUIRED`: rota exclusiva do papel SUPER.',
      type: ErrorResponseDto,
    }),
  );

/**
 * Só quem tem um dos papéis, com vínculo ACTIVE, no espaço do parâmetro `:spaceId` da rota
 * (RN-AUTH-01, RN-AUTH-03). Papel em outro espaço não vale. Prefira `@SpacePermission(...)`, que
 * lê os papéis da matriz de permissões.
 */
export const SpaceRoles = (...roles: [SpaceRole, ...SpaceRole[]]) =>
  applyDecorators(
    SetMetadata(SPACE_ROLES, roles),
    UseGuards(SpaceRolesGuard),
    ApiForbiddenResponse({
      description:
        '`SPACE_FORBIDDEN`: sem papel no espaço que permita a ação. `SPACE_READ_ONLY`: espaço suspenso ou encerrado (só leitura).',
      type: ErrorResponseDto,
    }),
  );

/** `@SpaceRoles` com os papéis da ação na matriz de permissões (docs/02). */
export const SpacePermission = (permission: Permission) => {
  const [first, ...rest] = SPACE_PERMISSIONS[permission];
  return SpaceRoles(first, ...rest);
};

/** Usuário da sessão (rotas não públicas). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user,
);

/** Espaço da rota e papéis do usuário nele (rotas com `@SpaceRoles`/`@SpacePermission`). */
export const CurrentSpaceAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SpaceAccess | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().spaceAccess,
);
