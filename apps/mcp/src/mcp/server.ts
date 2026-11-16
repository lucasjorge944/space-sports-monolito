import { type McpRequestContext, McpServer } from '@modelcontextprotocol/server';
import { createApiClient } from '../api/client.js';
import { userFromAuthInfo } from '../auth/user.js';
import type { Logger } from '../logger.js';
import type { SurfaceDefinition } from '../surfaces/index.js';
import type { ConfirmationCodes } from './confirmation.js';
import { StaffSpacesCache } from './manage/staff-cache.js';
import { registerPrompts } from './prompt.js';
import { registerTools } from './tool.js';

export const SERVER_VERSION = '0.2.0';

export interface ServerDeps {
  codes: ConfirmationCodes;
  requestStateKey: Uint8Array;
  logger: Logger;
  webUrl: string;
  now: () => Date;
  /** Cache por usuário de `GET /v1/me/staff-spaces` (um por processo). */
  staffSpaces: StaffSpacesCache;
}

/**
 * Fábrica chamada pelo `createMcpHandler` a cada requisição (sem estado): um `McpServer` novo da
 * superfície, com só as tools e os prompts que o token permite, falando com a API pelo token do
 * próprio usuário.
 */
export function createServerFactory(deps: ServerDeps, surface: SurfaceDefinition) {
  return (ctx: McpRequestContext): McpServer => {
    const user = userFromAuthInfo(ctx.authInfo);
    const server = new McpServer(
      { name: surface.serverName, title: surface.title, version: SERVER_VERSION },
      {
        instructions: surface.instructions(user?.scopes ?? new Set()),
        capabilities: { tools: {}, ...(surface.prompts.length ? { prompts: {} } : {}) },
      },
    );
    if (!user) return server;
    const api = createApiClient(user.token);
    const staffKey = StaffSpacesCache.keyOf(user.sub, user.token);
    registerTools(server, [...surface.tools], {
      user,
      surface: surface.name,
      era: ctx.era,
      logger: deps.logger,
      context: (mcp, canElicit) => ({
        user,
        api,
        codes: deps.codes,
        now: deps.now,
        webUrl: deps.webUrl,
        canElicit,
        requestStateKey: deps.requestStateKey,
        mcp,
        staffSpaces: () => deps.staffSpaces.refresh(staffKey, () => api.staffSpaces()),
        managedSpaces: () => deps.staffSpaces.get(staffKey, () => api.staffSpaces()),
      }),
    });
    registerPrompts(server, surface.prompts, {
      user,
      surface: surface.name,
      logger: deps.logger,
      now: deps.now,
    });
    return server;
  };
}
