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
  ApiExtension,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type McpOAuthScope,
  type SpacePermission as Permission,
  SPACE_PERMISSIONS,
  type SpaceRole,
} from '@space-sports/shared';
import type { ZodType } from 'zod';
import { ErrorResponseDto } from '../common/error-response.js';
import { IS_PUBLIC, OAUTH_SCOPES, OAUTH_VIEW, SPACE_ROLES } from './auth.metadata.js';
import type { AuthenticatedRequest, AuthUser, OAuthAccess, SpaceAccess } from './auth-context.js';
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

/**
 * Lista permitida do token OAuth do MCP (decisões 112 e 120, docs/14-mcp.md 3.3 e 8.2): só as rotas
 * com este decorador aceitam o token, e com todos os escopos listados (sem escopos: qualquer escopo
 * do recurso do jogador). A lista depende da audiência: o token do recurso do jogador vale nas
 * rotas de jogador e de gestão (`manage:*`); o do Super, só nas de `super:read`. Nas demais, 403
 * `OAUTH_ROUTE_NOT_ALLOWED`. Rotas de gestão e do Super: só `GET`, sempre com `@OAuthView` (lista de
 * campos permitidos, decisão 122). Nunca em rota de conta (e-mail, senha, exclusão), CSV, escrita ou
 * pagamento com cartão. Vai para o OpenAPI como `x-oauth-scopes`.
 */
export const OAuthScopes = (...scopes: McpOAuthScope[]) =>
  applyDecorators(SetMetadata(OAUTH_SCOPES, scopes), ApiExtension('x-oauth-scopes', scopes));

/** Lista de campos permitidos da resposta para o token do MCP (decisão 122). */
export type OAuthViewSpec = {
  /** Sem valores (ou a única visão, quando a rota é só de `manage:finance:read` ou do Super). */
  base: ZodType;
  /**
   * Com valores: só com `manage:finance:read` no token e papel que vê valores no espaço (Dono ou
   * Admin; o Professor nunca, decisão 53).
   */
  finance?: ZodType;
};

/**
 * Visão do MCP (decisão 122): com o token do MCP, a resposta passa pelo schema Zod da visão (os
 * objetos do Zod descartam o que não está listado), depois de serializada em JSON. Nome sim;
 * telefone, e-mail, documento, endereço, nascimento, tokens, convites e dados bancários nunca. A
 * sessão do app e do web não passa por aqui.
 */
export const OAuthView = (base: ZodType, finance?: ZodType) =>
  SetMetadata(OAUTH_VIEW, { base, ...(finance ? { finance } : {}) } satisfies OAuthViewSpec);

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

/** Token OAuth do MCP da requisição (`undefined` na sessão do app e do web). */
export const CurrentOAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OAuthAccess | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.oauth,
);
