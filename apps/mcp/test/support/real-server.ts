import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Client } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { configureApiClient } from '@space-sports/api-client/dist/fetch.js';
import type { Config, SurfaceName } from '../../src/config.js';
import { createApp, MAX_BODY_BYTES } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { callTool, connectClient } from './client.js';

export interface RealServerOptions {
  /** Origem da API real (sem `/v1`). */
  apiUrl: string;
  issuer: string;
  jwksUrl: string;
  /**
   * Igual ao `MCP_RESOURCE_URL` da API (o `aud` dos tokens) ou, com `surface: 'admin'`, ao
   * `MCP_ADMIN_RESOURCE_URL`.
   */
  resourceUrl: string;
  /** Superfície servida (padrão `user`; `admin` = conector do Super, MCP2.4). */
  surface?: SurfaceName;
}

/**
 * Sobe o apps/mcp de verdade (HTTP, porta livre) apontando para uma API real. Usado pelo teste de
 * integração da API (`apps/api/test/mcp/mcp-server.int.test.ts`), com o token emitido pelo plugin
 * OAuth e o JWKS de verdade. O servidor escuta numa porta qualquer; o `resourceUrl` é só a
 * audiência esperada.
 */
export async function startMcpServer(options: RealServerOptions) {
  configureApiClient({ baseUrl: options.apiUrl });
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger('info', { write: (line: string) => logs.push(JSON.parse(line)) });
  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    enabled: true,
    apiUrl: options.apiUrl,
    webUrl: 'http://localhost:3000',
    issuer: options.issuer,
    surfaces: [
      { name: options.surface ?? 'user', resourceUrl: options.resourceUrl, enabled: true },
    ],
    jwksUrl: options.jwksUrl,
    confirmationSecret: 'segredo-do-teste-de-integracao-com-32-caracteres',
    allowedOrigins: [],
    logLevel: 'info',
  };
  const app = createApp({ config, logger });
  const handler = toNodeHandler(app, { maxRequestBodySize: MAX_BODY_BYTES });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const clients: Client[] = [];

  return {
    url,
    logs,
    async connect(bearer: string) {
      const client = await connectClient(url, bearer);
      clients.push(client);
      return client;
    },
    call: callTool,
    async stop() {
      await Promise.allSettled(clients.map((client) => client.close()));
      await app.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
