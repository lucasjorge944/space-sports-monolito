import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  ServerContext,
  ToolAnnotations,
} from '@modelcontextprotocol/server';
import type { StaffSpacesResponse } from '@space-sports/api-client/dist/fetch.js';
import type { McpOAuthScope } from '@space-sports/shared';
import type { z } from 'zod';
import type { ApiClient } from '../api/client.js';
import { toToolError } from '../api/errors.js';
import type { McpUser } from '../auth/user.js';
import type { SurfaceName } from '../config.js';
import type { Logger } from '../logger.js';
import type { ConfirmationCodes } from './confirmation.js';
import type { CachedStaffSpaces } from './manage/staff-cache.js';
import type { ToolError } from './tool-error.js';

/** O que cada tool recebe além da entrada já validada. */
export interface ToolContext {
  user: McpUser;
  api: ApiClient;
  codes: ConfirmationCodes;
  now: () => Date;
  /** URL pública do web (links "conclua no app"). */
  webUrl: string;
  /** O cliente declarou elicitation por formulário nesta requisição (protocolo 2026-07-28). */
  canElicit: boolean;
  /** Chave do `requestState` da elicitation (derivada de `MCP_CONFIRMATION_SECRET`). */
  requestStateKey: Uint8Array;
  /** Contexto da requisição MCP (respostas de elicitation de uma nova tentativa). */
  mcp: ServerContext;
  /**
   * Espaços em que o usuário é da equipe (`GET /v1/me/staff-spaces`), sempre da API e inteiros
   * (com a agenda de hoje); renova o cache do usuário, que guarda só a versão reduzida.
   */
  staffSpaces(): Promise<StaffSpacesResponse>;
  /**
   * Os mesmos espaços reduzidos a id, slug, nome, papéis e fuso, do cache de 60 s do usuário
   * (`manage/staff-cache.ts`) ou da API; `cached` diz se vieram do cache.
   */
  managedSpaces(): Promise<CachedStaffSpaces>;
}

/** Resultado de uma tool: resumo curto em português + dados estruturados mínimos. */
export type ToolOutcome<D = Record<string, unknown>> =
  | { kind: 'result'; summary: string; data: D }
  | { kind: 'input_required'; result: InputRequiredResult };

export const done = <D extends Record<string, unknown>>(
  summary: string,
  data: D,
): ToolOutcome<D> => ({ kind: 'result', summary, data });

/** Dados da saída: os do `outputSchema` quando a tool declara um. */
type OutputOf<O> = O extends z.ZodObject ? z.input<O> : Record<string, unknown>;

export interface ToolDefinition<
  S extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject | undefined = undefined,
> {
  name: string;
  title: string;
  description: string;
  /**
   * TODOS os escopos das rotas da API que a tool chama (`docs/14-mcp.md` 4.1), não só o da ação
   * principal: faltando algum, a tool não aparece em `tools/list` e a chamada recebe 403. Lista
   * vazia = qualquer escopo do MCP (o token sem nenhum já recebe 403 antes).
   */
  scopes: readonly McpOAuthScope[];
  inputSchema: S;
  /**
   * Saída estruturada (`structuredContent`): o SDK a anuncia em `tools/list` e confere o resultado
   * antes de responder. Opcional nas tools da fase 1; obrigatória nas da gestão.
   */
  outputSchema?: O;
  /**
   * Orientação por código de erro da API no lugar da padrão (`api/errors.ts`), quando a tool pede
   * outro caminho (ex.: na gestão, espaço não encontrado aponta para `list_my_managed_spaces`).
   */
  hints?: Readonly<Record<string, string>>;
  annotations: ToolAnnotations;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutcome<OutputOf<O>>>;
}

/** Tool com a entrada e a saída apagadas do tipo, para registrar a lista heterogênea. */
export interface AnyTool {
  name: string;
  title: string;
  description: string;
  scopes: readonly McpOAuthScope[];
  inputSchema: z.ZodObject;
  outputSchema?: z.ZodObject;
  hints?: Readonly<Record<string, string>>;
  annotations: ToolAnnotations;
  run(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

export function defineTool<S extends z.ZodObject, O extends z.ZodObject | undefined = undefined>(
  definition: ToolDefinition<S, O>,
): AnyTool {
  // O SDK valida a entrada com `inputSchema` antes de chamar `run` (e a saída com `outputSchema`).
  return {
    ...definition,
    outputSchema: definition.outputSchema,
    run: async (input, ctx) =>
      (await definition.run(input as z.output<S>, ctx)) as ToolOutcome<Record<string, unknown>>,
  };
}

export interface RegisterOptions {
  user: McpUser;
  surface: SurfaceName;
  era: 'legacy' | 'modern';
  logger: Logger;
  context: (mcp: ServerContext, canElicit: boolean) => ToolContext;
}

/**
 * Registra só as tools cujo escopo o token tem (as demais nem aparecem em `tools/list`). Cada
 * chamada vira um log estruturado (sub, cliente, tool, duração, resultado) e qualquer falha vira um
 * resultado `isError` com mensagem em português, sem stack.
 */
export function registerTools(server: McpServer, tools: AnyTool[], options: RegisterOptions): void {
  const { user, logger, surface } = options;
  for (const tool of tools) {
    if (!tool.scopes.every((scope) => user.scopes.has(scope))) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.annotations,
      },
      async (input: unknown, mcp: ServerContext) => {
        const started = performance.now();
        let result = 'ok';
        try {
          const outcome = await tool.run(
            input,
            options.context(mcp, options.era === 'modern' && supportsFormElicitation(server)),
          );
          if (outcome.kind === 'input_required') {
            result = 'input_required';
            return outcome.result;
          }
          return success(outcome.summary, outcome.data);
        } catch (error) {
          const toolError = toToolError(error, tool.hints);
          result = toolError.code;
          if (toolError.code === 'API_UNAVAILABLE') {
            logger.warn({ event: 'api_error', surface, tool: tool.name, error: describe(error) });
          }
          return failure(toolError);
        } finally {
          logger.info({
            event: 'tool_call',
            surface,
            sub: user.sub,
            clientId: user.clientId,
            tool: tool.name,
            durationMs: Math.round(performance.now() - started),
            result,
          });
        }
      },
    );
  }
}

/** Elicitation por formulário: `elicitation: {}` (forma antiga) ou com `form`. */
function supportsFormElicitation(server: McpServer): boolean {
  const elicitation = server.server.getClientCapabilities()?.elicitation as
    | Record<string, unknown>
    | undefined;
  if (!elicitation) return false;
  return Object.keys(elicitation).length === 0 || 'form' in elicitation;
}

/** Texto curto + o JSON dos dados (para clientes que só leem `content`) + `structuredContent`. */
function success(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

function failure(error: ToolError): CallToolResult {
  const data = { error: { code: error.code, message: error.message, ...(error.data ?? {}) } };
  return {
    isError: true,
    content: [
      { type: 'text', text: error.message },
      { type: 'text', text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

/** Só o tipo e o código do erro inesperado (nada de mensagem com dados, corpo ou stack). */
function describe(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const { name, code, status } = error as { name?: unknown; code?: unknown; status?: unknown };
    return { name, code, status };
  }
  return { name: typeof error };
}
