import {
  getGetMyRecurringBookingQueryKey,
  useEndMyRecurringBooking,
  useGetMyRecurringBooking,
} from '@space-sports/api-client';
import { utcToZoned } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { canEndRecurring, RECURRING_STATUS_LABELS } from '@/features/recurring/labels';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { formatDayShort, formatDuration, WEEKDAY_NAMES } from '@/lib/datetime';

/** Status, motivo e encerramento do mensalista (RF-BOOK-05, RN-BOOK-08). */
export default function MensalistaDetalheScreen() {
  const { id, nova } = useLocalSearchParams<{ id: string; nova?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useGetMyRecurringBooking(id);
  const [notice, setNotice] = useState<string | null>(null);
  const item = query.data;

  const end = useEndMyRecurringBooking({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['/v1/recurring-bookings'] });
        void queryClient.invalidateQueries({ queryKey: getGetMyRecurringBookingQueryKey(id) });
      },
      onError: (error) => setNotice(errorMessage(error)),
    },
  });

  const confirmEnd = (pending: boolean) =>
    Alert.alert(
      pending ? 'Retirar solicitação?' : 'Encerrar mensalista?',
      pending
        ? 'O espaço deixa de analisar este pedido.'
        : 'As reservas futuras serão canceladas e a quadra volta a ficar livre.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: pending ? 'Retirar' : 'Encerrar',
          style: 'destructive',
          onPress: () => {
            setNotice(null);
            end.mutate({ recurringBookingId: id, data: {} });
          },
        },
      ],
    );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader
        title="Mensalista"
        right={
          <Button variant="ghost" size="sm" onPress={() => router.push('/mensalistas')}>
            <Text>Todos</Text>
          </Button>
        }
      />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError || !item ? (
        isNotFound(query.error) ? (
          <EmptyView title="Mensalista não encontrado" />
        ) : (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : (
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
          {nova === '1' ? (
            <Card>
              <Text variant="large">Solicitação enviada!</Text>
              <Text variant="muted">
                Acompanhe a resposta do espaço por aqui e pelas notificações.
              </Text>
            </Card>
          ) : null}
          <Card>
            <View className="flex-row items-center justify-between gap-2">
              <Text variant="large" className="flex-1" numberOfLines={2}>
                {item.space.name}
              </Text>
              <Badge variant={RECURRING_STATUS_LABELS[item.status].variant}>
                <Text>{RECURRING_STATUS_LABELS[item.status].label}</Text>
              </Badge>
            </View>
            <Text>
              Toda {WEEKDAY_NAMES[item.weekday]?.toLowerCase()}, às {item.startTime.slice(0, 5)} (
              {formatDuration(item.durationMin)})
            </Text>
            <Text variant="muted">
              {item.court.name} · {item.sport.name} · {item.peopleCount}{' '}
              {item.peopleCount === 1 ? 'pessoa' : 'pessoas'}
            </Text>
            <Text variant="muted">{RECURRING_STATUS_LABELS[item.status].hint}</Text>
            {item.statusReason ? <Text>Motivo: {item.statusReason}</Text> : null}
          </Card>

          {item.conflicts.length > 0 ? (
            <Card>
              <Text variant="large">Atenção ao calendário</Text>
              <Text variant="muted">
                Alguns dias não puderam ser reservados; o espaço entrará em contato.
              </Text>
              {item.conflicts.map((c) => (
                <Text key={c.id}>
                  {formatDayShort(utcToZoned(new Date(c.startsAt), item.space.timeZone).date)}
                </Text>
              ))}
            </Card>
          ) : null}

          {canEndRecurring(item.status) ? (
            <View className="gap-2">
              <InlineError message={notice} />
              <Button
                variant="destructive"
                disabled={end.isPending}
                onPress={() => confirmEnd(item.status === 'PENDING_APPROVAL')}
              >
                <Text>
                  {end.isPending
                    ? 'Enviando…'
                    : item.status === 'PENDING_APPROVAL'
                      ? 'Retirar solicitação'
                      : 'Encerrar mensalista'}
                </Text>
              </Button>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
