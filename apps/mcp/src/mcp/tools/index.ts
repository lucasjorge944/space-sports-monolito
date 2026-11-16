import type { AnyTool } from '../tool.js';
import { bookingTools } from './bookings.js';
import { classTools } from './classes.js';
import { manageTools } from './manage.js';
import { manageFinanceTools } from './manage-finance.js';
import { manageMetricTools } from './manage-metrics.js';
import { meTools } from './me.js';
import { spaceTools } from './spaces.js';
import { superTools } from './super.js';

/** Tools de jogador da fase 1 (`docs/14-mcp.md` 4.1) e a saudação (`GET /v1/me/summary`). */
export const PLAYER_TOOLS: AnyTool[] = [...meTools, ...spaceTools, ...bookingTools, ...classTools];

/** Gestão em leitura (`docs/14-mcp.md` 8.5): `manage:read` e, nas de valores, `manage:finance:read`. */
export const MANAGE_TOOLS: AnyTool[] = [
  ...manageTools,
  ...manageMetricTools,
  ...manageFinanceTools,
];

/** Plataforma em leitura, só no conector do Super (`super:read`; `docs/14-mcp.md` 8.5). */
export const SUPER_TOOLS: AnyTool[] = [...superTools];
