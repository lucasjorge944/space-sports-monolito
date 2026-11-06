import { SearchSpacesSort } from '@space-sports/api-client';
import type { SpaceFilters } from '@/features/discovery/filters-store';

type ContentFilters = Pick<SpaceFilters, 'sport' | 'service' | 'amenities' | 'minRating' | 'sort'>;

/**
 * Filtro "de conteúdo" do Explorar: esporte, serviço, infraestrutura, "4+ estrelas" ou a ordem
 * "Melhor avaliados" (decisão 109). O raio de distância não conta (docs/05, "Explorar e anúncios"):
 * ele só restringe a lista, sem esconder seção nem trocar o título. Por isso não usamos o
 * `countActiveFilters`, que soma o raio para o selo do botão.
 */
export function hasContentFilters(filters: ContentFilters): boolean {
  return (
    !!filters.sport ||
    !!filters.service ||
    filters.amenities.length > 0 ||
    filters.minRating !== null ||
    filters.sort !== SearchSpacesSort.distance
  );
}

export interface ExploreSections {
  /** Atalhos por esporte: somem só com a busca por nome. */
  shortcuts: boolean;
  /** Carrossel patrocinado: some com busca por nome ou filtro. */
  hero: boolean;
  /** Espaços recentes: some com busca por nome ou filtro. */
  recents: boolean;
  listTitle: string;
}

/** Quais seções do topo aparecem e o título da lista (RF-SPACE-12, RF-SPACE-13, RF-ADS-04). */
export function exploreSections({
  query,
  filters,
  hasLocation,
}: {
  /** Busca por nome já com o debounce (a mesma que vai para a API). */
  query: string;
  filters: ContentFilters;
  hasLocation: boolean;
}): ExploreSections {
  const searching = query.trim() !== '';
  const narrowed = searching || hasContentFilters(filters);
  return {
    shortcuts: !searching,
    hero: !narrowed,
    recents: !narrowed,
    listTitle: narrowed ? 'Resultados' : hasLocation ? 'Espaços perto de você' : 'Espaços',
  };
}
