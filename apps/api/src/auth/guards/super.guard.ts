import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { McpOAuthScope } from '@space-sports/shared';
import { oauthRouteNotAllowed, superRequired, unauthenticated } from '../auth.errors.js';
import { OAUTH_SCOPES } from '../auth.metadata.js';
import type { AuthenticatedRequest } from '../auth-context.js';

/**
 * RN-AUTH-02: só platform_role SUPER. Use com `@SuperOnly()`. Token do MCP (decisões 120 e 123):
 * só o do recurso do Super, só em `GET` com `@OAuthScopes('super:read')` no próprio handler; o
 * papel SUPER vale do mesmo jeito.
 */
@Injectable()
export class SuperGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { auth } = req;
    if (!auth) throw unauthenticated();
    if (auth.oauth) {
      const scopes = this.reflector.get<McpOAuthScope[] | undefined>(
        OAUTH_SCOPES,
        context.getHandler(),
      );
      if (
        auth.oauth.resource !== 'ADMIN' ||
        !scopes?.includes('super:read') ||
        req.method !== 'GET'
      ) {
        throw oauthRouteNotAllowed();
      }
    }
    if (auth.user.platformRole !== 'SUPER') throw superRequired();
    return true;
  }
}
