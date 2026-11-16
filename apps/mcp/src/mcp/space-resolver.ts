import {
  isApiError,
  type PublicSpace,
  type SpaceCard,
} from '@space-sports/api-client/dist/fetch.js';
import { z } from 'zod';
import type { ApiClient } from '../api/client.js';
import { ToolError } from './tool-error.js';

export const spaceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe(
    'Espaço: id, slug (ex.: "arena-sul") ou parte do nome (ex.: "Arena Sul"). Se o nome for ambíguo, a tool devolve as opções para o usuário escolher.',
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Páginas da busca percorridas para achar um espaço pelo id (a API não busca por id). */
const MAX_ID_PAGES = 5;
const MAX_OPTIONS = 10;

/** Sem acento, minúsculo, só letras e números separados por hífen (como os slugs). */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve o espaço (só os visíveis na vitrine, como no app) e devolve a página dele. Ordem: id
 * (uuid) → slug (o texto normalizado) → busca por nome (`GET /v1/spaces?q=`). Nome com mais de um
 * resultado e nenhum exato: `SPACE_AMBIGUOUS` com as opções, sem escolher pelo usuário.
 */
export async function resolveSpace(api: ApiClient, ref: string): Promise<PublicSpace> {
  const value = ref.trim();
  if (UUID.test(value)) {
    const card = await findById(api, value.toLowerCase());
    if (!card) throw notFound(value);
    return api.getSpace(card.slug);
  }
  const slug = normalize(value);
  if (SLUG.test(slug)) {
    const bySlug = await getIfExists(api, slug);
    if (bySlug) return bySlug;
  }
  const { items } = await api.searchSpaces({ q: value.slice(0, 100), limit: MAX_OPTIONS });
  const exact = items.filter((card) => normalize(card.name) === slug || card.slug === slug);
  const matches = exact.length === 1 ? exact : items;
  if (matches.length === 1 && matches[0]) return api.getSpace(matches[0].slug);
  if (matches.length === 0) throw notFound(value);
  throw new ToolError(
    'SPACE_AMBIGUOUS',
    `Há mais de um espaço para "${value}". Pergunte ao usuário qual deles e chame a tool de novo com o slug escolhido.`,
    {
      options: matches.map((card) => ({
        id: card.id,
        slug: card.slug,
        name: card.name,
        neighborhood: card.neighborhood,
        city: card.city,
      })),
    },
  );
}

async function getIfExists(api: ApiClient, slug: string): Promise<PublicSpace | null> {
  try {
    return await api.getSpace(slug);
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

async function findById(api: ApiClient, id: string): Promise<SpaceCard | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ID_PAGES; page++) {
    const result = await api.searchSpaces({ limit: 50, ...(cursor ? { cursor } : {}) });
    const found = result.items.find((card) => card.id.toLowerCase() === id);
    if (found || !result.nextCursor) return found;
    cursor = result.nextCursor;
  }
  return undefined;
}

function notFound(ref: string): ToolError {
  return new ToolError(
    'SPACE_NOT_FOUND',
    `Nenhum espaço encontrado para "${ref}". Use search_spaces para ver os espaços disponíveis.`,
  );
}
