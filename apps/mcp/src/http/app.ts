import { createHmac } from 'node:crypto';
import { createMcpProtectedRequestHandler } from '@better-auth/mcp';
import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import { toAuthInfo } from '../auth/user.js';
import { type Config, resourcePathOf, type SurfaceConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { ConfirmationCodes } from '../mcp/confirmation.js';
import { StaffSpacesCache } from '../mcp/manage/staff-cache.js';
import { createServerFactory, type ServerDeps } from '../mcp/server.js';
import { SURFACES, type SurfaceDefinition } from '../surfaces/index.js';

/** Corpo máximo de uma requisição MCP (as entradas das tools são pequenas). */
export const MAX_BODY_BYTES = 256 * 1024;

const PRM_PATH = '/.well-known/oauth-protected-resource';

export interface AppDeps {
  config: Config;
  logger: Logger;
  now?: () => Date;
}

export interface App {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/** Uma superfície pronta para atender: endpoint, metadata e o handler protegido pelo token. */
interface Surface {
  definition: SurfaceDefinition;
  config: SurfaceConfig;
  /** Hostname do recurso (minúsculo): escolhe a superfície quando o processo serve mais de uma. */
  hostname: string;
  /** Caminho do endpoint MCP (o da URL do recurso, ex.: `/mcp`). */
  path: string;
  metadata: Record<string, unknown>;
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/**
 * App HTTP (Web standard): `/health`, e para cada superfície (decisão 120) a Protected Resource
 * Metadata (RFC 9728) e `POST <caminho do recurso>` (Streamable HTTP sem estado). Com mais de uma
 * superfície, a escolha é pelo host (e caminho) da requisição. O token é validado pelo
 * `@better-auth/mcp` com a audiência da superfície (assinatura pelo JWKS, `iss`, `aud`, `exp`); sem
 * token ou inválido, 401 com `WWW-Authenticate`; tool sem o escopo, 403 `insufficient_scope` antes
 * de despachar a chamada.
 */
export function createApp({ config, logger, now = () => new Date() }: AppDeps): App {
  const codes = new ConfirmationCodes(config.confirmationSecret, now);
  // Chave própria para o `requestState` da elicitation (separada da dos códigos).
  const requestStateKey = createHmac('sha256', config.confirmationSecret)
    .update('space-sports-mcp/request-state')
    .digest();
  const deps: ServerDeps = {
    codes,
    requestStateKey,
    logger,
    webUrl: config.webUrl,
    now,
    staffSpaces: new StaffSpacesCache(now),
  };
  const surfaces = config.surfaces.map((surface) =>
    createSurface(SURFACES[surface.name], surface, config, deps, logger),
  );
  const single = surfaces.length === 1;

  /** Superfícies que atendem este host (todas, quando o processo serve uma só). */
  const forHost = (url: URL) =>
    single
      ? surfaces
      : surfaces.filter((surface) => surface.hostname === url.hostname.toLowerCase());

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const { pathname } = url;
      if (pathname === '/health') {
        return request.method === 'GET' || request.method === 'HEAD'
          ? Response.json({ status: 'ok' })
          : methodNotAllowed('GET, HEAD');
      }
      const candidates = forHost(url);
      const metadataOf =
        pathname === PRM_PATH
          ? candidates.length === 1
            ? candidates[0]
            : undefined
          : candidates.find((surface) => pathname === `${PRM_PATH}${surface.path}`);
      if (metadataOf) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        // Superfície desligada pela chave dela (`MCP_ADMIN_ENABLED=false`): o metadata também sai
        // do ar, para o cliente não começar uma autorização que a API recusaria (503). A chave
        // global (`MCP_ENABLED`) derruba só o endpoint MCP, como na fase 1.
        if (!metadataOf.config.enabled) {
          return jsonRpcError(503, metadataOf.definition.disabledMessage, CORS);
        }
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return methodNotAllowed('GET, HEAD');
        return Response.json(metadataOf.metadata, {
          headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
        });
      }
      const surface = candidates.find((candidate) => pathname === candidate.path);
      if (surface) {
        if (!config.enabled || !surface.config.enabled) {
          return jsonRpcError(503, surface.definition.disabledMessage);
        }
        // Proteção contra DNS rebinding e chamadas de páginas web: `Origin` presente só da lista.
        // Clientes MCP fora do navegador não mandam `Origin` e passam.
        const rejected = originValidationResponse(request, config.allowedOrigins);
        if (rejected) {
          logger.info({
            event: 'origin_rejected',
            surface: surface.config.name,
            status: rejected.status,
          });
          return rejected;
        }
        try {
          const response = await surface.handle(request);
          if (response.status === 401) {
            logger.info({ event: 'auth_rejected', surface: surface.config.name, status: 401 });
          }
          return response;
        } catch (error) {
          // JWKS fora do ar ou erro inesperado: nada de detalhes na resposta.
          logger.warn({
            event: 'mcp_request_failed',
            surface: surface.config.name,
            name: (error as Error)?.name,
          });
          return jsonRpcError(503, 'Não foi possível validar o acesso agora. Tente de novo.');
        }
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
    close: async () => {
      await Promise.all(surfaces.map((surface) => surface.close()));
    },
  };
}

/** Monta a superfície: servidor MCP, metadata e validação do token com a audiência dela. */
function createSurface(
  definition: SurfaceDefinition,
  surfaceConfig: SurfaceConfig,
  config: Config,
  deps: ServerDeps,
  logger: Logger,
): Surface {
  const { resourceUrl } = surfaceConfig;
  const surfaceName = surfaceConfig.name;
  const path = resourcePathOf(resourceUrl);
  const mcp = createMcpHandler(createServerFactory(deps, definition), {
    legacy: 'stateless',
    maxRequestBodySize: MAX_BODY_BYTES,
    onerror: (error) => logger.warn({ event: 'mcp_error', surface: surfaceName, name: error.name }),
  });
  const toolScopes = new Map(definition.tools.map((tool) => [tool.name, tool.scopes]));
  const metadata = {
    resource: resourceUrl,
    authorization_servers: [config.issuer],
    scopes_supported: [...definition.scopes],
    bearer_methods_supported: ['header'],
    resource_name: definition.title,
  };

  const handle = createMcpProtectedRequestHandler(
    {
      issuer: config.issuer,
      audience: resourceUrl,
      jwksUrl: config.jwksUrl,
      // RFC 9068: só token de acesso (`typ` at+jwt), nunca id_token nem outro JWT do mesmo emissor.
      jwtVerifyOptions: { typ: 'at+jwt', requiredClaims: ['sub', 'azp', 'exp'] },
      challengeScopes: [...definition.scopes],
    },
    async (request, claims) => {
      const token = bearerToken(request);
      const authInfo = token ? toAuthInfo(claims, token, resourceUrl, definition.resource) : null;
      if (!authInfo) return unauthorized(resourceUrl, path);
      const sub = authInfo.extra?.sub;
      if (authInfo.scopes.length === 0) {
        logger.info({
          event: 'scope_denied',
          surface: surfaceName,
          sub,
          clientId: authInfo.clientId,
          missing: 'any',
        });
        throw createInsufficientScopeError([...definition.scopes]);
      }
      if (request.method !== 'POST') return mcp.fetch(request, { authInfo });

      const body = await readJson(request);
      if (body instanceof Response) return body;
      // Escopo transitivo: a tool precisa de TODOS os escopos das rotas que chama. O desafio lista
      // o conjunto completo exigido (das tools recusadas), para o cliente pedir de uma vez.
      const required = new Set<string>();
      for (const tool of calledTools(body)) {
        const scopes = toolScopes.get(tool) ?? [];
        const missing = scopes.filter((scope) => !authInfo.scopes.includes(scope));
        if (missing.length === 0) continue;
        logger.info({
          event: 'scope_denied',
          surface: surfaceName,
          sub,
          clientId: authInfo.clientId,
          tool,
          missing,
        });
        for (const scope of scopes) required.add(scope);
      }
      if (required.size > 0) {
        const scopes = [...required];
        throw createInsufficientScopeError(
          scopes,
          `missing scope for this tool: ${scopes.join(' ')}`,
        );
      }
      return mcp.fetch(request, { authInfo, parsedBody: body });
    },
  );

  return {
    definition,
    config: surfaceConfig,
    hostname: new URL(resourceUrl).hostname.toLowerCase(),
    path,
    metadata,
    handle,
    close: () => mcp.close(),
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

function unauthorized(resourceUrl: string, resourcePath: string): Response {
  const metadataUrl = `${new URL(resourceUrl).origin}${PRM_PATH}${resourcePath}`;
  return jsonRpcError(401, 'Token inválido.', {
    'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
  });
}

function methodNotAllowed(allow: string): Response {
  return new Response(null, { status: 405, headers: { Allow: allow } });
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers },
  );
}

/** Corpo JSON da requisição MCP, ou a resposta de erro (415, 413, 400). */
async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    return jsonRpcError(415, 'Content-Type deve ser application/json.');
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return jsonRpcError(413, 'Requisição grande demais.');
  }
  try {
    return JSON.parse(text);
  } catch {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      { status: 400 },
    );
  }
}

/** Nomes das tools chamadas (`tools/call`), inclusive num lote JSON-RPC. */
function calledTools(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    return method === 'tools/call' && typeof params?.name === 'string' ? [params.name] : [];
  });
}
