import { type SearchSpacesParams, SearchSpacesSort } from '@space-sports/api-client';
import type { Coords } from '@/features/location/coords';
import type { FiltersContext, SpaceFilters } from './filters-store';

export const PAGE_SIZE = 20;

/**
 * Parâmetros de GET /v1/spaces. Sem localização não há raio nem distância: lista por nome. A ordem
 * só vai quando não é a padrão, e nunca no mapa (`context: 'map'`, decisão 109), que manda só o
 * `minRating`.
 */
export function buildSearchParams(
  filters: SpaceFilters,
  coords: Coords | null,
  debouncedQuery: string,
  { limit = PAGE_SIZE, context = 'list' }: { limit?: number; context?: FiltersContext } = {},
): SearchSpacesParams {
  const q = debouncedQuery.trim();
  return {
    ...(coords ? { lat: coords.lat, lng: coords.lng, radiusKm: filters.radiusKm } : {}),
    ...(filters.sport ? { sport: filters.sport } : {}),
    ...(filters.service ? { service: filters.service } : {}),
    ...(filters.amenities.length > 0 ? { amenities: filters.amenities.join(',') } : {}),
    ...(q ? { q } : {}),
    ...(filters.minRating !== null ? { minRating: filters.minRating } : {}),
    ...(context === 'list' && filters.sort !== SearchSpacesSort.distance
      ? { sort: filters.sort }
      : {}),
    limit,
  };
}
