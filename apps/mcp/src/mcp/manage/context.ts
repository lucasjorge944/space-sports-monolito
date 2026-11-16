import type { StaffSpacesResponse } from '@space-sports/api-client/dist/fetch.js';
import { ANALYTICS_MAX_DATE, ANALYTICS_MIN_DATE } from '@space-sports/shared';
import { z } from 'zod';
import type { ApiClient } from '../../api/client.js';
import type { McpUser } from '../../auth/user.js';
import { dateBetween } from '../../shared/time.js';
import { normalize } from '../space-resolver.js';
import type { ToolContext } from '../tool.js';
import { ToolError } from '../tool-error.js';
import { type CachedStaffSpace, toCachedStaffSpace } from './staff-cache.js';

/**
 * Base das tools de gestão (`docs/14-mcp.md` 8.5; decisões 120 a 122): o espaço sai sempre da
 * lista de `GET /v1/me/staff-spaces` (os espaços em que o usuário tem vínculo ativo), e o id que
 * vai para a API é o dela, nunca um texto do usuário. A autorização é da API (`SpaceRolesGuard`,
 * decisão 53): estas tools não decidem o que o papel vê, só não pedem o que já se sabe recusado.
 */

export type StaffSpace = StaffSpacesResponse['items'][number];
export type SpaceRole = StaffSpace['roles'][number];

export const ROLE_LABELS: Record<SpaceRole, string> = {
  OWNER: 'Dono',
  ADMIN: 'Admin',
  TEACHER: 'Professor',
};

/** Orientação dos erros da API nas tools de gestão (no lugar das da fase 1, que são de jogador). */
export const MANAGE_HINTS: Readonly<Record<string, string>> = {
  SPACE_NOT_FOUND:
    'Espaço não encontrado entre os que o usuário administra. Use list_my_managed_spaces e chame a tool de novo com o id do espaço.',
  BOOKING_NOT_FOUND: 'Reserva não encontrada neste espaço. Use list_space_bookings.',
  COURT_NOT_FOUND: 'Quadra não encontrada neste espaço.',
  CLASS_GROUP_NOT_FOUND: 'Turma não encontrada neste espaço. Use list_class_groups.',
};

export const managedSpaceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Espaço que o usuário administra: id, slug ou parte do nome. Pode ficar vazio quando ele é da equipe de um espaço só. Nome ambíguo: a tool devolve as opções para o usuário escolher.',
  );

/** Faixa das datas das métricas, como a API aceita (BUG-MCP2-2). */
export const METRICS_DATE_RANGE = `de ${ANALYTICS_MIN_DATE} a ${ANALYTICS_MAX_DATE}`;
const metricsDateSchema = dateBetween(ANALYTICS_MIN_DATE, ANALYTICS_MAX_DATE);

/** `from`/`to` das métricas: datas locais do espaço, inclusive, na faixa da API. */
export const periodFields = {
  from: metricsDateSchema
    .optional()
    .describe(
      `Data inicial (YYYY-MM-DD, inclusive, ${METRICS_DATE_RANGE}). Padrão: 29 dias antes de \`to\`.`,
    ),
  to: metricsDateSchema
    .optional()
    .describe(`Data final (YYYY-MM-DD, inclusive, ${METRICS_DATE_RANGE}). Padrão: hoje.`),
};

export const spaceOutputSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  /** Papéis do usuário neste espaço (Dono, Admin, Professor). */
  roles: z.array(z.string()),
});

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManagedSpace {
  /** O espaço como o cache guarda (id, slug, nome, papéis do usuário e fuso). */
  space: CachedStaffSpace;
  /**
   * O usuário pode receber valores neste espaço: Dono ou Admin (decisão 53) e o escopo
   * `manage:finance:read` no token. Só evita pedir à API o que ela recusaria; quem decide é ela.
   */
  seesValues: boolean;
}

export function seesValues(space: Pick<CachedStaffSpace, 'roles'>, user: McpUser): boolean {
  return (
    user.scopes.has('manage:finance:read') &&
    space.roles.some((role) => role === 'OWNER' || role === 'ADMIN')
  );
}

/** O espaço como sai nas tools (e nas opções de um nome ambíguo): id, slug, nome e os papéis. */
export function spaceOutput(space: CachedStaffSpace) {
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    roles: space.roles.map((role) => ROLE_LABELS[role] ?? role),
  };
}

/**
 * Escolhe o espaço numa lista: id → slug → nome exato (sem acento nem caixa) → parte do nome. Sem
 * `ref`, só se a lista tiver um espaço. Mais de um resultado: as opções, sem escolher pelo usuário.
 */
