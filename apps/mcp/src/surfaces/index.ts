import type { SurfaceName } from '../config.js';
import { adminSurface } from './admin.js';
import type { SurfaceDefinition } from './types.js';
import { userSurface } from './user.js';

export type { SurfaceDefinition } from './types.js';

/** Definição de cada superfície: `user` (jogador e gestão) e `admin` (Super). */
export const SURFACES: Record<SurfaceName, SurfaceDefinition> = {
  user: userSurface,
  admin: adminSurface,
};
