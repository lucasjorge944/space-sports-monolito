'use client';

import {
  type SpaceSubscriptionChargePageItemsItem,
  useListOnlineCharges,
  useReversePayment,
  useWaiveSubscriptionCharge,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { OnlineChargesSection, OnlineTag } from '@/components/painel/online/online-charges';
import { ReasonDialog } from '@/components/painel/reason-dialog';
import type { SpaceScope } from '@/components/painel/space-scope';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime, formatMoney, formatSignedMoney } from '@/lib/format';
import { PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import { isOnlineRecord } from '@/lib/painel/online-payments';
import { invalidateSpace } from '@/lib/painel/query';
import { chargeMonth } from '@/lib/painel/subscriptions';

type Charge = SpaceSubscriptionChargePageItemsItem;

/** Dispensar a mensalidade (RN-PAY, `charge.waive`: Dono e Admin); fica auditado com o motivo. */
export function WaiveDialog({
  scope,
  charge,
  onClose,
}: {
  scope: SpaceScope;
  charge: Charge | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const waive = useWaiveSubscriptionCharge();

  return (
    <ReasonDialog
      open={charge !== null}
      onOpenChange={(open) => {
        if (!open) {
          waive.reset();
          onClose();
        }
      }}
      title="Dispensar mensalidade"
      description={
        charge
          ? `${charge.student.name} não precisará pagar a mensalidade ${chargeMonth(charge.periodStart)} (${formatMoney(charge.amountCents)}). A ação fica registrada e não pode ser desfeita.`
          : undefined
      }
      confirmLabel="Dispensar"
      pending={waive.isPending}
      error={waive.error}
      onConfirm={(reason) => {
        if (!charge) return;
        waive.mutate(
          { spaceId: scope.spaceId, chargeId: charge.id, data: reason ? { reason } : {} },
          {
            onSuccess: () => {
              toast.success('Mensalidade dispensada.');
              void invalidateSpace(queryClient, scope.spaceId);
              onClose();
            },
          },
        );
      }}
    />
  );
}

/** Pagamentos da mensalidade, com estorno (RN-PAY-01: marca o estorno, não apaga). */
export function ChargePaymentsDialog({
  scope,
  charge,
  canReverse,
  onClose,
}: {
  scope: SpaceScope;
  charge: Charge | null;
  canReverse: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reverse = useReversePayment();
  const [reversing, setReversing] = useState<Charge['payments'][number] | null>(null);

  return (
    <>
      <Dialog open={charge !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagamentos da mensalidade</DialogTitle>
            <DialogDescription>
              {charge
                ? `${charge.student.name} · ${chargeMonth(charge.periodStart)} · ${charge.plan.name}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {charge && charge.discountCents > 0 ? (
            <p className="text-sm tabular-nums" data-testid="charge-discount">
              Abatimento por estorno: {formatSignedMoney(-charge.discountCents)}
            </p>
          ) : null}
          {charge && charge.payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum pagamento registrado.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {charge?.payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  data-testid="charge-payment-row"
                >
                  <div>
                    <div className="flex items-center gap-2 font-medium tabular-nums">
                      {formatMoney(p.amountCents)}
                      {isOnlineRecord(p) ? <OnlineTag /> : null}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {PAYMENT_METHOD_LABEL[p.method]} · {formatDateTime(p.paidAt)}
                    </div>
                  </div>
                  {/* Pago pelo app: só sai pelo estorno da cobrança online (bloco abaixo). */}
                  {canReverse && !isOnlineRecord(p) ? (
                    <Button variant="outline" size="sm" onClick={() => setReversing(p)}>
                      <Undo2 /> Estornar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {charge && scope.can('payments.online.manage') ? (
            <ChargeOnlinePayments scope={scope} charge={charge} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(open) => {
          if (!open) {
            reverse.reset();
            setReversing(null);
          }
        }}
        title="Estornar pagamento"
        description={
          reversing
            ? `O pagamento de ${formatMoney(reversing.amountCents)} (${PAYMENT_METHOD_LABEL[reversing.method]}) deixa de contar e a mensalidade volta a ter esse valor em aberto.`
            : undefined
        }
        confirmLabel="Estornar"
        pending={reverse.isPending}
        error={reverse.error}
        onConfirm={(reason) => {
          if (!reversing) return;
          reverse.mutate(
            {
              spaceId: scope.spaceId,
              paymentId: reversing.id,
              data: reason ? { reason } : {},
            },
            {
              onSuccess: () => {
                toast.success('Pagamento estornado.');
                void invalidateSpace(queryClient, scope.spaceId);
                setReversing(null);
                onClose();
              },
            },
          );
        }}
      />
    </>
  );
}

/** Pagamento online da mensalidade (RF-ONPAY-08): Dono e Admin. */
function ChargeOnlinePayments({ scope, charge }: { scope: SpaceScope; charge: Charge }) {
  const query = useListOnlineCharges(scope.spaceId, {
    payableType: 'SUBSCRIPTION_CHARGE',
    payableId: charge.id,
  });
  if (query.isPending || query.isError) return null;
  return (
    <OnlineChargesSection
      scope={scope}
      charges={query.data.items}
      openCharge={charge.openOnlineCharge}
      item="mensalidade"
    />
  );
}
