import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalida todas as consultas do espaço (`/v1/manage/spaces/:id/...`). As chaves geradas começam
 * pelo caminho da rota, então não dá para usar um prefixo de array.
 */
export function invalidateSpace(queryClient: QueryClient, spaceId: string) {
  const prefix = `/v1/manage/spaces/${spaceId}`;
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === 'string' && head.startsWith(prefix);
    },
  });
}
