import type { PlayerBookingDto } from '@space-sports/api-client';
import { BOOKING_PAYMENT_EXPIRED_REASON, formatCents } from '@space-sports/shared';
import { AlarmClock } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { isBookingOrganizer } from '@/features/booking/invites';
import { BOOKING_STATUS_LABELS } from '@/features/booking/labels';
import { formatDeadline, nowWithOffset, responseOffset } from '@/features/payments/countdown';
import { usePayAction } from '@/features/payments/use-pay-action';
import { formatBookingWhen } from '@/lib/datetime';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/**
 * Card da lista "Minhas reservas": o que, onde e quando num toque só. Aguardando pagamento
 * (RF-ONPAY-04): prazo em hora de relógio e "Pagar agora", com alvo próprio; cancelada pelo prazo:
 * "Pagamento não feito no prazo".
 */
export function BookingCard({
  booking,
  userId,
  receivedAt,
  onPress,
}: {
  booking: PlayerBookingDto;
  userId: string;
  /** Quando a página da lista chegou: com o `serverTime` dela, o relógio do servidor. */
  receivedAt?: number;
  onPress: () => void;
}) {
  const clockOffsetMs = responseOffset(booking.serverTime, receivedAt);
  const name = useThemeName();
  const status = BOOKING_STATUS_LABELS[booking.status];
  const when = formatBookingWhen(booking.startsAt, booking.endsAt, booking.space.timeZone);
  const organizer = isBookingOrganizer(booking, userId);
  const pending = booking.status === 'PENDING_PAYMENT' && organizer;
  const payUntil =
    pending && booking.paymentDueAt
      ? formatDeadline(booking.paymentDueAt, booking.space.timeZone, nowWithOffset(clockOffsetMs))
      : null;
  const expired = booking.cancelReason === BOOKING_PAYMENT_EXPIRED_REASON;

  return (
    <Card className="min-h-11 gap-2">
      <Pressable
        testID={`reserva-card-${booking.space.slug}`}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          `${booking.sport.name} em ${booking.space.name}`,
          when,
          status.label,
          payUntil ? `pague até ${payUntil}` : null,
        ]
          .filter(Boolean)
          .join(', ')}
        className="gap-2 active:opacity-80"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-0.5">
            <Text variant="large" numberOfLines={1}>
              {booking.space.name}
            </Text>
            <Text variant="muted" numberOfLines={1}>
              {booking.sport.name} · {booking.court.name}
            </Text>
          </View>
          <Badge variant={status.variant}>
            <Text>{status.label}</Text>
          </Badge>
        </View>
        <View className="flex-row items-end justify-between">
          <Text className="tabular-nums">{when}</Text>
          {organizer ? (
            <Text variant="price">{formatCents(booking.priceCents)}</Text>
          ) : (
            <Text variant="muted">Convidado</Text>
          )}
        </View>
        {payUntil ? (
          <View className="flex-row items-center gap-1.5">
            <AlarmClock size={16} color={color(name, 'warningSubtleForeground')} aria-hidden />
            <Text className="text-sm font-medium text-warning-subtle-foreground tabular-nums">
              Pague até {payUntil}
            </Text>
          </View>
        ) : null}
        {expired ? (
          <Text variant="muted" testID={`reserva-card-${booking.id}-sem-pagamento`}>
            Pagamento não feito no prazo
          </Text>
        ) : null}
      </Pressable>
      {pending ? <PayNowButton booking={booking} clockOffsetMs={clockOffsetMs} /> : null}
    </Card>
  );
}

function PayNowButton({
  booking,
  clockOffsetMs,
}: {
  booking: PlayerBookingDto;
  clockOffsetMs: number | null;
}) {
  const pay = usePayAction({
    payable: { type: 'BOOKING', bookingId: booking.id },
    spaceSlug: booking.space.slug,
    service: 'rental',
    openCharge: booking.openOnlineCharge,
    clockOffsetMs,
  });
  return (
    <View className="border-t border-border pt-3">
      <Button
        testID={`reserva-card-${booking.id}-pagar`}
        size="sm"
        onPress={pay.start}
        accessibilityLabel={`Pagar agora a reserva em ${booking.space.name}`}
      >
        <Text>Pagar agora</Text>
      </Button>
      {pay.sheet}
    </View>
  );
}
