import { type RecurringBookingDto, useListMyRecurringBookings } from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { RECURRING_STATUS_LABELS } from '@/features/recurring/labels';
import { formatDuration, WEEKDAY_NAMES } from '@/lib/datetime';

function Row({ item }: { item: RecurringBookingDto }) {
  const router = useRouter();
  const status = RECURRING_STATUS_LABELS[item.status];
  return (
    <Pressable
      role="link"
      accessibilityLabel={`${item.space.name}, ${WEEKDAY_NAMES[item.weekday]} às ${item.startTime}, ${status.label}`}
      className="gap-1 rounded-lg border border-border bg-card p-4 active:bg-accent"
      onPress={() => router.push({ pathname: '/mensalistas/[id]', params: { id: item.id } })}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="large" className="flex-1" numberOfLines={1}>
          {item.space.name}
        </Text>
        <Badge variant={status.variant}>
          <Text>{status.label}</Text>
        </Badge>
      </View>
      <Text>
        {WEEKDAY_NAMES[item.weekday]}, {item.startTime.slice(0, 5)} ·{' '}
        {formatDuration(item.durationMin)}
      </Text>
      <Text variant="muted">
        {item.court.name} · {item.sport.name}
      </Text>
    </Pressable>
  );
}

/** Meus mensalistas: acompanhar o status das solicitações (RF-BOOK-05). */
export default function MensalistasScreen() {
  const query = useListMyRecurringBookings();
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Meus mensalistas" />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <Row item={item} />}
          contentContainerClassName="gap-3 p-4"
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={
            <EmptyView
              title="Você ainda não tem horário fixo"
              description="Na página de um espaço, toque em “Quero ser mensalista”."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
