import {
  getGetSpaceBySlugQueryKey,
  getListMyReviewsQueryKey,
  getListRecentSpacesQueryKey,
  getListSpaceReviewsQueryKey,
} from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useInvalidateReviews } from './use-reviews';

describe('useInvalidateReviews', () => {
  it('invalida também a busca do Explorar e do mapa e os recentes (selo dos cards)', async () => {
    const client = new QueryClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = await renderHook(() => useInvalidateReviews(), { wrapper });
    await result.current('space-1', 'arena-sol');
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        getListSpaceReviewsQueryKey('space-1'),
        getListMyReviewsQueryKey(),
        getGetSpaceBySlugQueryKey('arena-sol'),
        ['spaces', 'search'],
        getListRecentSpacesQueryKey(),
      ]),
    );
  });
});
