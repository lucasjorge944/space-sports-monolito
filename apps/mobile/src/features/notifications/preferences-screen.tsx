import {
  getGetNotificationPreferencesQueryKey,
  type MeResponse,
  type NotificationPreferences,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@space-sports/api-client';
import { canInSpace } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { ErrorView, LoadingView } from '@/components/state-views';
import { Text } from '@/components/ui/text';
import { useMe } from '@/features/auth/session';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { PREFERENCE_LABELS } from './labels';

/** O polegar do Switch é branco nos dois temas (não depende do tema, ao contrário da trilha). */
const THUMB_COLOR = color('light', 'card');

type Item = NotificationPreferences['items'][number];
type Channel = 'push' | 'inApp';

/** Aplica a mudança de um canal no cache (otimista). */
export function withChannel(
  data: NotificationPreferences,
  type: Item['type'],
  channel: Channel,
  value: boolean,
): NotificationPreferences {
  return {
    items: data.items.map((item) => (item.type === type ? { ...item, [channel]: value } : item)),
  };
}

/** Avisos do pagamento online que só vão para a gestão (Dono e Admin; RN-ONPAY-08). */
const ONLINE_PAYMENTS_STAFF_TYPES = new Set<Item['type']>([
  'PAYMENT_CHARGEBACK',
  'MERCHANT_ACCOUNT_APPROVED',
  'MERCHANT_ACCOUNT_REJECTED',
  'MERCHANT_PAYOUT_ACCOUNT_CHANGED',
  'MERCHANT_PAYOUT_CHANGE_REJECTED',
  'PAYOUT_FAILED',
]);

/**
 * `SPACE_BOOKING_UPDATED` só vai para quem cuida das reservas de um espaço (RN-BOOK-13); os avisos
 * do pagamento online da gestão e a avaliação nova do espaço (`REVIEW_CREATED`, RF-REVIEW-09),
 * para Dono e Admin.
 */
export function visiblePreferences(items: Item[], memberships: MeResponse['memberships']): Item[] {
  const managesBookings = memberships.some((m) => canInSpace(m.roles, 'booking.create'));
  const managesPayments = memberships.some((m) => canInSpace(m.roles, 'payments.online.manage'));
  const answersReviews = memberships.some((m) => canInSpace(m.roles, 'review.reply'));
  return items.filter((item) => {
    if (item.type === 'SPACE_BOOKING_UPDATED') return managesBookings;
    if (ONLINE_PAYMENTS_STAFF_TYPES.has(item.type)) return managesPayments;
    if (item.type === 'REVIEW_CREATED') return answersReviews;
    return true;
  });
}

function ChannelSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const name = useThemeName();
  return (
    <View className="min-h-11 flex-row items-center justify-between">
      <Text className="text-sm">{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: color(name, 'input'), true: color(name, 'primary') }}
        thumbColor={THUMB_COLOR}
      />
    </View>
  );
}

/** Preferências por tipo de notificação, com push e central separados (RF-NOTIF-04). */
export function NotificationPreferencesScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  const key = getGetNotificationPreferencesQueryKey();
  const query = useGetNotificationPreferences();
  const update = useUpdateNotificationPreferences({
    mutation: {
      onMutate: async ({ data }) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData<NotificationPreferences>(key);
        if (previous) {
          let next = previous;
          for (const change of data.items) {
            if (change.push !== undefined)
              next = withChannel(next, change.type, 'push', change.push);
            if (change.inApp !== undefined)
              next = withChannel(next, change.type, 'inApp', change.inApp);
          }
          queryClient.setQueryData(key, next);
        }
        return { previous };
      },
      onError: (_error, _vars, context) => {
        if (context?.previous) queryClient.setQueryData(key, context.previous);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    },
  });

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Preferências de notificação" />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerClassName="gap-3 p-4 pb-10">
          <Text variant="muted">
            Escolha o que chega como aviso no celular (push) e o que aparece na central do app.
          </Text>
          {visiblePreferences(query.data.items, me.memberships).map((item) => {
            const text = PREFERENCE_LABELS[item.type];
            // App antigo com API nova: tipo sem rótulo fica de fora em vez de derrubar a tela.
            if (!text) return null;
            return (
              <View key={item.type} className="gap-1 rounded-lg border border-border bg-card p-4">
                <Text className="font-medium">{text.title}</Text>
                <Text variant="muted">{text.description}</Text>
                <ChannelSwitch
                  label={`${text.title}: aviso no celular`}
                  value={item.push}
                  onChange={(value) =>
                    update.mutate({ data: { items: [{ type: item.type, push: value }] } })
                  }
                />
                <ChannelSwitch
                  label={`${text.title}: central do app`}
                  value={item.inApp}
                  onChange={(value) =>
                    update.mutate({ data: { items: [{ type: item.type, inApp: value }] } })
                  }
                />
              </View>
            );
          })}
          {update.isError ? (
            <Text className="text-sm text-destructive" role="alert">
              Não foi possível salvar a preferência. Tente de novo.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
