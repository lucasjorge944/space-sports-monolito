import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  API_OFF_URL,
  API_URL,
  CIMD_ORIGIN,
  DATABASE_URL,
  ISSUER,
  MCP_ADMIN_URL,
  MCP_OFF_URL,
  MCP_URL,
  PORTS,
  REDIS_URL,
  WEB_ORIGIN,
} from './env.js';

/** Clientes que podem pedir o recurso do Super no e2e (o "Claude" do CIMD falso). */
export const ADMIN_ALLOWED_CLIENT_IDS = `${CIMD_ORIGIN}/claude.json`;

const root = resolve(import.meta.dirname, '../../../..');
export const SECRET = 'e2e-confirmation-secret-with-32-chars-min';

/** URL do recurso do Super de um recurso do jogador: mesmo host, caminho `/admin/mcp`. */
const adminResourceOf = (resource: string | undefined) =>
  resource ? resource.replace(/\/mcp$/, '/admin/mcp') : MCP_ADMIN_URL;

export interface Running {
  child: ChildProcess;
  logs: string[];
  stop(): Promise<void>;
}

async function waitFor(url: string, child: ChildProcess, logs: string[], timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Processo encerrou (${child.exitCode}) antes de subir:\n${logs.join('')}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout esperando ${url}:\n${logs.join('')}`);
}

function launch(cwd: string, args: string[], env: Record<string, string>): Running {
  const logs: string[] = [];
  const child = spawn('node', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));
  return {
    child,
    logs,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
      });
    },
  };
}

/** API de produção (dist) com o CIMD trocado (apps/api/test/mcp-e2e/start-api.mjs). */
export async function startApi(
  options: { port?: number; mcpResource?: string; env?: Record<string, string> } = {},
): Promise<Running> {
  const port = options.port ?? PORTS.api;
  const apiUrl = `http://127.0.0.1:${port}`;
  const running = launch(resolve(root, 'apps/api'), ['test/mcp-e2e/start-api.mjs'], {
    DATABASE_URL,
    REDIS_URL,
    NODE_ENV: 'development',
    PORT: String(port),
    JOBS_ENABLED: 'false',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
    BETTER_AUTH_URL: apiUrl,
    TRUSTED_ORIGINS: WEB_ORIGIN,
    WEB_URL: WEB_ORIGIN,
    MCP_ENABLED: 'true',
    MCP_RESOURCE_URL: options.mcpResource ?? MCP_URL,
    // Fase 2: o recurso do Super existe e só o cliente "claude.json" do e2e pode pedi-lo (decisão 123).
    MCP_ADMIN_RESOURCE_URL: adminResourceOf(options.mcpResource),
    MCP_ADMIN_ENABLED: 'true',
    MCP_ADMIN_ALLOWED_CLIENT_IDS: ADMIN_ALLOWED_CLIENT_IDS,
    MCP_RATE_LIMIT_ENABLED: 'true',
    MCP_DYNAMIC_CLIENT_REGISTRATION: 'true',
    PAYMENTS_PROVIDER: 'fake',
    LOG_LEVEL: 'warn',
    ...options.env,
  });
  await waitFor(`${apiUrl}/v1/health`, running.child, running.logs);
  return running;
}

/** apps/mcp de produção (dist). */
export async function startMcp(
  options: {
    port?: number;
    apiUrl?: string;
    issuer?: string;
    resource?: string;
    env?: Record<string, string>;
  } = {},
): Promise<Running> {
  const port = options.port ?? PORTS.mcp;
  const running = launch(resolve(root, 'apps/mcp'), ['dist/main.js'], {
    PORT: String(port),
    HOST: '127.0.0.1',
    API_URL: options.apiUrl ?? API_URL,
    WEB_URL: WEB_ORIGIN,
    MCP_ISSUER: options.issuer ?? ISSUER,
    MCP_RESOURCE_URL: options.resource ?? MCP_URL,
    // As duas superfícies no mesmo processo, como no staging (o caminho escolhe a superfície).
    MCP_SURFACES: 'user,admin',
    MCP_ADMIN_RESOURCE_URL: adminResourceOf(options.resource),
    MCP_CONFIRMATION_SECRET: SECRET,
    LOG_LEVEL: 'info',
    ...options.env,
  });
  await waitFor(`http://127.0.0.1:${port}/health`, running.child, running.logs);
  return running;
}

export { API_OFF_URL, MCP_OFF_URL };
