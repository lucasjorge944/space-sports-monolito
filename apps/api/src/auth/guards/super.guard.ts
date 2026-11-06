import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { superRequired, unauthenticated } from '../auth.errors.js';
import type { AuthenticatedRequest } from '../auth-context.js';

/** RN-AUTH-02: só platform_role SUPER. Use com `@SuperOnly()`. */
@Injectable()
export class SuperGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!auth) throw unauthenticated();
    if (auth.user.platformRole !== 'SUPER') throw superRequired();
    return true;
  }
}
