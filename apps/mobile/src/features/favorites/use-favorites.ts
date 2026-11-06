import {
  type FavoriteList,
  getListFavoriteSpacesQueryKey,
  useListFavoriteSpaces,
  useUnfavoriteSpace,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';

export { useListFavoriteSpaces as useFavorites };

/** Remove o favorito já na lista e desfaz se a API recusar (RF-SPACE favoritos). */
export function useRemoveFavorite() {
  const queryClient = useQueryClient();
  const key = getListFavoriteSpacesQueryKey();
  return useUnfavoriteSpace({
    mutation: {
      onMutate: async ({ spaceId }) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<FavoriteList>(key);
        if (previous) {
          queryClient.setQueryData<FavoriteList>(key, {
            items: previous.items.filter((space) => space.id !== spaceId),
          });
        }
        return { previous };
      },
      onError: (_error, _vars, context) => {
        if (context?.previous) queryClient.setQueryData(key, context.previous);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    },
  });
}
