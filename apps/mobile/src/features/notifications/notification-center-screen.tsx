import type { Notification } from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatDateTime } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { pushTarget } from './push-route';
import { useMarkAllRead, useMarkRead, useNotificationList } from './use-notifications';

function NotificationRow({ item, onPress }: { item: Notification; onPress: () => void }) {
  const unread = item.readAt === null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Não lida. ' : ''}${item.title}. ${item.body}`}
      className={cn(
        'min-h-11 flex-row gap-3 rounded-lg border border-border p-4 active:bg-accent',
        unread ? 'bg-card' : 'bg-background',
      )}
    >
      <View
        className={cn('mt-1.5 h-2.5 w-2.5 rounded-full', unread ? 'bg-primary' : 'bg-transparent')}
      />
      <View className="flex-1 gap-1">
        <Text className={cn(unread && 'font-semibold')}>{item.title}</Text>
        <Text variant="muted">{item.body}</Text>
        <Text variant="muted" className="text-xs tabular-nums">
          {formatDateTime(item.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Central de notificações: lista com lida/não lida (RF-NOTIF-04). */
export function NotificationCenterScreen() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useNotificationList(unreadOnly);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const unreadCount = query.data?.pages[0]?.unreadCount ?? 0;

  const open = (item: Notification) => {
    if (!item.readAt) markRead.mutate({ notificationId: item.id });
    const target = pushTarget(item.data);
    if (target) router.push(target);
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Notificações" />
      <View className="flex-row items-center justify-between gap-2 px-4 pt-2">
        <Pressable
          onPress={() => setUnreadOnly((value) => !value)}
          role="switch"
          accessibilityState={{ checked: unreadOnly }}
          accessibilityLabel="Mostrar só as não lidas"
          className={cn(
            'h-11 justify-center rounded-full border px-4',
            unreadOnly ? 'border-primary bg-accent' : 'border-border',
          )}
        >
          <Text className="text-sm font-medium">
            Não lidas{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </Text>
        </Pressable>
        <Button
          variant="ghost"
          onPress={() => markAll.mutate()}
          disabled={unreadCount === 0 || markAll.isPending}
        >
          <Text>Marcar todas como lidas</Text>
        </Button>
      </View>

      {query.isPending ? (
        <LoadingView label="Carregando notificações…" />
      ) : query.isError && items.length === 0 ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerClassName="grow gap-2 p-4"
          renderItem={({ item }) => <NotificationRow item={item} onPress={() => open(item)} />}
          ListEmptyComponent={
            <EmptyView
              title={unreadOnly ? 'Tudo lido' : 'Sem notificações'}
              description={
                unreadOnly
                  ? 'Você não tem notificações não lidas.'
                  : 'Avisos de reservas e convites aparecem aqui.'
              }
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => void query.refetch()}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
