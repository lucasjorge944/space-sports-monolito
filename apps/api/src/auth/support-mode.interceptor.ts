import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { SUPPORT_MODE_HEADER, SUPPORT_SESSION_HEADER } from '@space-sports/shared';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { audit } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/database.module.js';
import type { AuthenticatedRequest } from './auth-context.js';
import { supportContext } from './support-context.js';

/**
 * Modo suporte do Super (RF-SUPER-04, RN-SUPER-01): sinaliza nas respostas (`X-Support-Mode`,
 * `X-Support-Session`) e registra em `audit_logs` toda requisição feita nele, com o Super
 * responsável. O registro é gravado antes do handler: a ação nunca acontece sem ficar anotada.
 * As linhas de auditoria de domínio gravadas pelo handler herdam a marca via `supportContext`.
 */
@Injectable()
export class SupportModeInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Database) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const support = req.spaceAccess?.support;
    if (!support || !req.auth) return next.handle();

    const res = http.getResponse<Response>();
    res.setHeader(SUPPORT_MODE_HEADER, 'true');
    res.setHeader(SUPPORT_SESSION_HEADER, support.sessionId);
    await audit(this.db, {
      actorId: req.auth.user.id,
      actingAsSuper: true,
      spaceId: req.spaceAccess?.spaceId ?? null,
      action: 'support.request',
      entity: 'support_session',
      entityId: support.sessionId,
      diff: { method: req.method, path: req.originalUrl.split('?')[0] },
    });
    // O handler roda dentro do contexto, para `audit()` marcar as linhas de domínio.
    return new Observable((subscriber) =>
      supportContext.run({ sessionId: support.sessionId }, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
