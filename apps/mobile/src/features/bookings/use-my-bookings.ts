import {
  getListMyBookingsQueryKey,
  listMyBookings,
  type PlayerBookingPage,
} from '@space-sports/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';

export type BookingsWhen = 'upcoming' | 'past';

const PAGE_SIZE = 20;

/** Minhas reservas (RF-BOOK-03) paginadas por cursor: próximas (crescente) ou passadas (decrescente). */
export function useMyBookings(when: BookingsWhen) {
  return useInfiniteQuery({
    queryKey: [...getListMyBookingsQueryKey({ when }), 'infinite'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<PlayerBookingPage> =>
      listMyBookings(
        { when, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
