import {
  getListNotificationsQueryKey,
  listNotifications,
  type NotificationPage,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@space-sports/api-client';
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';

const PAGE_SIZE = 20;

type Pages = InfiniteData<NotificationPage, string | undefined>;

/** Central de notificações (RF-NOTIF-04), paginada por cursor; `unreadOnly` filtra no servidor. */
export function useNotificationList(unreadOnly: boolean) {
  return useInfiniteQuery({
    queryKey: [
      ...getListNotificationsQueryKey(unreadOnly ? { unread: 'true' } : undefined),
      'infinite',
    ] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listNotifications(
        {
          limit: PAGE_SIZE,
          ...(unreadOnly ? { unread: 'true' } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

const unreadCountKey = () => getListNotificationsQueryKey({ limit: 1 });

/** Total de não lidas para o sino do cabeçalho (a API devolve em qualquer página). */
export function useUnreadCount(): number {
  const query = useQuery({
    queryKey: unreadCountKey(),
    queryFn: ({ signal }) => listNotifications({ limit: 1 }, { signal }),
    staleTime: 30_000,
  });
  return query.data?.unreadCount ?? 0;
}

/** Relê o total de não lidas. */
export function useRefreshUnreadCount() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: unreadCountKey() }),
    [queryClient],
  );
}

/** Aplica `readAt` nas páginas em cache e ajusta o contador, sem esperar a rede. */
export function markReadInPages(
  data: Pages | undefined,
  ids: ReadonlySet<string> | 'all',
  readAt: string,
): Pages | undefined {
  // O prefixo da chave também pega o contador (uma página só, sem `pages`).
  if (!data || !Array.isArray(data.pages)) return data;
  let changed = 0;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      if (item.readAt || (ids !== 'all' && !ids.has(item.id))) return item;
      changed += 1;
      return { ...item, readAt };
    }),
  }));
  return {
    ...data,
    pages: pages.map((page) => ({
      ...page,
      unreadCount: Math.max(0, page.unreadCount - changed),
    })),
  };
}

function useRefreshNotifications() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  const refresh = useRefreshNotifications();
  return useMarkNotificationRead({
    mutation: {
      onMutate: ({ notificationId }) => {
        const readAt = new Date().toISOString();
        queryClient.setQueriesData<Pages>({ queryKey: getListNotificationsQueryKey() }, (data) =>
          markReadInPages(data, new Set([notificationId]), readAt),
        );
      },
      onSettled: refresh,
    },
  });
}

export function useMarkAllRead() {
  const refresh = useRefreshNotifications();
  return useMarkAllNotificationsRead({ mutation: { onSettled: refresh } });
}
