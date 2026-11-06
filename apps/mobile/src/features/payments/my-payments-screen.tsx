import {
  getListMyPaymentsQueryKey,
  listMyPayments,
  type MyPaymentPage,
} from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CreditCard, Info, QrCode, Receipt } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { ErrorView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { ONLINE_CHARGE_STATUS_LABELS } from './labels';
import {
  automaticRefundNote,
  filterStatuses,
  groupByMonth,
  PAYMENT_FILTERS,
  type PaymentRow,
  type PaymentsFilter,
  paymentSubtitle,
  paymentTitle,
} from './my-payments';

const PAGE_SIZE = 20;

export function useMyPayments(filter: PaymentsFilter) {
  const status = filterStatuses(filter);
  const params = status ? { status } : {};
  return useInfiniteQuery({
    queryKey: [...getListMyPaymentsQueryKey(params), 'infinite'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<MyPaymentPage> =>
      listMyPayments(
        { ...params, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Meus pagamentos (RF-ONPAY-06; docs/05, "App — (6)"): as cobranças online do jogador, por mês,
 * com status, filtro e o comprovante no toque. Sem saldo (decisão 81).
 */
export function MyPaymentsScreen() {
  const router = useRouter();
  const name = useThemeName();
  const [filter, setFilter] = useState<PaymentsFilter>('all');
  const query = useMyPayments(filter);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const rows = groupByMonth(items);

  const header = (
    <View className="gap-3 pb-4">
      <View className="flex-row gap-2">
        <Info size={16} color={color(name, 'mutedForeground')} aria-hidden />
        <Text variant="muted" className="flex-1">
          Pagamentos feitos pelo app. O dinheiro vai direto para o espaço: não existe saldo no Space
          Sports.
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2" role="radiogroup" accessibilityLabel="Filtro">
        {PAYMENT_FILTERS.map((item) => (
          <Chip
            key={item.value}
            testID={`meus-pagamentos-filtro-${item.value}`}
            selected={filter === item.value}
            // Tocar de novo no filtro escolhido volta a "Todos".
            onPress={() => setFilter(filter === item.value ? 'all' : item.value)}
          >
            <Text>{item.label}</Text>
          </Chip>
        ))}
      </View>
    </View>
  );

  const empty = query.isPending ? (
    <View className="gap-2" testID="meus-pagamentos-carregando">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </View>
  ) : query.isError ? (
    <ErrorView error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    <View className="items-center gap-2 p-8" testID="meus-pagamentos-vazio">
      <Receipt size={40} color={color(name, 'mutedForeground')} aria-hidden />
      <Text variant="large" className="text-center">
        {filter === 'all' ? 'Nenhum pagamento pelo app ainda' : 'Nada com este filtro'}
      </Text>
      {filter === 'all' ? (
        <Text variant="muted" className="text-center">
          Quando você pagar uma reserva ou mensalidade com Pix ou cartão, ela aparece aqui.
        </Text>
      ) : (
        <Button variant="ghost" onPress={() => setFilter('all')}>
          <Text>Ver todos</Text>
        </Button>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Meus pagamentos" testID="meus-pagamentos-titulo" />
      <FlatList
        testID="meus-pagamentos-lista"
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerClassName="px-4 pb-8 grow"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <PaymentListRow
            row={item}
            onOpen={(id) => router.push({ pathname: '/meus-pagamentos/[id]', params: { id } })}
          />
        )}
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
        ListFooterComponent={
          (query.isFetchingNextPage ? (
            <Text variant="muted" className="py-3 text-center">
              Carregando mais…
            </Text>
          ) : query.isFetchNextPageError ? (
            <Pressable
              onPress={() => void query.fetchNextPage()}
              accessibilityRole="button"
              className="h-11 items-center justify-center"
            >
              <Text className="text-link">Não deu para carregar mais. Tentar de novo</Text>
            </Pressable>
          ) : null) ?? undefined
        }
      />
    </SafeAreaView>
  );
}

function PaymentListRow({ row, onOpen }: { row: PaymentRow; onOpen: (id: string) => void }) {
  const name = useThemeName();
  if (row.kind === 'header') {
    return (
      <Text variant="overline" className="pb-2 pt-4">
        {row.title}
      </Text>
    );
  }
  const { payment } = row;
  const status = ONLINE_CHARGE_STATUS_LABELS[payment.status];
  const title = paymentTitle(payment);
  const subtitle = paymentSubtitle(payment);
  const note = automaticRefundNote(payment);
  const amount = formatCents(payment.amountCents);
  const Icon = payment.method === 'PIX' ? QrCode : CreditCard;
  return (
    <Pressable
      testID={`meus-pagamentos-item-${payment.id}`}
      onPress={() => onOpen(payment.id)}
      accessibilityRole="button"
      accessibilityLabel={[title, amount, status.label, subtitle, note].filter(Boolean).join(', ')}
      className={cn(
        'min-h-16 flex-row items-center gap-3 border-x border-border bg-card px-4 py-3 active:bg-accent',
        row.first ? 'rounded-t-lg border-t' : 'border-t',
        row.last && 'rounded-b-lg border-b',
      )}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Icon size={20} color={color(name, 'mutedForeground')} aria-hidden />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {subtitle}
        </Text>
        {note ? (
          <Text
            variant="muted"
            numberOfLines={2}
            testID={`meus-pagamentos-item-${payment.id}-motivo`}
          >
            {note}
          </Text>
        ) : null}
      </View>
      <View className="items-end gap-1">
        <Text className="font-semibold tabular-nums">{amount}</Text>
        <Badge variant={status.variant}>
          <Text>{status.label}</Text>
        </Badge>
      </View>
    </Pressable>
  );
}
