import { type MyPaymentDetail, useGetMyPayment } from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Copy } from 'lucide-react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { isNotFound } from '@/lib/api-errors';
import { formatInstantDate, formatMonthYear, formatTime } from '@/lib/datetime';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { isSandbox, SandboxBadge } from './components/sandbox-badge';
import { remainingMs, serverNow, syncServerClock } from './countdown';
import {
  methodLongLabel,
  ONLINE_CHARGE_STATUS_LABELS,
  refundDestination,
  refundReasonText,
} from './labels';
import { paymentHref } from './payable';

const MINUS = '−';
const THIN = ' ';

/** "08/11/2026 às 18:42". */
const dateTime = (iso: string) => `${formatInstantDate(iso)} às ${formatTime(iso)}`;

/** Linha de situação abaixo do valor. */
export function receiptStatusLine(payment: MyPaymentDetail, now = serverNow()): string {
  switch (payment.status) {
    case 'PENDING':
      return payment.expiresAt && remainingMs(payment.expiresAt, now) > 0
        ? `Aguardando pagamento até ${formatTime(payment.expiresAt)}`
        : 'Aguardando pagamento';
    case 'FAILED':
      return `Recusado em ${dateTime(payment.createdAt)}`;
    case 'EXPIRED':
      return payment.paidAt
        ? `Pago em ${dateTime(payment.paidAt)}, depois do prazo`
        : `Venceu ${payment.expiresAt ? `em ${dateTime(payment.expiresAt)}` : 'sem pagamento'}`;
    case 'CANCELLED':
      return payment.paidAt
        ? `Pago em ${dateTime(payment.paidAt)}, depois da troca`
        : 'Cancelado antes do pagamento';
    default:
      return payment.paidAt ? `Pago em ${dateTime(payment.paidAt)}` : 'Pago';
  }
}

/** "a8f3…91c2". */
export function shortTransactionId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** "Sáb… " do item: quando (reserva) ou competência (mensalidade). */
function whenRow(payment: MyPaymentDetail): { label: string; value: string } | null {
  if (payment.item.type === 'BOOKING' && payment.item.startsAt) {
    return { label: 'Quando', value: dateTime(payment.item.startsAt) };
  }
  if (payment.item.periodStart) {
    return { label: 'Competência', value: formatMonthYear(payment.item.periodStart) };
  }
  return null;
}

/** Texto compartilhado (sem PDF nesta etapa). */
export function receiptShareText(payment: MyPaymentDetail): string {
  const when = whenRow(payment);
  const lines = [
    `Comprovante · Space Sports${isSandbox(payment.paymentEnvironment) ? ' (teste, sem valor)' : ''}`,
    `${formatCents(payment.amountCents)} · ${ONLINE_CHARGE_STATUS_LABELS[payment.status].label}`,
    receiptStatusLine(payment),
    `Serviço: ${payment.item.title}`,
    when ? `${when.label}: ${when.value}` : null,
    `Recebido por: ${payment.space.name}`,
    `Pago por: ${payment.payerName}`,
    `Forma: ${methodLongLabel(payment.method, payment.cardLast4)}`,
    payment.transactionId ? `Transação: ${payment.transactionId}` : null,
    ...payment.refunds.map(
      (r) =>
        `Estorno em ${formatInstantDate(r.createdAt)}: ${MINUS}${THIN}${formatCents(r.amountCents)}`,
    ),
  ];
  return lines.filter(Boolean).join('\n');
}

