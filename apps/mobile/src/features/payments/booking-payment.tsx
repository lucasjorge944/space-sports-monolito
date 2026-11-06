import {
  type PlayerBookingDetailDto,
  type PlayerOnlineCharge,
  useGetMyPayment,
} from '@space-sports/api-client';
import { BOOKING_PAYMENT_EXPIRED_REASON, formatCents } from '@space-sports/shared';
import { useRouter } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatInstantDate, formatTime } from '@/lib/datetime';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { countdownA11yLabel, formatClock, formatDeadline, nowWithOffset } from './countdown';
import { ONLINE_CHARGE_STATUS_LABELS, refundReasonText } from './labels';
import { useCountdown } from './use-countdown';
import { bookingDueCents } from './use-payable-context';

const MINUS = '−';
const THIN = ' ';

/**
 * Reserva aguardando pagamento (RF-ONPAY-04; docs/05, "App — (4)"): "Falta pagar para confirmar",
 * o prazo em hora de relógio e em contagem, e o botão de pagar. No prazo zerado, avisa quem chamou
 * para reler a reserva (a leitura cancela o hold vencido).
 */
export function PendingPaymentCard({
  booking,
  clockOffsetMs,
  onPay,
  onExpired,
}: {
  booking: PlayerBookingDetailDto;
  /** Diferença servidor − aparelho do `serverTime` da reserva. */
  clockOffsetMs: number | null;
  onPay: () => void;
  onExpired: () => void;
}) {
  const name = useThemeName();
  const remaining = useCountdown(booking.paymentDueAt, true, clockOffsetMs);
  useEffect(() => {
    if (remaining === 0) onExpired();
  }, [remaining, onExpired]);
  const due = bookingDueCents(booking);
  return (
    <View
      testID="reserva-aguardando-pagamento"
      className="gap-2 rounded-lg border border-warning-subtle-border bg-warning-subtle p-4"
    >
      <Text className="font-semibold text-lg">Falta pagar para confirmar</Text>
      {booking.paymentDueAt ? (
        <Text className="text-sm tabular-nums">
          O horário fica guardado até{' '}
          {formatDeadline(
            booking.paymentDueAt,
            booking.space.timeZone,
            nowWithOffset(clockOffsetMs),
          )}
          .
        </Text>
      ) : null}
      {remaining !== null ? (
        <View className="flex-row items-center gap-2">
          <Clock size={16} color={color(name, 'warningSubtleForeground')} aria-hidden />
          <Text
            testID="reserva-prazo-contagem"
            accessibilityLabel={countdownA11yLabel(remaining)}
            className="font-medium text-warning-subtle-foreground tabular-nums"
          >
            {remaining > 0 ? `Faltam ${formatClock(remaining)}` : 'Conferindo…'}
          </Text>
        </View>
      ) : null}
      <Button testID="reserva-pagar" onPress={onPay} disabled={remaining === 0}>
        <Text className="tabular-nums">Pagar {formatCents(due)}</Text>
      </Button>
    </View>
  );
}

/** Texto do card "Reserva cancelada" para os motivos do pagamento online. */
export function cancelledText(
  booking: Pick<PlayerBookingDetailDto, 'cancelReason' | 'paymentDueAt' | 'space'>,
): string | null {
  if (booking.cancelReason === BOOKING_PAYMENT_EXPIRED_REASON) {
    return booking.paymentDueAt
      ? `O pagamento não foi feito até ${formatTime(booking.paymentDueAt, booking.space.timeZone)} e o horário foi liberado.`
      : 'O pagamento não foi feito no prazo e o horário foi liberado.';
  }
  if (booking.cancelReason === 'PAYMENT_ABANDONED') return 'Você desistiu antes de pagar.';
  return booking.cancelReason;
}

/** Valor que volta se o organizador cancelar no prazo (pago online, menos o já estornado). */
export function refundableOnCancel(charge: PlayerOnlineCharge | null | undefined): number {
  if (!charge) return 0;
  if (charge.status !== 'PAID' && charge.status !== 'PARTIALLY_REFUNDED') return 0;
  return Math.max(charge.amountCents - charge.refundedCents, 0);
}

/** "Os R$ 120,00 voltam para o seu Pix." para o alerta de cancelamento. */
export function cancelRefundSentence(charge: PlayerOnlineCharge | null | undefined): string | null {
  const amount = refundableOnCancel(charge);
  if (!charge || amount === 0) return null;
  return `Os ${formatCents(amount)} voltam para o seu ${charge.method === 'PIX' ? 'Pix' : 'cartão'}.`;
}

/** Situação do bloco "Pagamento" quando a cobrança online foi estornada ou contestada. */
export function onlineSituation(charge: PlayerOnlineCharge | null | undefined) {
  if (!charge) return null;
  if (
    charge.status === 'REFUNDED' ||
    charge.status === 'PARTIALLY_REFUNDED' ||
    charge.status === 'CHARGEBACK'
  ) {
    return ONLINE_CHARGE_STATUS_LABELS[charge.status];
  }
  return null;
}

