import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { All, Controller, Get, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { getRequest, setResponse } from 'better-call/node';
import type { Response as ExpressResponse, Request } from 'express';
import type { ErrorBody } from '../common/error-response.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { mcpDisabled } from './auth.errors.js';
import { AUTH_BASE_PATH, type Auth } from './auth.js';
import { AUTH } from './auth.tokens.js';
import { Public } from './decorators.js';
import {
  AUTH_SERVER_METADATA_AUTH_PATH,
  advertisedAuthServerMetadataResponse,
  isOAuthServerPath,
} from './oauth-server.js';

/**
 * Metadata do servidor de autorização (RFC 8414) na raiz, com o caminho do emissor inserido
 * (`/.well-known/oauth-authorization-server/v1/auth`): é onde os clientes MCP procuram primeiro.
 * Fica fora do prefixo /v1 (app.setup.ts).
 */
export const OAUTH_SERVER_METADATA_PATH = `.well-known/oauth-authorization-server${AUTH_BASE_PATH}`;

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
    const authPath = req.path.slice(`${AUTH_BASE_PATH}`.length) || '/';
    const oauthServer = isOAuthServerPath(authPath);
    // Chave de emergência do MCP (RN-MCP-04): o servidor de autorização sai do ar junto.
    if (oauthServer && !this.env.MCP_ENABLED) throw mcpDisabled();
    // A origem vem da configuração, não do Host da requisição.
    const request = getRequest({ request: req, base: new URL(this.env.BETTER_AUTH_URL).origin });
    let response = await this.auth.handler(request);
    // O mesmo metadata da raiz, sem o que a API desliga (BUG-MCP-1).
    if (authPath === AUTH_SERVER_METADATA_AUTH_PATH) {
      response = await advertisedAuthServerMetadataResponse(response, AUTH_BASE_PATH);
    }
    // As rotas OAuth respondem os erros no formato do RFC 6749 (`error`, `error_description`),
    // que os clientes MCP esperam; as demais, no formato padrão da API.
    await setResponse(res, oauthServer ? response : await toStandardError(response, req.id));
  }
}

/**
 * RFC 8414 na raiz (ver OAUTH_SERVER_METADATA_PATH). Sem os endpoints desligados nem os recursos
 * que a API não oferece (`advertisedAuthServerMetadata`).
 */
@ApiExcludeController()
@Public()
@Controller(OAUTH_SERVER_METADATA_PATH)
export class OAuthServerMetadataController {
  private readonly metadata: (request: globalThis.Request) => Promise<globalThis.Response>;

  constructor(
    @Inject(AUTH) auth: Auth,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.metadata = oauthProviderAuthServerMetadata(auth);
  }

  @Get()
  async get(@Req() req: Request, @Res() res: ExpressResponse): Promise<void> {
    if (!this.env.MCP_ENABLED) throw mcpDisabled();
    const request = getRequest({ request: req, base: new URL(this.env.BETTER_AUTH_URL).origin });
    await setResponse(
      res,
      await advertisedAuthServerMetadataResponse(await this.metadata(request), AUTH_BASE_PATH),
    );
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
