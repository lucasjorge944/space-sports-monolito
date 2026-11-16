import type { McpOAuthScope, McpResourceKind } from '@space-sports/shared';
import type { SurfaceName } from '../config.js';
import type { AnyPrompt } from '../mcp/prompt.js';
import type { AnyTool } from '../mcp/tool.js';

/**
 * Uma superfície do `apps/mcp` (decisão 120; `docs/14-mcp.md` 8.1): um conector com o seu recurso
 * OAuth, os seus escopos, tools e prompts. A URL do recurso (`aud`) vem da configuração
 * (`SurfaceConfig`); o resto é código.
 */
export interface SurfaceDefinition {
  name: SurfaceName;
  /** Recurso OAuth da API: decide os escopos aceitos (`MCP_RESOURCE_SCOPES`). */
  resource: McpResourceKind;
  /** `resource_name` do metadata RFC 9728 e título do servidor MCP. */
  title: string;
  /** Nome técnico do servidor MCP (`serverInfo.name`). */
  serverName: string;
  /** Escopos anunciados no metadata e no desafio do 401/403 (na ordem canônica). */
  scopes: readonly McpOAuthScope[];
  tools: readonly AnyTool[];
  prompts: readonly AnyPrompt[];
  /** Instruções do servidor para o assistente, conforme os escopos do token. */
  instructions(scopes: ReadonlySet<McpOAuthScope>): string;
  /** Mensagem do 503 quando a superfície está desligada (chave global ou a dela). */
  disabledMessage: string;
}
