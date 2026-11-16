import type { McpServer } from '@modelcontextprotocol/server';
import type { McpOAuthScope } from '@space-sports/shared';
import type { z } from 'zod';
import type { McpUser } from '../auth/user.js';
import type { SurfaceName } from '../config.js';
import type { Logger } from '../logger.js';

/**
 * Prompt MCP: um atalho que o cliente oferece ao usuário (ex.: "Relatório mensal do espaço") e
 * que vira uma mensagem orientando o assistente a chamar as tools certas. Não chama a API nem lê
 * dados: só monta o texto a partir dos argumentos (sempre texto, como manda o protocolo).
 */
export interface PromptDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  /** Como nas tools: sem todos os escopos, o prompt não aparece em `prompts/list`. */
  scopes: readonly McpOAuthScope[];
  argsSchema: S;
  /** Texto da mensagem do usuário. `scopes` são os do token (o texto cita só as tools liberadas). */
  build(args: z.output<S>, context: { scopes: ReadonlySet<McpOAuthScope>; now: Date }): string;
}

export interface AnyPrompt extends Omit<PromptDefinition, 'build'> {
  build(args: unknown, context: { scopes: ReadonlySet<McpOAuthScope>; now: Date }): string;
}

export function definePrompt<S extends z.ZodObject>(definition: PromptDefinition<S>): AnyPrompt {
  // O SDK valida os argumentos com `argsSchema` antes de chamar (erro -32602 se não baterem).
  return {
    ...definition,
    build: (args, context) => definition.build(args as z.output<S>, context),
  };
}

export interface RegisterPromptOptions {
  user: McpUser;
  surface: SurfaceName;
  logger: Logger;
  now: () => Date;
}

/** Registra os prompts que o token permite; cada `prompts/get` vira um log sem os argumentos. */
export function registerPrompts(
  server: McpServer,
  prompts: readonly AnyPrompt[],
  { user, surface, logger, now }: RegisterPromptOptions,
): void {
  for (const prompt of prompts) {
    if (!prompt.scopes.every((scope) => user.scopes.has(scope))) continue;
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
      (args: unknown) => {
        logger.info({
          event: 'prompt_get',
          surface,
          sub: user.sub,
          clientId: user.clientId,
          prompt: prompt.name,
        });
        return {
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: prompt.build(args, { scopes: user.scopes, now: now() }),
              },
            },
          ],
        };
      },
    );
  }
}
