import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canInSpace } from '@space-sports/shared';
import { map, Observable } from 'rxjs';
import { audit } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/database.module.js';
import { oauthViewMismatch } from './auth.errors.js';
import { OAUTH_VIEW } from './auth.metadata.js';
import type { AuthenticatedRequest, OAuthAccess } from './auth-context.js';
import type { OAuthViewSpec } from './decorators.js';
import { oauthOriginContext } from './oauth-origin-context.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Visão da resposta para o token do MCP (decisão 122): a lista de campos permitidos da rota, com
 * valores só para quem tem `manage:finance:read` e papel que vê valores no espaço (decisão 53).
 */
export function oauthViewSchema(
  view: OAuthViewSpec,
  oauth: OAuthAccess,
  req: AuthenticatedRequest,
): OAuthViewSpec['base'] {
  const finance =
    view.finance &&
    oauth.scopes.includes('manage:finance:read') &&
    canInSpace(req.spaceAccess?.roles ?? [], 'payment.record');
  return finance && view.finance ? view.finance : view.base;
}

/**
 * Origem MCP (RN-MCP-03, RN-MCP-07; decisões 114 e 122):
 * - toda escrita feita com o token do MCP vai para `audit_logs` (`mcp.request`, com método e
 *   caminho) antes do handler, então a ação nunca acontece sem ficar anotada (as requisições com o
 *   token do Super são auditadas antes, no `OAuthAccessService`, inclusive as recusadas);
 * - nas rotas com `@OAuthView`, a resposta sai pela lista de campos permitidos da rota. Resposta
 *   que não bate com a visão nunca sai: 500, com o log da rota e dos campos (sem os valores).
 * O handler roda dentro do `oauthOriginContext`: as linhas de auditoria gravadas por ele saem com
 * `origin: 'MCP'` e o id do cliente no `diff`.
 */
@Injectable()
export class OAuthOriginInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OAuthOriginInterceptor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const oauth = req.auth?.oauth;
    if (!oauth || !req.auth) return next.handle();

    const store = { clientId: oauth.clientId };
    if (!READ_METHODS.has(req.method)) {
      await oauthOriginContext.run(store, () =>
        audit(this.db, {
          actorId: req.auth?.user.id ?? null,
          spaceId: null,
          action: 'mcp.request',
          entity: 'mcp_request',
          entityId: null,
          diff: { method: req.method, path: req.originalUrl.split('?')[0] },
        }),
      );
    }

    const view = this.reflector.get<OAuthViewSpec | undefined>(OAUTH_VIEW, context.getHandler());
    const schema = view ? oauthViewSchema(view, oauth, req) : undefined;
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const handled = schema
      ? next.handle().pipe(
          map((body: unknown) => {
            if (body === undefined) return body;
            const parsed = schema.safeParse(JSON.parse(JSON.stringify(body)));
            if (parsed.success) return parsed.data;
            // Só o caminho e o tipo de cada divergência: nada dos valores (dados pessoais).
            this.logger.error(
              {
                route,
                issues: parsed.error.issues.map((issue) => ({
                  path: issue.path.join('.'),
                  code: issue.code,
                })),
              },
              'Resposta fora da visão do MCP',
            );
            throw oauthViewMismatch();
          }),
        )
      : next.handle();
    return new Observable((subscriber) =>
      oauthOriginContext.run(store, () => handled.subscribe(subscriber)),
    );
  }
}
