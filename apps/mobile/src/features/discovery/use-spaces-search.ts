import { type SearchSpacesParams, searchSpaces } from '@space-sports/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/** Prefixo das buscas da vitrine (Explorar e mapa), para invalidar todas de uma vez. */
export const SPACES_SEARCH_QUERY_KEY = ['spaces', 'search'] as const;

/** Vitrine paginada por cursor (GET /v1/spaces); `items` já vem achatado. */
export function useSpacesSearch(params: SearchSpacesParams) {
  const query = useInfiniteQuery({
    queryKey: [...SPACES_SEARCH_QUERY_KEY, params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      searchSpaces({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Cursor inválido/expirado não melhora repetindo: o retry padrão já ignora 4xx.
    staleTime: 60_000,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return { ...query, items };
}
