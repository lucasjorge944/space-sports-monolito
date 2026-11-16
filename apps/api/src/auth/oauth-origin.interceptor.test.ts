import { type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { OAUTH_VIEW } from './auth.metadata.js';
import type { AuthenticatedRequest } from './auth-context.js';
import { OAuthOriginInterceptor } from './oauth-origin.interceptor.js';

// Decisão 122: a resposta ao token do MCP sai pela lista de campos permitidos; a que não bate com
// a visão nunca sai (500, com log sem os valores).

class Controller {
  handler() {}
}

function contextFor(req: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => Controller,
    getHandler: () => Controller.prototype.handler,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const view = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) });
Reflect.defineMetadata(OAUTH_VIEW, { base: view }, Controller.prototype.handler);

const oauthReq: Partial<AuthenticatedRequest> = {
  method: 'GET',
  originalUrl: '/v1/super/users',
  auth: {
    user: { id: 'u' } as never,
    session: null,
    oauth: {
      clientId: 'c',
      resource: 'ADMIN',
      scopes: ['super:read'],
      tokenId: 't',
      expiresAt: new Date(),
    },
  },
};

const interceptor = new OAuthOriginInterceptor({} as Database, new Reflector());

afterEach(() => vi.restoreAllMocks());

describe('OAuthOriginInterceptor: visão do MCP', () => {
  it('descarta o que não está na lista', async () => {
    const out = await interceptor.intercept(contextFor(oauthReq), {
      handle: () => of({ items: [{ id: '1', name: 'Ana', email: 'ana@exemplo.com' }], extra: 1 }),
    });
    expect(await lastValueFrom(out)).toEqual({ items: [{ id: '1', name: 'Ana' }] });
  });

  it('resposta fora da visão: 500, com log da rota e do caminho, sem os valores', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const out = await interceptor.intercept(contextFor(oauthReq), {
      handle: () => of({ items: [{ id: '1', name: 31988880000 }] }),
    });
    await expect(lastValueFrom(out)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });
    expect(error).toHaveBeenCalledWith(
      { route: 'Controller.handler', issues: [{ path: 'items.0.name', code: 'invalid_type' }] },
      'Resposta fora da visão do MCP',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('31988880000');
  });

  it('sessão do app e do web: a resposta passa inteira', async () => {
    const body = { items: [{ id: '1', name: 'Ana', email: 'ana@exemplo.com' }] };
    const out = await interceptor.intercept(contextFor({ method: 'GET', auth: null }), {
      handle: () => of(body),
    });
    expect(await lastValueFrom(out)).toBe(body);
  });
});
