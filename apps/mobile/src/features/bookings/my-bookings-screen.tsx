import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Screen } from '@/components/screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Text } from '@/components/ui/text';
import { useMe } from '@/features/auth/session';
import { MyClassesSection } from '@/features/classes/my-classes-section';
import { cn } from '@/lib/utils';
import { BookingCard } from './booking-card';
import { type BookingsWhen, useMyBookings } from './use-my-bookings';

const TABS: { value: BookingsWhen; label: string }[] = [
  { value: 'upcoming', label: 'Próximas' },
  { value: 'past', label: 'Passadas' },
];

const EMPTY: Record<BookingsWhen, { title: string; description: string }> = {
  upcoming: {
    title: 'Nenhuma reserva por vir',
    description: 'Escolha um espaço na aba Explorar e reserve sua quadra.',
  },
  past: {
    title: 'Nada por aqui ainda',
    description: 'Suas reservas concluídas e canceladas aparecem aqui.',
  },
};

type AgendaSection = 'bookings' | 'classes';

const SECTIONS: { value: AgendaSection; label: string }[] = [
  { value: 'bookings', label: 'Reservas' },
  { value: 'classes', label: 'Aulas' },
];

/** Aba Agenda: Minhas reservas (RF-BOOK-03) e Minhas aulas (RF-CLASS-08). */
export function MyBookingsScreen() {
  const [section, setSection] = useState<AgendaSection>('bookings');
  return (
    <Screen>
      <View className="flex-row gap-2" accessibilityRole="tablist">
        {SECTIONS.map((item) => {
          const selected = item.value === section;
          return (
            <Pressable
              key={item.value}
              testID={`agenda-secao-${item.value}`}
              onPress={() => setSection(item.value)}
              role="tab"
              accessibilityState={{ selected }}
              className={cn(
                'h-11 flex-1 items-center justify-center rounded-full border',
                selected ? 'border-primary bg-primary' : 'border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'text-sm font-medium',
                  selected ? 'text-primary-foreground' : 'text-foreground',
                )}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {section === 'bookings' ? <BookingsSection /> : <MyClassesSection />}
    </Screen>
  );
}

/** Minhas reservas (RF-BOOK-03). */
function BookingsSection() {
  const router = useRouter();
  const me = useMe();
  const [when, setWhen] = useState<BookingsWhen>('upcoming');
  const query = useMyBookings(when);
  const all = query.data?.pages.flatMap((page) => page.items) ?? [];
  // RF-ONPAY-04: as que aguardam pagamento ficam numa seção própria no topo das próximas.
  const awaiting =
    when === 'upcoming'
      ? all.filter((b) => b.status === 'PENDING_PAYMENT' && b.organizer.userId === me.id)
      : [];
  const items = awaiting.length > 0 ? all.filter((b) => !awaiting.includes(b)) : all;
  const { refetch } = query;
  // A aba fica montada, e a reserva pode entrar por fora do app: e-mail verificado ou vínculo
  // confirmado pelo organizador (RF-CONTACT-04/05).
  useFocusEffect(
    useCallback(() => {
      void refetch({ cancelRefetch: false });
    }, [refetch]),
  );

  return (
    <>
      <View className="flex-row gap-1 rounded-lg bg-muted p-1" accessibilityRole="tablist">
        {TABS.map((tab) => {
          const selected = tab.value === when;
          return (
            <Pressable
              key={tab.value}
              testID={`agenda-aba-${tab.value}`}
              onPress={() => setWhen(tab.value)}
              role="tab"
              accessibilityState={{ selected }}
              className={cn(
                'h-11 flex-1 items-center justify-center rounded-md',
                selected && 'bg-background',
              )}
            >
              <Text className={cn('text-sm font-medium', !selected && 'text-muted-foreground')}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {query.isPending ? (
        <LoadingView label="Carregando reservas…" />
      ) : query.isError && items.length === 0 ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(booking) => booking.id}
          contentContainerClassName="gap-3 pb-6 grow"
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              userId={me.id}
              receivedAt={query.dataUpdatedAt}
              onPress={() => router.push({ pathname: '/reserva/[id]', params: { id: item.id } })}
            />
          )}
          ListHeaderComponent={
            awaiting.length > 0 ? (
              <View className="gap-3 pb-3" testID="agenda-aguardando-pagamento">
                <Text variant="overline">Aguardando pagamento</Text>
                {awaiting.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    userId={me.id}
                    receivedAt={query.dataUpdatedAt}
                    onPress={() =>
                      router.push({ pathname: '/reserva/[id]', params: { id: booking.id } })
                    }
                  />
                ))}
                {items.length > 0 ? <Text variant="overline">Próximas</Text> : null}
              </View>
            ) : undefined
          }
          ListEmptyComponent={awaiting.length > 0 ? undefined : <EmptyView {...EMPTY[when]} />}
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
      )}
    </>
  );
}
