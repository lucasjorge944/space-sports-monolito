import {
  getGetMyBookingQueryKey,
  useCancelMyBooking,
  useGetMyBooking,
  useGetSpaceBySlug,
} from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useMe } from '@/features/auth/session';
import { canCancelNow } from '@/features/booking/cancel';
import { editBlockNotice, shouldTalkToSpace } from '@/features/booking/edit';
import { EditBookingSheet } from '@/features/booking/edit-booking-sheet';
import { InviteSection } from '@/features/booking/invite-section';
import { isBookingOrganizer } from '@/features/booking/invites';
import { BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/features/booking/labels';
import { TalkToSpace } from '@/features/booking/talk-to-space';
import { BookingActions } from '@/features/bookings/booking-actions';
import {
  cancelledText,
  cancelRefundSentence,
  OnlinePaymentLines,
  onlineSituation,
  PayOnlineOption,
  PendingPaymentCard,
} from '@/features/payments/booking-payment';
import { formatDeadline, nowWithOffset, responseOffset } from '@/features/payments/countdown';
import { bookingOnlineOptions } from '@/features/payments/options';
import { paymentHref } from '@/features/payments/payable';
import { hasOpenPix, usePayAction } from '@/features/payments/use-pay-action';
import { endedWithinReviewWindow, ReviewPromptCard } from '@/features/reviews/review-prompt-card';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { formatBookingWhen, formatDuration } from '@/lib/datetime';

/**
 * Detalhe da reserva: dados, minha parte, dividir a conta, editar (RN-BOOK-10 a 13) e cancelamento
 * dentro do prazo (RN-BOOK-05). Com pagamento online (RF-ONPAY-03/04): "Falta pagar para
 * confirmar" com o prazo e "Desistir da reserva" na reserva aguardando pagamento, o pagamento
 * online no bloco "Pagamento" e "Pagar online" no modo opcional. `pagar` (vindo do formulário de
 * reservar) abre a tela de pagamento por cima, para o voltar dela cair aqui.
 */
export default function ReservaScreen() {
  const { id, nova, pagar, cobranca, falha } = useLocalSearchParams<{
    id: string;
    nova?: string;
    pagar?: string;
    cobranca?: string;
    falha?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useGetMyBooking(id);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const booking = query.data;
  const isOrganizer = booking ? isBookingOrganizer(booking, me.id) : false;
  // Relógio da própria reserva (`serverTime`): prazo, Pix aberto e "já começou".
  const clockOffsetMs = responseOffset(booking?.serverTime, query.dataUpdatedAt);
  const now = nowWithOffset(clockOffsetMs);
  const canEdit = booking ? booking.canEditPeople || booking.canEditSchedule : false;
  const editBlock = booking ? editBlockNotice(booking) : null;
  // Limites do espaço para o sheet, WhatsApp do "fale com o espaço" e os meios online.
  const space = useGetSpaceBySlug(booking?.space.slug ?? '', {
    query: { enabled: Boolean(canEdit || editBlock || isOrganizer), staleTime: 60_000 },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetMyBookingQueryKey(id) });
  }, [queryClient, id]);

  const payable = { type: 'BOOKING', bookingId: id } as const;
  const pay = usePayAction({
    payable,
    spaceSlug: booking?.space.slug ?? '',
    service: 'rental',
    openCharge: booking?.openOnlineCharge,
    enabled: isOrganizer,
    clockOffsetMs,
  });

  // Vindo do "Pagar com Pix/cartão" do formulário: abre o pagamento uma vez.
  const openedPayment = useRef(false);
  useEffect(() => {
    if (!pagar || openedPayment.current) return;
    openedPayment.current = true;
    router.setParams({ pagar: undefined, cobranca: undefined, falha: undefined });
    router.push(
      paymentHref(payable, {
        forma: pagar === 'cartao' ? 'cartao' : 'pix',
        ...(cobranca ? { cobranca } : {}),
        ...(falha === '1' ? { falha: '1' as const } : {}),
      }),
    );
  }, [pagar, cobranca, falha, router, payable]);
  const cancel = useCancelMyBooking({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
        refresh();
      },
      onError: (error) => {
        setNotice(errorMessage(error));
        refresh();
      },
    },
  });

  const pendingPayment = booking?.status === 'PENDING_PAYMENT';
  // Pagar online no modo opcional: organizador, reserva confirmada, ainda não começou e em aberto.
  const onlineAvailable = bookingOnlineOptions(space.data).length > 0;
  const canPayOnline = Boolean(
    booking &&
      isOrganizer &&
      booking.status === 'CONFIRMED' &&
      onlineAvailable &&
      booking.paymentStatus !== 'PAID' &&
      // Reserva de balcão e ocorrência de mensalista seguem pagas no local (docs/13 §4).
      booking.source === 'APP' &&
      new Date(booking.startsAt).getTime() > now &&
      booking.onlinePayment?.status !== 'PAID',
  );
  // O pagamento é da reserva inteira (decisão 50): sem registro, o jogador paga no espaço.
  const payment =
    onlineSituation(booking?.onlinePayment) ??
    (pendingPayment
      ? ({ label: 'Aguardando pagamento', variant: 'warning' } as const)
      : !booking?.paymentStatus || booking.paymentStatus === 'PENDING'
        ? canPayOnline
          ? ({ label: 'Pagamento pendente', variant: 'warning' } as const)
          : ({ label: 'Pagar no espaço', variant: 'warning' } as const)
        : PAYMENT_STATUS_LABELS[booking.paymentStatus]);
  const refundSentence = cancelRefundSentence(booking?.onlinePayment);
  const confirmAbandon = () =>
    Alert.alert(
      'Desistir da reserva?',
      'O horário é liberado e o código Pix deixa de valer. Se você já pagou, o valor volta sozinho.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Desistir',
          style: 'destructive',
          onPress: () => {
            setNotice(null);
            cancel.mutate({ bookingId: id, data: {} });
          },
        },
      ],
    );
  const confirmCancel = () =>
    Alert.alert(
      'Cancelar reserva?',
      ['O horário volta a ficar livre para outras pessoas.', refundSentence]
        .filter(Boolean)
        .join(' '),
      [
        { text: 'Manter', style: 'cancel' },
        {
          text: 'Cancelar reserva',
          style: 'destructive',
          onPress: () => {
            setNotice(null);
            cancel.mutate({ bookingId: id, data: {} });
          },
        },
      ],
    );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Reserva" testID="reserva-titulo" />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError || !booking ? (
        isNotFound(query.error) ? (
          <EmptyView title="Reserva não encontrada" />
        ) : (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerClassName="gap-4 p-4 pb-10"
            keyboardShouldPersistTaps="handled"
          >
            {pendingPayment && isOrganizer ? (
              <PendingPaymentCard
                booking={booking}
                clockOffsetMs={clockOffsetMs}
                onPay={pay.start}
                onExpired={refresh}
              />
            ) : null}
            {nova === '1' && booking.status === 'CONFIRMED' ? (
              <Card testID="reserva-confirmada" className="border-success bg-card">
                <Text variant="large">Reserva confirmada!</Text>
                <Text variant="muted">
                  {booking.paymentStatus === 'PAID'
                    ? 'Pagamento feito pelo app. Convide quem vai jogar abaixo.'
                    : canPayOnline
                      ? 'Pague pelo app ou no espaço no dia do jogo. Convide quem vai jogar abaixo.'
                      : 'Pague no espaço no dia do jogo. Convide quem vai jogar abaixo.'}
                </Text>
              </Card>
            ) : null}
            <Card>
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="large" className="flex-1" numberOfLines={2}>
                  {booking.space.name}
                </Text>
                <Badge variant={BOOKING_STATUS_LABELS[booking.status].variant}>
                  <Text>{BOOKING_STATUS_LABELS[booking.status].label}</Text>
                </Badge>
              </View>
              <Text>
                {formatBookingWhen(booking.startsAt, booking.endsAt, booking.space.timeZone)}
              </Text>
              <Text variant="muted">
                {booking.court.name} · {booking.sport.name} · {formatDuration(booking.durationMin)}{' '}
                · {booking.peopleCount} {booking.peopleCount === 1 ? 'pessoa' : 'pessoas'}
              </Text>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onPress={() =>
                  router.push({ pathname: '/espaco/[slug]', params: { slug: booking.space.slug } })
                }
              >
                <Text>Ver o espaço</Text>
              </Button>
            </Card>

            {/* Avalie sua experiência (RF-REVIEW-02): reserva que deu certo e terminou há até 6 meses. */}
            {(booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') &&
            endedWithinReviewWindow(booking.endsAt) ? (
              <ReviewPromptCard space={booking.space} kind="booking" testID="reserva-avaliacao" />
            ) : null}

            {pendingPayment ? null : canEdit ? (
              <Button
                testID="reserva-editar"
                variant="outline"
                onPress={() => {
                  setNotice(null);
                  setEditing(true);
                }}
              >
                <Text>Editar reserva</Text>
              </Button>
            ) : editBlock ? (
              <Card testID="reserva-sem-edicao">
                <Text variant="muted">{editBlock.message}</Text>
                {shouldTalkToSpace(editBlock.code) ? (
                  <TalkToSpace whatsapp={space.data?.whatsapp} />
                ) : null}
              </Card>
            ) : null}

            <BookingActions booking={booking} />

            <Card>
              <Text variant="large">Pagamento</Text>
              <View className="flex-row justify-between">
                <Text variant="muted">Total da reserva</Text>
                <Text variant="price" testID="reserva-total">
                  {formatCents(booking.priceCents)}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text variant="muted">Sua parte</Text>
                <Text variant="price">{formatCents(booking.myShare.shareCents)}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text variant="muted">Situação</Text>
                <Badge variant={payment.variant}>
                  <Text testID="reserva-situacao-pagamento">{payment.label}</Text>
                </Badge>
              </View>
              {isOrganizer ? <OnlinePaymentLines booking={booking} /> : null}
              {canPayOnline ? (
                <PayOnlineOption
                  hasOpenPix={hasOpenPix(booking.openOnlineCharge, now)}
                  openPixUntil={
                    booking.openOnlineCharge?.expiresAt
                      ? formatDeadline(
                          booking.openOnlineCharge.expiresAt,
                          booking.space.timeZone,
                          now,
                        )
                      : null
                  }
                  onPay={pay.start}
                />
              ) : null}
            </Card>

            {pendingPayment ? null : <InviteSection booking={booking} onChanged={refresh} />}

            {booking.status === 'CANCELLED' ? (
              <Card testID="reserva-cancelada">
                <Text variant="large">Reserva cancelada</Text>
                {booking.cancelReason ? (
                  <Text variant="muted" testID="reserva-motivo-cancelamento">
                    {cancelledText(booking)}
                  </Text>
                ) : null}
                {booking.cancelReason === 'PAYMENT_EXPIRED' && isOrganizer ? (
                  <Button
                    testID="reserva-reservar-de-novo"
                    variant="outline"
                    className="self-start"
                    onPress={() =>
                      router.push({
                        pathname: '/espaco/[slug]/reservar',
                        params: { slug: booking.space.slug },
                      })
                    }
                  >
                    <Text>Reservar de novo</Text>
                  </Button>
                ) : null}
              </Card>
            ) : null}

            {isOrganizer && pendingPayment ? (
              <View className="gap-2">
                <InlineError message={notice} />
                <Button
                  testID="reserva-desistir"
                  variant="outline"
                  className="border-destructive"
                  disabled={cancel.isPending}
                  onPress={confirmAbandon}
                >
                  <Text className="text-destructive">
                    {cancel.isPending ? 'Desistindo…' : 'Desistir da reserva'}
                  </Text>
                </Button>
              </View>
            ) : null}

            {isOrganizer && booking.status === 'CONFIRMED' ? (
              <View className="gap-2">
                <InlineError message={notice} />
                <Button
                  testID="reserva-cancelar"
                  variant="destructive"
                  disabled={!canCancelNow(booking.cancellableUntil) || cancel.isPending}
                  onPress={confirmCancel}
                >
                  <Text>{cancel.isPending ? 'Cancelando…' : 'Cancelar reserva'}</Text>
                </Button>
                {!canCancelNow(booking.cancellableUntil) ? (
                  <Text variant="muted" className="text-center" testID="reserva-prazo-vencido">
                    O prazo para cancelar acabou. Fale com o espaço.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      {booking ? (
        <EditBookingSheet
          // Se a API tirar a permissão com a folha aberta, a tela mostra o motivo.
          visible={editing && canEdit}
          booking={booking}
          space={space}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            queryClient.setQueryData(getGetMyBookingQueryKey(id), updated);
            void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
            setEditing(false);
          }}
          onFailed={refresh}
        />
      ) : null}
      {pay.sheet}
    </SafeAreaView>
  );
}
