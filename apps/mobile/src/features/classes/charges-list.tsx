import type { SubscriptionCharge } from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatDeadline } from '@/features/payments/countdown';
import { hasOpenPix, usePayAction } from '@/features/payments/use-pay-action';
import { PAYMENT_METHOD_LABELS } from '@/features/space/labels';
import { formatDate, formatInstantDate, formatMonthYear } from '@/lib/datetime';
import { CHARGE_STATUS_LABELS } from './labels';

/** Pagamento online das mensalidades (RF-ONPAY-05): só com o modo de aulas `ONLINE_OPTIONAL`. */
export interface OnlineChargePay {
  subscriptionId: string;
  spaceSlug: string;
  timeZone?: string;
}

/** Pendentes (a pagar ou em atraso) primeiro; pagas e dispensadas no histórico. */
export function splitCharges(charges: SubscriptionCharge[]): {
  pending: SubscriptionCharge[];
  history: SubscriptionCharge[];
} {
  const byDueDesc = (a: SubscriptionCharge, b: SubscriptionCharge) =>
    b.dueDate.localeCompare(a.dueDate);
  return {
    pending: charges
      .filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE')
      .sort(byDueDesc),
    history: charges.filter((c) => c.status === 'PAID' || c.status === 'WAIVED').sort(byDueDesc),
  };
}

function ChargeRow({
  charge,
  online,
}: {
  charge: SubscriptionCharge;
  online?: OnlineChargePay | null;
}) {
  const status = CHARGE_STATUS_LABELS[charge.status];
  const partial = charge.status !== 'PAID' && charge.status !== 'WAIVED' && charge.paidCents > 0;
  const open = charge.status === 'PENDING' || charge.status === 'OVERDUE';
  const lastPayment = charge.payments[charge.payments.length - 1];
  // Pago pelo app (canal ONLINE, RN-ONPAY-04): o comprovante fica em Meus pagamentos.
  const onlinePayment = [...charge.payments].reverse().find((p) => p.channel === 'ONLINE');
  return (
    <View className="gap-2 py-1.5">
      <View
        testID={`plano-mensalidade-${charge.id}`}
        className="flex-row items-center justify-between gap-3"
        accessible
        accessibilityLabel={`Mensalidade de ${formatMonthYear(charge.periodStart)}, ${status.label}`}
      >
        <View className="flex-1">
          <Text className="font-medium">{formatMonthYear(charge.periodStart)}</Text>
          <Text variant="muted">
            {charge.status === 'PAID' && lastPayment
              ? `Paga com ${lastPayment.method === 'PIX' ? 'Pix' : PAYMENT_METHOD_LABELS[lastPayment.method].toLowerCase()} em ${formatInstantDate(lastPayment.paidAt, online?.timeZone).slice(0, 5)}`
              : `Vence ${formatDate(charge.dueDate)}`}
            {partial ? ` · faltam ${formatCents(charge.dueCents)}` : ''}
          </Text>
          {charge.waiveNotice ? (
            <Text variant="muted" testID={`plano-mensalidade-${charge.id}-dispensa`}>
              {charge.waiveNotice}
            </Text>
          ) : null}
        </View>
        <View className="items-end gap-1">
          <Text variant="price">{formatCents(charge.amountCents)}</Text>
          <Badge variant={status.variant}>
            <Text>{status.label}</Text>
          </Badge>
        </View>
      </View>
      {onlinePayment?.onlineChargeId ? (
        <ReceiptLink chargeId={charge.id} onlineChargeId={onlinePayment.onlineChargeId} />
      ) : null}
      {online && open && charge.dueCents > 0 ? (
        <ChargePayButton charge={charge} online={online} />
      ) : null}
    </View>
  );
}

function ReceiptLink({ chargeId, onlineChargeId }: { chargeId: string; onlineChargeId: string }) {
  const router = useRouter();
  return (
    <Button
      testID={`plano-mensalidade-${chargeId}-comprovante`}
      variant="ghost"
      size="sm"
      className="self-start px-0"
      onPress={() =>
        router.push({ pathname: '/meus-pagamentos/[id]', params: { id: onlineChargeId } })
      }
    >
      <Text>Ver comprovante</Text>
    </Button>
  );
}

/** "Pagar R$ 180,00" ou, com um Pix aberto e no prazo, "Continuar pagamento". */
function ChargePayButton({
  charge,
  online,
}: {
  charge: SubscriptionCharge;
  online: OnlineChargePay;
}) {
  const pay = usePayAction({
    payable: {
      type: 'SUBSCRIPTION_CHARGE',
      subscriptionId: online.subscriptionId,
      chargeId: charge.id,
    },
    spaceSlug: online.spaceSlug,
    service: 'classes',
    openCharge: charge.openOnlineCharge,
  });
  const openPix = hasOpenPix(charge.openOnlineCharge);
  const amount = formatCents(charge.dueCents);
  return (
    <View className="gap-1">
      <Button
        testID={`plano-mensalidade-${charge.id}-pagar`}
        variant="outline"
        size="sm"
        onPress={pay.start}
        accessibilityLabel={
          openPix
            ? `Continuar o pagamento da mensalidade de ${formatMonthYear(charge.periodStart)}`
            : `Pagar a mensalidade de ${formatMonthYear(charge.periodStart)}, ${amount}`
        }
      >
        <Text className="tabular-nums">{openPix ? 'Continuar pagamento' : `Pagar ${amount}`}</Text>
      </Button>
      {openPix && charge.openOnlineCharge?.expiresAt ? (
        <Text variant="muted" className="tabular-nums">
          Pix gerado · vale até {formatDeadline(charge.openOnlineCharge.expiresAt, online.timeZone)}
        </Text>
      ) : null}
      {pay.sheet}
    </View>
  );
}

/** Mensalidades pagas e pendentes da assinatura (RF-CLASS-06); "Pagar agora" com o online (RF-ONPAY-05). */
export function ChargesList({
  charges,
  online,
}: {
  charges: SubscriptionCharge[];
  online?: OnlineChargePay | null;
}) {
  const { pending, history } = splitCharges(charges);
  if (pending.length === 0 && history.length === 0) {
    return (
      <Text variant="muted" testID="plano-sem-mensalidades">
        Nenhuma mensalidade gerada ainda.
      </Text>
    );
  }
  return (
    <View className="gap-3">
      {pending.length > 0 ? (
        <View testID="plano-mensalidades-pendentes">
          <Text variant="small" className="mb-1">
            Pendentes
          </Text>
          {pending.map((charge) => (
            <ChargeRow key={charge.id} charge={charge} online={online} />
          ))}
        </View>
      ) : null}
      {history.length > 0 ? (
        <View testID="plano-mensalidades-historico">
          <Text variant="small" className="mb-1">
            Histórico
          </Text>
          {history.map((charge) => (
            <ChargeRow key={charge.id} charge={charge} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