/**
 * Linhas do pagamento online no bloco "Pagamento" do detalhe (docs/05, "App — (4)", tabela):
 * pago, estornado, estorno parcial e contestado; "Ver comprovante" abre Meus pagamentos.
 */
export function OnlinePaymentLines({ booking }: { booking: PlayerBookingDetailDto }) {
  const router = useRouter();
  const charge = booking.onlinePayment;
  const refunded = charge?.status === 'REFUNDED' || charge?.status === 'PARTIALLY_REFUNDED';
  const detail = useGetMyPayment(charge?.id ?? '', {
    query: { enabled: Boolean(charge && refunded) },
  });
  if (!charge) return null;
  const tz = booking.space.timeZone;
  const receipt = (
    <Button
      testID="reserva-ver-comprovante"
      variant="ghost"
      size="sm"
      className="self-start px-0"
      onPress={() => router.push({ pathname: '/meus-pagamentos/[id]', params: { id: charge.id } })}
    >
      <Text>Ver comprovante</Text>
    </Button>
  );
  const withMethod =
    charge.method === 'PIX'
      ? 'com Pix'
      : charge.cardLast4
        ? `com cartão final ${charge.cardLast4}`
        : 'com cartão';
  const refunds = (detail.data?.refunds ?? []).filter((r) => r.kind === 'REFUND');
  const lastRefund = refunds[refunds.length - 1];

  switch (charge.status) {
    case 'PAID':
      return (
        <View className="gap-1" testID="reserva-pago-online">
          {charge.paidAt ? (
            <Text variant="muted">
              Pago {withMethod} em {formatInstantDate(charge.paidAt, tz).slice(0, 5)} às{' '}
              {formatTime(charge.paidAt, tz)}
            </Text>
          ) : null}
          {receipt}
        </View>
      );
    case 'REFUNDED':
      return (
        <View className="gap-1" testID="reserva-estornado">
          <Text variant="muted">
            {formatCents(charge.refundedCents)} devolvidos
            {lastRefund ? ` em ${formatInstantDate(lastRefund.createdAt, tz).slice(0, 5)}` : ''}{' '}
            {charge.method === 'PIX'
              ? 'para o seu Pix.'
              : 'para o seu cartão. Pode aparecer na fatura seguinte.'}
          </Text>
          {receipt}
        </View>
      );
    case 'PARTIALLY_REFUNDED': {
      const due = bookingDueCents(booking);
      return (
        <View className="gap-1" testID="reserva-estorno-parcial">
          <View className="flex-row justify-between">
            <Text variant="muted">Pago {withMethod}</Text>
            <Text className="text-sm tabular-nums">{formatCents(charge.amountCents)}</Text>
          </View>
          {refunds.map((refund) => (
            <View key={refund.id} className="gap-0.5">
              <View className="flex-row justify-between">
                <Text variant="muted">
                  Devolvido em {formatInstantDate(refund.createdAt, tz).slice(0, 5)}
                </Text>
                <Text className="text-sm tabular-nums">
                  {MINUS}
                  {THIN}
                  {formatCents(refund.amountCents)}
                </Text>
              </View>
              <Text variant="muted">{refundReasonText(refund.reasonCode, refund.reason)}</Text>
            </View>
          ))}
          {refunds.length === 0 ? (
            <View className="flex-row justify-between">
              <Text variant="muted">Devolvido</Text>
              <Text className="text-sm tabular-nums">
                {MINUS}
                {THIN}
                {formatCents(charge.refundedCents)}
              </Text>
            </View>
          ) : null}
          {due > 0 ? (
            <Text className="text-sm font-medium tabular-nums">
              Falta pagar {formatCents(due)} no espaço
            </Text>
          ) : null}
          {receipt}
        </View>
      );
    }
    case 'CHARGEBACK':
      return (
        <View className="gap-1" testID="reserva-contestado">
          <Text variant="muted">
            Este pagamento foi contestado com o banco do cartão. A reserva voltou a constar como não
            paga.
          </Text>
          {receipt}
        </View>
      );
    default:
      return null;
  }
}

/** "Pagar online" da reserva confirmada no modo opcional, enquanto ela não começou. */
export function PayOnlineOption({
  hasOpenPix,
  openPixUntil,
  onPay,
}: {
  hasOpenPix: boolean;
  openPixUntil: string | null;
  onPay: () => void;
}) {
  return (
    <View className="gap-1" testID="reserva-pagar-online">
      <Button variant="outline" testID="reserva-pagar-online-botao" onPress={onPay}>
        <Text>{hasOpenPix ? 'Continuar pagamento' : 'Pagar online'}</Text>
      </Button>
      <Text variant="muted">
        {hasOpenPix && openPixUntil
          ? `Pix gerado · vale até ${openPixUntil}`
          : 'Ou pague no espaço no dia do jogo.'}
      </Text>
    </View>
  );
}