/** Comprovante (RF-ONPAY-06; docs/05, "App — (6)"): detalhe, estornos e compartilhar. */
export function PaymentReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const name = useThemeName();
  const query = useGetMyPayment(id);
  const payment = query.data;

  useEffect(() => {
    if (payment) syncServerClock(payment.serverTime, query.dataUpdatedAt);
  }, [payment, query.dataUpdatedAt]);

  const sandbox = isSandbox(payment?.paymentEnvironment);

  const body = () => {
    if (query.isPending) return <LoadingView />;
    if (query.isError || !payment) {
      return isNotFound(query.error) ? (
        <EmptyView title="Pagamento não encontrado" />
      ) : (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      );
    }
    const status = ONLINE_CHARGE_STATUS_LABELS[payment.status];
    const when = whenRow(payment);
    const rows: { label: string; value: string }[] = [
      { label: 'Serviço', value: payment.item.title },
      ...(when ? [when] : []),
      { label: 'Recebido por', value: payment.space.name },
      { label: 'Pago por', value: payment.payerName },
      { label: 'Forma', value: methodLongLabel(payment.method, payment.cardLast4) },
    ];
    const pendingInTime =
      payment.status === 'PENDING' &&
      Boolean(payment.expiresAt && remainingMs(payment.expiresAt) > 0);
    const item = payment.item;
    const payable =
      item.type === 'BOOKING'
        ? ({ type: 'BOOKING', bookingId: item.id } as const)
        : item.subscriptionId
          ? ({
              type: 'SUBSCRIPTION_CHARGE',
              subscriptionId: item.subscriptionId,
              chargeId: item.id,
            } as const)
          : null;

    return (
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10">
        <View className="gap-1 pt-2">
          <View className="flex-row items-start justify-between gap-3">
            <Text testID="comprovante-valor" className="font-display-bold text-4xl tabular-nums">
              {formatCents(payment.amountCents)}
            </Text>
            <Badge variant={status.variant} testID="comprovante-status">
              <Text>{status.label}</Text>
            </Badge>
          </View>
          <Text variant="muted" className="tabular-nums">
            {receiptStatusLine(payment)}
          </Text>
          {sandbox ? (
            <Text variant="muted" testID="comprovante-teste">
              Comprovante de teste, sem valor
            </Text>
          ) : null}
        </View>

        <View className="gap-2 border-y border-border py-3">
          {rows.map((row) => (
            <View key={row.label} className="flex-row justify-between gap-4">
              <Text variant="muted">{row.label}</Text>
              <Text className="flex-1 text-right text-sm tabular-nums">{row.value}</Text>
            </View>
          ))}
          {payment.transactionId ? (
            <View className="flex-row items-center justify-between gap-4">
              <Text variant="muted">Transação</Text>
              <Pressable
                testID="comprovante-transacao"
                accessibilityRole="button"
                accessibilityLabel="Copiar o código da transação"
                hitSlop={8}
                className="min-h-11 flex-row items-center gap-2"
                onPress={() => {
                  void Clipboard.setStringAsync(payment.transactionId ?? '');
                  AccessibilityInfo.announceForAccessibility('Código da transação copiado');
                }}
              >
                <Text className="text-sm tabular-nums">
                  {shortTransactionId(payment.transactionId)}
                </Text>
                <Copy size={16} color={color(name, 'mutedForeground')} aria-hidden />
              </Pressable>
            </View>
          ) : null}
        </View>

        {payment.refunds.length > 0 ? (
          <View className="gap-3 border-b border-border pb-3" testID="comprovante-estornos">
            <Text variant="overline">Estornos</Text>
            {payment.refunds.map((refund) => (
              <View key={refund.id} className="gap-0.5">
                <View className="flex-row justify-between">
                  <Text className="text-sm">
                    {formatInstantDate(refund.createdAt)}
                    {refund.status === 'PENDING' ? ' · em processamento' : ''}
                  </Text>
                  <Text className="text-sm font-medium tabular-nums">
                    {MINUS}
                    {THIN}
                    {formatCents(refund.amountCents)}
                  </Text>
                </View>
                <Text variant="muted">{refundReasonText(refund.reasonCode, refund.reason)}</Text>
                {refund.kind === 'REFUND' ? (
                  <Text variant="muted">{refundDestination(payment.method)}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View className="gap-3">
          {pendingInTime && payable ? (
            <Button
              testID="comprovante-continuar"
              size="lg"
              onPress={() =>
                router.push(
                  paymentHref(payable, { forma: payment.method === 'PIX' ? 'pix' : 'cartao' }),
                )
              }
            >
              <Text>Continuar pagamento</Text>
            </Button>
          ) : null}
          <Button
            testID="comprovante-compartilhar"
            variant="outline"
            onPress={() => void Share.share({ message: receiptShareText(payment) })}
          >
            <Text>Compartilhar comprovante</Text>
          </Button>
          {payable ? (
            <Button
              testID="comprovante-ver-item"
              variant="ghost"
              onPress={() =>
                payable.type === 'BOOKING'
                  ? router.push({ pathname: '/reserva/[id]', params: { id: payable.bookingId } })
                  : router.push({
                      pathname: '/planos/[id]',
                      params: { id: payable.subscriptionId },
                    })
              }
            >
              <Text>{payable.type === 'BOOKING' ? 'Ver reserva' : 'Ver plano'}</Text>
            </Button>
          ) : null}
        </View>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader
        title="Comprovante"
        testID="comprovante-titulo"
        right={sandbox ? <SandboxBadge /> : undefined}
      />
      {body()}
    </SafeAreaView>
  );
}
