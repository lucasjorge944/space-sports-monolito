import {
  type BookingSource,
  type SpaceBookingDetailDto,
  type StaffSpacesResponseItemsItem,
  useGetSpaceBooking,
} from '@space-sports/api-client';
import { canInSpace, formatCents } from '@space-sports/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { ErrorView, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  BOOKING_STATUS_LABELS,
  INVITE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/features/booking/labels';
import { PAYMENT_METHOD_LABELS } from '@/features/space/labels';
import { formatTime } from '@/lib/datetime';
import { DetailRow, ReadOnlyNote, StaffCard } from './staff-card';

type TodayBooking = StaffSpacesResponseItemsItem['today']['bookings'][number];

const SOURCE_LABELS: Record<BookingSource, string> = {
  APP: 'Pelo app',
  DESK: 'Balcão',
  RECURRING: 'Mensalista',
};

const peopleLabel = (count: number) => `${count} ${count === 1 ? 'pessoa' : 'pessoas'}`;

function Participants({ booking }: { booking: SpaceBookingDetailDto }) {
  const guests = booking.participants.filter((participant) => !participant.isOrganizer);
  return (
    <View className="gap-1" testID="equipe-reserva-participantes">
      <Text variant="small" role="heading">
        Participantes ({guests.length})
      </Text>
      {guests.length === 0 ? (
        <Text variant="muted">Ninguém convidado pelo app.</Text>
      ) : (
        guests.map((participant) => (
          <View key={participant.id} className="flex-row items-center justify-between gap-3 py-1">
            <Text className="flex-1" numberOfLines={1}>
              {participant.name ?? 'Sem nome'}
            </Text>
            <Badge variant={INVITE_STATUS_LABELS[participant.status].variant}>
              <Text>{INVITE_STATUS_LABELS[participant.status].label}</Text>
            </Badge>
          </View>
        ))
      )}
    </View>
  );
}

/** Recebimento da reserva inteira (decisão 50). Sem `payment.record`, a API manda nulo (decisão 53). */
function Payment({ booking }: { booking: SpaceBookingDetailDto }) {
  const { paymentStatus, priceCents, paidCents } = booking;
  if (paymentStatus === null || priceCents === null || paidCents === null) return null;
  const status = PAYMENT_STATUS_LABELS[paymentStatus];
  return (
    <View className="gap-1" testID="equipe-reserva-pagamento">
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="small" role="heading">
          Pagamento
        </Text>
        <Badge variant={status.variant}>
          <Text>{status.label}</Text>
        </Badge>
      </View>
      <DetailRow label="Total" value={formatCents(priceCents)} />
      <DetailRow label="Recebido" value={formatCents(paidCents)} />
      {booking.intendedPaymentMethod ? (
        <DetailRow
          label="Vai pagar com"
          value={PAYMENT_METHOD_LABELS[booking.intendedPaymentMethod]}
        />
      ) : null}
    </View>
  );
}

function BookingDetails({
  spaceId,
  booking,
  showPayment,
}: {
  spaceId: string;
  booking: TodayBooking;
  showPayment: boolean;
}) {
  const query = useGetSpaceBooking(spaceId, booking.id);
  if (query.isPending) return <LoadingView label="Carregando a reserva…" />;
  if (query.isError) {
    return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
  }
  return (
    <>
      <Participants booking={query.data} />
      {showPayment ? <Payment booking={query.data} /> : null}
      {query.data.cancelReason ? (
        <DetailRow label="Motivo do cancelamento" value={query.data.cancelReason} />
      ) : null}
    </>
  );
}

function BookingSheet({
  spaceId,
  booking,
  timeZone,
  showPayment,
  onClose,
}: {
  spaceId: string;
  booking: TodayBooking | null;
  timeZone: string;
  showPayment: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={booking !== null}
      title={booking?.customerName ?? 'Reserva'}
      onClose={onClose}
    >
      {booking ? (
        <>
          <Badge variant={BOOKING_STATUS_LABELS[booking.status].variant}>
            <Text>{BOOKING_STATUS_LABELS[booking.status].label}</Text>
          </Badge>
          <View className="gap-1">
            <DetailRow label="Cliente" value={booking.customerName ?? 'Não informado'} />
            <DetailRow
              label="Horário"
              value={`${formatTime(booking.startsAt, timeZone)} – ${formatTime(booking.endsAt, timeZone)}`}
            />
            <DetailRow label="Quadra" value={booking.court.name} />
            <DetailRow label="Esporte" value={booking.sportName} />
            <DetailRow label="Pessoas" value={peopleLabel(booking.peopleCount)} />
            <DetailRow label="Origem" value={SOURCE_LABELS[booking.source]} />
          </View>
          <BookingDetails spaceId={spaceId} booking={booking} showPayment={showPayment} />
          <ReadOnlyNote />
        </>
      ) : null}
    </BottomSheet>
  );
}

/**
 * Reservas de hoje, somente leitura (RN-AUTH-04): o detalhe vem de `getSpaceBooking`, que todo o
 * time pode ler. Pagamento só para quem o registra no painel: o Professor não lida com valores.
 */
export function StaffBookingsCard({ item }: { item: StaffSpacesResponseItemsItem }) {
  const bookings = item.today.bookings;
  const zone = item.space.timeZone;
  const [openId, setOpenId] = useState<string | null>(null);
  // Pelo id: a lista pode mudar por trás da folha.
  const open = bookings.find((booking) => booking.id === openId) ?? null;
  return (
    <Card testID="equipe-reservas">
      <Text variant="large">Reservas de hoje</Text>
      {bookings.length === 0 ? (
        <Text variant="muted">Nenhuma reserva para hoje.</Text>
      ) : (
        <View className="gap-2">
          {bookings.map((booking) => {
            const status = BOOKING_STATUS_LABELS[booking.status];
            const people = peopleLabel(booking.peopleCount);
            const customer = booking.customerName ?? 'Cliente';
            return (
              <StaffCard
                key={booking.id}
                testID={`equipe-reserva-${booking.id}`}
                accessibilityLabel={`${customer}, ${formatTime(booking.startsAt, zone)}, ${booking.court.name}, ${status.label}, ${people}`}
                startTime={formatTime(booking.startsAt, zone)}
                endTime={formatTime(booking.endsAt, zone)}
                title={customer}
                lines={[`${booking.court.name} · ${booking.sportName}`]}
                occupancy={people}
                status={status}
                onPress={() => setOpenId(booking.id)}
              />
            );
          })}
        </View>
      )}
      <BookingSheet
        spaceId={item.space.id}
        booking={open}
        timeZone={zone}
        showPayment={canInSpace(item.roles, 'payment.record')}
        onClose={() => setOpenId(null)}
      />
    </Card>
  );
}
