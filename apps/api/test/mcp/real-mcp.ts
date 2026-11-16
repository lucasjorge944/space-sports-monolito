import { fileURLToPath } from 'node:url';

/** O que os testes usam do helper `apps/mcp/test/support/real-server.ts` (tipado lá). */
// biome-ignore lint/suspicious/noExplicitAny: dados estruturados livres das tools nos testes.
export type ToolCall = { isError: boolean; text: string; data: any };

export type McpClient = {
  listTools(): Promise<{ tools: { name: string }[] }>;
  listPrompts(): Promise<{ prompts: { name: string }[] }>;
};

export type McpServerHandle = {
  url: string;
  logs: Record<string, unknown>[];
  connect(bearer: string): Promise<McpClient>;
  call(client: McpClient, name: string, args?: Record<string, unknown>): Promise<ToolCall>;
  stop(): Promise<void>;
};

/**
 * O apps/mcp de verdade, importado em tempo de execução: as dependências dele (SDK do MCP,
 * api-client) resolvem a partir de apps/mcp, e o typecheck de cada app fica com os próprios
 * arquivos. O turbo builda o api-client antes do `test:integration` da API (turbo.json).
 */
export async function startMcpServer(options: {
  apiUrl: string;
  issuer: string;
  jwksUrl: string;
  resourceUrl: string;
  /** Superfície (padrão `user`; `admin` = conector do Super com `MCP_ADMIN_RESOURCE_URL`). */
  surface?: 'user' | 'admin';
}): Promise<McpServerHandle> {
  const helper = fileURLToPath(
    new URL('../../../mcp/test/support/real-server.ts', import.meta.url),
  );
  const module = (await import(helper)) as {
    startMcpServer(opts: typeof options): Promise<McpServerHandle>;
  };
  return module.startMcpServer(options);
}
