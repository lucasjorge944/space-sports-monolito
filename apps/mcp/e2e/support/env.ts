// Endereços do e2e local do MCP (docs/14-mcp.md, "Como testar"). Tudo vem de variável de ambiente,
// com padrões em portas altas e únicas para não brigar com o docker compose nem com outro worktree.
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const PORTS = {
  web: num('MCP_E2E_WEB_PORT', 43330), // só a origem confiável: não há web de verdade no e2e do MCP
  api: num('MCP_E2E_API_PORT', 43331),
  mcp: num('MCP_E2E_MCP_PORT', 43332),
  /** API e MCP extras dos casos de chave de emergência (MCP_ENABLED=false). */
  apiOff: num('MCP_E2E_API_OFF_PORT', 43333),
  mcpOff: num('MCP_E2E_MCP_OFF_PORT', 43334),
  /** API extra com o rate limit de auth ligado (registro dinâmico por IP). */
  apiRl: num('MCP_E2E_API_RL_PORT', 43335),
  /** API e MCP extras da chave `MCP_ADMIN_ENABLED` (fase 2): reiniciados em cada cenário. */
  apiAdmin: num('MCP_E2E_API_ADMIN_PORT', 43336),
  mcpAdmin: num('MCP_E2E_MCP_ADMIN_PORT', 43337),
};

export const DATABASE_URL =
  process.env.MCP_E2E_DATABASE_URL ??
  'postgres://space_sports:space_sports@localhost:55433/space_sports_e2e';
export const REDIS_URL = process.env.MCP_E2E_REDIS_URL ?? 'redis://localhost:56380';

export const WEB_ORIGIN = `http://localhost:${PORTS.web}`;
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const MCP_URL = `http://127.0.0.1:${PORTS.mcp}/mcp`;
/** Recurso do Super (fase 2): mesmo processo e host do MCP do jogador, outro caminho (docs/14-mcp.md 8.1). */
export const MCP_ADMIN_URL = `http://127.0.0.1:${PORTS.mcp}/admin/mcp`;
export const ISSUER = `${API_URL}/v1/auth`;
export const API_OFF_URL = `http://127.0.0.1:${PORTS.apiOff}`;
export const MCP_OFF_URL = `http://127.0.0.1:${PORTS.mcpOff}/mcp`;

export const CIMD_ORIGIN = 'https://cimd.e2e.test';
export const REDIRECT_URI = `${CIMD_ORIGIN}/callback`;

/** Senha dos usuários do seed de e2e (apps/api/test/e2e-seed/seed.ts). */
export const E2E_PASSWORD = 'senha-e2e-1234';
export const USERS = {
  /** Jogador com reservas no seed (inclusive uma passada). */
  a: 'jogador.e2e@exemplo.com',
  b: 'jogador2.e2e@exemplo.com',
  /** Aluno de turma da Arena E2E (aulas). */
  c: 'jogador3.e2e@exemplo.com',
  owner: 'dono.e2e@exemplo.com',
  superUser: 'super.e2e@exemplo.com',
  /** Conta antiga, sem telefone (decisão 66). */
  semFone: 'jogador.semfone.e2e@exemplo.com',
} as const;
