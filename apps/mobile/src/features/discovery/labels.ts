import { SearchSpacesSort } from '@space-sports/api-client';
import { MIN_RATING_OPTION } from './filters-store';

/** Chip da nota mínima na folha de filtros (decisão 109). */
export const MIN_RATING_LABEL = `${MIN_RATING_OPTION}+ estrelas`;

export interface SortOption {
  value: SearchSpacesSort;
  label: string;
  testID: string;
}

/**
 * "Ordenar por" da folha de filtros. A ordem padrão é pela distância; sem localização a API lista por
 * nome, e o rótulo diz isso em vez de prometer "Mais perto".
 */
export function sortOptions(hasLocation: boolean): SortOption[] {
  return [
    {
      value: SearchSpacesSort.distance,
      label: hasLocation ? 'Mais perto' : 'Por nome',
      testID: 'filtros-ordem-distancia',
    },
    { value: SearchSpacesSort.rating, label: 'Melhor avaliados', testID: 'filtros-ordem-nota' },
  ];
}

/**
 * Lista vazia com o "4+ estrelas" como único filtro: explica a regra da nota pública e oferece tirar o
 * filtro.
 */
export const MIN_RATING_EMPTY = {
  title: `Nenhum espaço com ${MIN_RATING_LABEL}`,
  description: `O filtro “${MIN_RATING_LABEL}” só mostra espaços com nota, e a nota aparece a partir de 5 avaliações. Tire o filtro para ver também os espaços novos.`,
  action: `Tirar “${MIN_RATING_LABEL}”`,
} as const;

/**
 * Lista vazia com o "4+ estrelas" e mais busca ou filtro: o vazio genérico, com a regra da nota no
 * texto e dois botões ("Tirar “4+ estrelas”" e "Limpar filtros").
 */
export const MIN_RATING_WITH_OTHERS_EMPTY_DESCRIPTION = `Tente outro nome ou afrouxe os filtros. O “${MIN_RATING_LABEL}” só mostra espaços com nota (a partir de 5 avaliações).`;

/** Botão que limpa tudo no vazio do Explorar; com busca por nome, diz que a busca também sai. */
export function clearAllLabel(hasQuery: boolean): string {
  return hasQuery ? 'Limpar busca e filtros' : 'Limpar filtros';
}

/** Aviso do mapa sem pins; com o "4+ estrelas", lembra que só entram espaços com nota. */
export function mapEmptyMessage(minRatingOn: boolean): string {
  const base = 'Nenhum espaço com localização para estes filtros.';
  return minRatingOn
    ? `${base} O “${MIN_RATING_LABEL}” só mostra espaços com nota (a partir de 5 avaliações).`
    : base;
}
