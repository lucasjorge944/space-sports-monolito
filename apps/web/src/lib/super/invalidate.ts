import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalida tudo o que vem de `/v1/super` (listas, detalhes, financeiro). As chaves geradas começam
 * pelo caminho (`/v1/super/spaces/<id>`), então o prefixo precisa ser comparado como texto.
 */
export function invalidateSuper(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      typeof queryKey[0] === 'string' && queryKey[0].startsWith('/v1/super'),
  });
}