function pickSpace<T>(
  items: readonly T[],
  ref: string | undefined,
  view: (item: T) => CachedStaffSpace,
): T {
  const options = (list: readonly T[]) => list.map((item) => spaceOutput(view(item)));
  if (items.length === 0) {
    throw new ToolError(
      'NOT_STAFF',
      'O usuário conectado não é da equipe (Dono, Admin ou Professor) de nenhum espaço no Space Sports. As tools de gestão só valem para a equipe.',
    );
  }
  const value = ref?.trim();
  if (!value) {
    if (items.length === 1 && items[0] !== undefined) return items[0];
    throw new ToolError(
      'SPACE_REQUIRED',
      'O usuário é da equipe de mais de um espaço. Pergunte qual e chame a tool de novo com o parâmetro space.',
      { options: options(items) },
    );
  }
  const byId = UUID.test(value)
    ? items.find((item) => view(item).id.toLowerCase() === value.toLowerCase())
    : undefined;
  if (byId !== undefined) return byId;
  const key = normalize(value);
  const exact = items.filter((item) => {
    const space = view(item);
    return space.slug === key || normalize(space.name) === key;
  });
  if (exact.length === 1 && exact[0] !== undefined) return exact[0];
  const partial = exact.length
    ? exact
    : items.filter((item) => key && normalize(view(item).name).includes(key));
  if (partial.length === 1 && partial[0] !== undefined) return partial[0];
  if (partial.length > 1) {
    throw new ToolError(
      'SPACE_AMBIGUOUS',
      `Há mais de um espaço do usuário para "${value}". Pergunte qual deles e chame a tool de novo com o id escolhido.`,
      { options: options(partial) },
    );
  }
  throw new ToolError(
    'SPACE_NOT_FOUND',
    `"${value}" não está entre os espaços que o usuário administra. Veja as opções (ou list_my_managed_spaces).`,
    { options: options(items) },
  );
}

const sameSpace = (space: CachedStaffSpace) => space;

/**
 * Espaço entre os que o usuário administra (`pickSpace`), pela lista do cache de 60 s do usuário.
 * Antes de recusar (`NOT_STAFF`, `SPACE_REQUIRED`, `SPACE_AMBIGUOUS` ou `SPACE_NOT_FOUND`) com a
 * lista do cache, relê uma vez da API: o usuário pode ter ganhado um papel ou o espaço pode ter
 * mudado de nome há menos de 60 s.
 */
export async function resolveManagedSpace(
  { user, managedSpaces, staffSpaces }: Pick<ToolContext, 'user' | 'managedSpaces' | 'staffSpaces'>,
  ref: string | undefined,
): Promise<ManagedSpace> {
  const found = (space: CachedStaffSpace): ManagedSpace => ({
    space,
    seesValues: seesValues(space, user),
  });
  const list = await managedSpaces();
  try {
    return found(pickSpace(list.items, ref, sameSpace));
  } catch (error) {
    if (!list.cached || !(error instanceof ToolError)) throw error;
  }
  const fresh = (await staffSpaces()).items.map(toCachedStaffSpace);
  return found(pickSpace(fresh, ref, sameSpace));
}

/**
 * Como `resolveManagedSpace`, mas sempre com a lista da API, inteira (com a agenda de hoje do
 * espaço): é a base do `get_space_today`, que mostra a agenda e não pode usar a de 60 s atrás.
 */
export async function resolveManagedSpaceToday(
  { user, staffSpaces }: Pick<ToolContext, 'user' | 'staffSpaces'>,
  ref: string | undefined,
): Promise<ManagedSpace & { today: StaffSpace['today'] }> {
  const { items } = await staffSpaces();
  const item = pickSpace(items, ref, toCachedStaffSpace);
  const space = toCachedStaffSpace(item);
  return { space, seesValues: seesValues(space, user), today: item.today };
}

export const courtFilterSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Só uma quadra: id ou nome (ex.: "Quadra 1"; a `key` das linhas por quadra também serve).',
  );

export const sportFilterSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .optional()
  .describe('Só um esporte: id, slug ou nome (ex.: "futevolei", "Beach Tennis").');

/** Quadra (id ou nome) e esporte (id, slug ou nome) do espaço, pelas quadras da gestão. */
export async function resolveCourtAndSport(
  api: ApiClient,
  spaceId: string,
  refs: { court?: string | undefined; sport?: string | undefined },
): Promise<{ courtId?: string; sportId?: string }> {
  if (!refs.court && !refs.sport) return {};
  const { items: courts } = await api.listCourts(spaceId);
  const result: { courtId?: string; sportId?: string } = {};
  if (refs.court) {
    const key = normalize(refs.court);
    const court = courts.find(
      (item) => item.id.toLowerCase() === refs.court?.toLowerCase() || normalize(item.name) === key,
    );
    if (!court) {
      throw new ToolError('COURT_NOT_FOUND', `Quadra "${refs.court}" não encontrada no espaço.`, {
        options: courts.map((item) => ({ id: item.id, name: item.name })),
      });
    }
    result.courtId = court.id;
  }
  if (refs.sport) {
    const sports = new Map<string, { sportId: string; slug: string; name: string }>();
    for (const court of courts) {
      for (const sport of court.sports) sports.set(sport.sportId, sport);
    }
    const key = normalize(refs.sport);
    const sport = [...sports.values()].find(
      (item) =>
        item.sportId.toLowerCase() === refs.sport?.toLowerCase() ||
        item.slug === key ||
        normalize(item.name) === key,
    );
    if (!sport) {
      throw new ToolError('SPORT_NOT_OFFERED', `O espaço não tem quadra de "${refs.sport}".`, {
        options: [...sports.values()].map(({ slug, name }) => ({ slug, name })),
      });
    }
    result.sportId = sport.sportId;
  }
  return result;
}
