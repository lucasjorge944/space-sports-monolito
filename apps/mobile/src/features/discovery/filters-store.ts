import { type SearchSpacesService, SearchSpacesSort } from '@space-sports/api-client';
import { useSyncExternalStore } from 'react';

export interface SpaceFilters {
  /** Busca por nome. */
  q: string;
  /** Slug do esporte. */
  sport: string | null;
  service: SearchSpacesService | null;
  /** Slugs de infraestrutura (todas precisam existir no espaço). */
  amenities: string[];
  /** Raio em km; só vale com localização. */
  radiusKm: number;
  /** Nota mínima ("4+ estrelas", decisão 109): só espaços com a nota pública. `null` = todos. */
  minRating: number | null;
  /** Ordem da lista: `distance` (mais perto; por nome sem localização) ou `rating`. Não vale no mapa. */
  sort: SearchSpacesSort;
}

export const RADIUS_OPTIONS = [2, 5, 10, 25, 50] as const;
export const DEFAULT_RADIUS_KM = 10;
/** A única nota mínima oferecida no app: "4+ estrelas" (decisão 109). */
export const MIN_RATING_OPTION = 4;

export const DEFAULT_FILTERS: SpaceFilters = {
  q: '',
  sport: null,
  service: null,
  amenities: [],
  radiusKm: DEFAULT_RADIUS_KM,
  minRating: null,
  sort: SearchSpacesSort.distance,
};

/** Onde a folha de filtros está: no mapa a ordem não vale (decisão 109). */
export type FiltersContext = 'list' | 'map';

// Filtros compartilhados entre Explorar e Mapa: mudar numa aba vale na outra.
let current: SpaceFilters = DEFAULT_FILTERS;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getFilters(): SpaceFilters {
  return current;
}

export function setFilters(patch: Partial<SpaceFilters>): void {
  current = { ...current, ...patch };
  emit();
}

/**
 * "Limpar": volta tudo ao padrão, menos a busca por nome. No mapa, a ordem (que lá não aparece nem
 * vale) fica como estava no Explorar.
 */
export function resetFilters(context: FiltersContext = 'list'): void {
  current = {
    ...DEFAULT_FILTERS,
    q: current.q,
    ...(context === 'map' ? { sort: current.sort } : {}),
  };
  emit();
}

/**
 * "Limpar filtros" do vazio do Explorar: tudo ao padrão, inclusive a busca por nome (o "Limpar" da
 * folha mantém a busca).
 */
export function clearSearchAndFilters(): void {
  current = DEFAULT_FILTERS;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFilters(): SpaceFilters {
  return useSyncExternalStore(subscribe, getFilters, getFilters);
}

/**
 * Quantos filtros (fora a busca por nome) estão ligados, para o selo do botão. A ordem "Melhor
 * avaliados" conta na lista, mas não no mapa, em que não vale.
 */
export function countActiveFilters(
  filters: SpaceFilters,
  context: FiltersContext = 'list',
): number {
  return (
    (filters.sport ? 1 : 0) +
    (filters.service ? 1 : 0) +
    filters.amenities.length +
    (filters.radiusKm !== DEFAULT_RADIUS_KM ? 1 : 0) +
    (filters.minRating !== null ? 1 : 0) +
    (context === 'list' && filters.sort !== SearchSpacesSort.distance ? 1 : 0)
  );
}

/**
 * O "4+ estrelas" é a única coisa que restringe a lista: sem busca por nome e sem outro filtro. A ordem
 * não conta, porque não tira espaço da lista. Decide o vazio do Explorar (decisão 109).
 */
export function isOnlyMinRatingOn(filters: SpaceFilters): boolean {
  return (
    filters.minRating !== null &&
    filters.q.trim() === '' &&
    countActiveFilters(filters, 'map') === 1
  );
}

/** Alterna um slug de infraestrutura na lista. */
export function toggleAmenity(amenities: string[], slug: string): string[] {
  return amenities.includes(slug) ? amenities.filter((a) => a !== slug) : [...amenities, slug];
}
