import {
  type SubscriptionsResponseItemsItem,
  useListMySubscriptions,
} from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { formatDate } from '@/lib/datetime';
import { isOpenSubscription, planFrequencyLabel, SUBSCRIPTION_STATUS_LABELS } from './labels';

/** Em aberto primeiro (mais recentes antes); cancelados no fim. */
export function sortSubscriptions<T extends { status: string; createdAt: string }>(
  items: T[],
): T[] {
  const rank = (item: T) => (item.status === 'CANCELLED' ? 1 : 0);
  return [...items].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

function PlanRow({ item }: { item: SubscriptionsResponseItemsItem }) {
  const router = useRouter();
  const status = SUBSCRIPTION_STATUS_LABELS[item.status];
  return (
    <Pressable
      testID={`planos-item-${item.id}`}
      role="link"
      accessibilityLabel={`${item.plan.name}, ${item.space.name}, ${status.label}`}
      className="gap-1 rounded-lg border border-border bg-card p-4 active:bg-accent"
      onPress={() => router.push({ pathname: '/planos/[id]', params: { id: item.id } })}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="large" className="flex-1" numberOfLines={1}>
          {item.plan.name}
        </Text>
        <Badge variant={status.variant}>
          <Text>{status.label}</Text>
        </Badge>
      </View>
      <Text variant="muted">
        {item.space.name} · {planFrequencyLabel(item.plan.weeklyFrequency)}
      </Text>
      {isOpenSubscription(item.status) && item.nextCharge ? (
        <Text variant="muted" className="tabular-nums">
          Próxima mensalidade: {formatCents(item.nextCharge.amountCents)} · vence{' '}
          {formatDate(item.nextCharge.dueDate)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Meus planos: assinaturas de aula e o estado de cada uma (RF-CLASS-04/06). */
export function MyPlansScreen() {
  const query = useListMySubscriptions();
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Meus planos" testID="planos-titulo" />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={sortSubscriptions(query.data?.items ?? [])}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PlanRow item={item} />}
          contentContainerClassName="gap-3 p-4"
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={
            <EmptyView
              title="Você ainda não tem plano de aula"
              description="Na página de um espaço, abra a aba Aulas e escolha um plano."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
