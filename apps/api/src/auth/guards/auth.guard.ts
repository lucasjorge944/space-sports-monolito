import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { IS_PUBLIC } from '../auth.metadata.js';
import { AuthService } from '../auth.service.js';
import type { AuthenticatedRequest } from '../auth-context.js';

/**
 * Guard global: toda rota exige sessão (cookie ou bearer), exceto as marcadas com `@Public()`.
 * Deixa o usuário em `req.auth` para os guards de papel (SuperGuard, SpaceRolesGuard).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    req.auth = await this.authService.requireSession(req, http.getResponse<Response>());
    return true;
  }
}
