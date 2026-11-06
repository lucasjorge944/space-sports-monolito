import {
  getGetReviewEligibilityQueryKey,
  getGetSpaceBySlugQueryKey,
  getGetSpaceReviewSummaryQueryKey,
  getListMyReviewsQueryKey,
  getListRecentSpacesQueryKey,
  getListSpaceReviewsQueryKey,
  listMyReviews,
  listSpaceReviews,
  type MyReviewPage,
  type PublicReviewPage,
} from '@space-sports/api-client';
import { reviewLayout } from '@space-sports/ui-tokens';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { SPACES_SEARCH_QUERY_KEY } from '@/features/discovery/use-spaces-search';

/** Lista pública do espaço (RF-REVIEW-04), paginada por cursor e filtrada por nota. */
export function useSpaceReviews(spaceId: string | undefined, rating: number | null) {
  const params = rating ? { rating } : undefined;
  return useInfiniteQuery({
    queryKey: [...getListSpaceReviewsQueryKey(spaceId ?? '', params), 'infinite'] as const,
    enabled: Boolean(spaceId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<PublicReviewPage> =>
      listSpaceReviews(
        spaceId ?? '',
        {
          ...(rating ? { rating } : {}),
          limit: reviewLayout.pageSize,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Minhas avaliações (RF-REVIEW-08). */
export function useMyReviews() {
  return useInfiniteQuery({
    queryKey: [...getListMyReviewsQueryKey(), 'infinite'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<MyReviewPage> =>
      listMyReviews(
        { limit: reviewLayout.pageSize, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Depois de criar, editar ou excluir: resumo, lista, elegibilidade, Minhas avaliações, a nota do
 * espaço no cabeçalho da página (docs/05, "(3) Sucesso") e o selo dos cards (busca do Explorar e do
 * mapa, Espaços recentes). Os anúncios ficam de fora: têm limite de buscas por minuto e atualizam na
 * próxima abertura do Explorar.
 */
export function useInvalidateReviews() {
  const queryClient = useQueryClient();
  return useCallback(
    (spaceId: string, slug?: string) => {
      const keys = [
        getGetSpaceReviewSummaryQueryKey(spaceId),
        // Prefixo: pega todas as notas do filtro e as páginas.
        getListSpaceReviewsQueryKey(spaceId),
        getGetReviewEligibilityQueryKey(spaceId),
        getListMyReviewsQueryKey(),
        ...(slug ? [getGetSpaceBySlugQueryKey(slug)] : []),
        // Prefixo: todas as buscas da vitrine (Explorar e mapa), com qualquer filtro.
        SPACES_SEARCH_QUERY_KEY,
        getListRecentSpacesQueryKey(),
      ];
      return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    [queryClient],
  );
}
