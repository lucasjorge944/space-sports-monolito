import { All, Controller, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { getRequest, setResponse } from 'better-call/node';
import type { Response as ExpressResponse, Request } from 'express';
import type { ErrorBody } from '../common/error-response.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Auth } from './auth.js';
import { AUTH } from './auth.tokens.js';
import { Public } from './decorators.js';

/**
 * Repassa /v1/auth/* ao Better Auth. As rotas estão no OpenAPI pela mescla de auth-openapi.ts,
 * não por este controller. O body já vem parseado pelo middleware JSON da API (o Better Auth
 * o reaproveita), então JSON malformado também responde INVALID_JSON.
 */
@ApiExcludeController()
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @All('{*path}')
  async handle(@Req() req: Request & { id?: unknown }, @Res() res: ExpressResponse): Promise<void> {
    // A origem vem da configuração, não do Host da requisição.
    const request = getRequest({ request: req, base: new URL(this.env.BETTER_AUTH_URL).origin });
    const response = await this.auth.handler(request);
    await setResponse(res, await toStandardError(response, req.id));
  }
}

/**
 * Converte o erro do Better Auth (`{ code?, message }`) para o formato padrão da API
 * (`{ error: { code, message }, requestId }`). Sucessos e redirects passam intactos.
 */
export async function toStandardError(res: Response, requestId: unknown): Promise<Response> {
  if (res.status < 400 || !res.headers.get('content-type')?.includes('application/json')) {
    return res;
  }
  const payload = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown; message?: unknown } | null;
  const body: ErrorBody = {
    error: {
      code:
        typeof payload?.code === 'string' && payload.code
          ? payload.code.toUpperCase()
          : (HttpStatus[res.status] ?? 'HTTP_ERROR'),
      message:
        typeof payload?.message === 'string' && payload.message ? payload.message : res.statusText,
    },
    requestId: typeof requestId === 'string' ? requestId : null,
  };
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: res.status, headers });
}
