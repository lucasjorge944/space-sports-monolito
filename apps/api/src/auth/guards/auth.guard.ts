import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { McpOAuthScope } from '@space-sports/shared';
import type { Response } from 'express';
import { IS_PUBLIC, OAUTH_SCOPES, OAUTH_VIEW } from '../auth.metadata.js';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../auth-context.js';
import { OAuthAccessService, oauthBearerOf } from '../oauth-access.service.js';

/**
 * Guard global: toda rota exige sessão (cookie ou bearer), exceto as marcadas com `@Public()`.
 * Deixa o usuário em `req.auth` para os guards de papel (SuperGuard, SpaceRolesGuard).
 *
 * Bearer no formato JWT é o token OAuth do MCP (decisão 112): validado em toda rota, inclusive as
 * públicas, e aceito só nas marcadas com `@OAuthScopes` (lista permitida do recurso do token,
 * decisão 120); nunca cai na sessão.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly oauth: OAuthAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();

    const oauthToken = oauthBearerOf(req);
    if (oauthToken) {
      // Só a marca do próprio handler vale: uma rota nova nunca herda a permissão da classe.
      const requiredScopes = this.reflector.get<McpOAuthScope[] | undefined>(
        OAUTH_SCOPES,
        context.getHandler(),
      );
      const hasView = this.reflector.get(OAUTH_VIEW, context.getHandler()) !== undefined;
      req.auth = await this.oauth.authenticate(oauthToken, {
        method: req.method,
        requiredScopes,
        hasView,
        request: { originalUrl: req.originalUrl, response: http.getResponse<Response>() },
      });
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    req.auth = await this.authService.requireSession(req, http.getResponse<Response>());
    return true;
  }
}
