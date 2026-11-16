import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Client,
  type ElicitRequestFormParams,
  type ElicitResult,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { configureApiClient } from '@space-sports/api-client/dist/fetch.js';
import {
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_SCOPES,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from '@space-sports/shared';
import { type CryptoKey, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Config } from '../../src/config.js';
import { createApp, MAX_BODY_BYTES } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';

export { callTool } from './client.js';

import { FakeApi } from './fake-api.js';
import { ME, NOW } from './fixtures.js';

export const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-123';
const KID = 'chave-de-teste';

export interface TokenOptions {
  sub?: string;
  scopes?: readonly string[];
  clientId?: string | null;
  /** `aud`: uma URL ou uma lista (o token com mais de uma é recusado). */
  audience?: string | string[];
  issuer?: string;
  /** Segundos desde a época. */
  expiresAt?: number;
  key?: CryptoKey;
  /** Cabeçalho `typ` (padrão `at+jwt`, RFC 9068); `null` para omitir. */
  typ?: string | null;
}

export type Era = 'legacy' | 'modern';

export interface ConnectOptions {
  era?: Era;
  /** Declara elicitation e responde com o retorno desta função. */
  elicit?: (params: ElicitRequestFormParams) => ElicitResult;
  /** Altera o corpo JSON-RPC de cada POST antes de enviar (simula um cliente adulterado). */
  // biome-ignore lint/suspicious/noExplicitAny: corpo JSON-RPC livre nos testes.
  rewrite?: (body: any) => any;
  /** Rodadas de `input_required` que o cliente aceita antes de desistir. */
  maxRounds?: number;
  /** Endpoint MCP (padrão: o da superfície `user`). */
  url?: string;
}

/**
 * Sobe a API simulada (com o JWKS de teste) e o servidor MCP de verdade (HTTP, porta livre),
 * e entrega helpers para emitir tokens e conectar o cliente MCP do SDK.
 */
export async function startHarness(
  options: {
    enabled?: boolean;
    allowedOrigins?: string[];
    /** Superfícies no lugar da `user` padrão (teste da escolha por host). */
    surfaces?: Config['surfaces'];
    /**
     * Serve também a superfície `admin` (conector do Super) em `<origem>/admin/mcp`, no mesmo host
     * (a escolha é pelo caminho); `enabled: false` simula `MCP_ADMIN_ENABLED=false`.
     */
    admin?: { enabled?: boolean };
  } = {},
) {
  // Como o Better Auth da API (MCP.1): EdDSA/Ed25519.
  const ed25519 = { crv: 'Ed25519', extractable: true } as const;
  const signing = await generateKeyPair('EdDSA', ed25519);
  const attacker = await generateKeyPair('EdDSA', ed25519);
  const publicJwk = { ...(await exportJWK(signing.publicKey)), kid: KID, alg: 'EdDSA' };

  const api = new FakeApi({ keys: [publicJwk] });
  await api.start();
  configureApiClient({ baseUrl: api.url });

  const clock = { now: NOW };
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger('info', { write: (line: string) => logs.push(JSON.parse(line)) });

  let handle: ((req: never, res: never) => void) | undefined;
  const server: Server = createServer((req, res) => handle?.(req as never, res as never));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const mcpOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const resourceUrl = `${mcpOrigin}/mcp`;
  const adminResourceUrl = `${mcpOrigin}/admin/mcp`;
  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    enabled: options.enabled ?? true,
    apiUrl: api.url,
    webUrl: 'https://app.example.com',
    issuer: `${api.url}/api/auth`,
    surfaces: options.surfaces ?? [
      { name: 'user', resourceUrl, enabled: true },
      ...(options.admin
        ? [
            {
              name: 'admin' as const,
              resourceUrl: adminResourceUrl,
              enabled: options.admin.enabled ?? true,
            },
          ]
        : []),
    ],
    jwksUrl: `${api.url}/api/auth/jwks`,
    confirmationSecret: SECRET,
    allowedOrigins: options.allowedOrigins ?? ['app.example.com'],
    logLevel: 'info',
  };
  const app = createApp({ config, logger, now: () => clock.now });
  const node = toNodeHandler(app, { maxRequestBodySize: MAX_BODY_BYTES });
  handle = (req, res) => void node(req, res);

  const clients: Client[] = [];

  async function token(opts: TokenOptions = {}): Promise<string> {
    // Mesmo formato do token da API: `scope` com o `offline_access` que ela acrescenta, `azp` e
    // `client_id` iguais e `jti`.
    const scopes = opts.scopes ?? [...MCP_OAUTH_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE];
    const claims: Record<string, unknown> = {
      scope: scopes.join(' '),
      jti: randomBytes(16).toString('hex'),
    };
    if (opts.clientId !== null) {
      claims.azp = opts.clientId ?? 'cliente-claude';
      claims.client_id = claims.azp;
    }
    return new SignJWT(claims)
      .setProtectedHeader({
        alg: 'EdDSA',
        kid: KID,
        ...(opts.typ === null ? {} : { typ: opts.typ ?? 'at+jwt' }),
      })
      .setIssuer(opts.issuer ?? config.issuer)
      .setAudience(opts.audience ?? resourceUrl)
      .setSubject(opts.sub ?? ME)
      .setIssuedAt()
      .setExpirationTime(opts.expiresAt ?? Math.floor(Date.now() / 1000) + 15 * 60)
      .sign(opts.key ?? signing.privateKey);
  }

  async function connect(bearer: string, opts: ConnectOptions = {}): Promise<Client> {
    const client = new Client(
      { name: 'cliente-de-teste', version: '1.0.0' },
      {
        capabilities: opts.elicit ? { elicitation: { form: {} } } : {},
        ...(opts.era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
        ...(opts.maxRounds ? { inputRequired: { maxRounds: opts.maxRounds } } : {}),
      },
    );
    const elicit = opts.elicit;
    if (elicit) {
      client.setRequestHandler('elicitation/create', async (request) =>
        elicit(request.params as ElicitRequestFormParams),
      );
    }
    const rewrite = opts.rewrite;
    const transport = new StreamableHTTPClientTransport(new URL(opts.url ?? resourceUrl), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      ...(rewrite
        ? {
            fetch: (url: string | URL, init?: RequestInit) =>
              fetch(url, {
                ...init,
                ...(typeof init?.body === 'string'
                  ? { body: JSON.stringify(rewrite(JSON.parse(init.body))) }
                  : {}),
              }),
          }
        : {}),
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  /** Token do recurso do Super (`aud` = superfície `admin`, só `super:read` e `offline_access`). */
  function adminToken(opts: TokenOptions = {}): Promise<string> {
    return token({
      audience: adminResourceUrl,
      scopes: [...MCP_RESOURCE_SCOPES.ADMIN, OAUTH_OFFLINE_ACCESS_SCOPE],
      ...opts,
    });
  }

  /** POST cru em /mcp (para conferir status HTTP e cabeçalhos); `url` escolhe a superfície. */
  function post(
    body: unknown,
    bearer?: string,
    headers: Record<string, string> = {},
    url = resourceUrl,
  ) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  async function stop(): Promise<void> {
    await Promise.allSettled(clients.map((client) => client.close()));
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await api.stop();
  }

  return {
    api,
    app,
    config,
    /** URL do recurso da superfície `user` (= `aud` dos tokens e endpoint MCP). */
    resourceUrl,
    /** URL do recurso da superfície `admin` (servida só com a opção `admin`). */
    adminResourceUrl,
    adminToken,
    clock,
    logs,
    token,
    connect,
    post,
    stop,
    attackerKey: attacker.privateKey,
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** Uma chamada JSON-RPC de tool, para os testes HTTP crus. */
export function toolsCall(name: string, args: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}
