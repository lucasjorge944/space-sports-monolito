'use client';

import {
  type SimulatorChargeListItemsItem,
  useSimulatorApproveMerchant,
  useSimulatorChargebackCharge,
  useSimulatorExpireCharge,
  useSimulatorListCharges,
  useSimulatorPayCharge,
  useSimulatorRejectMerchant,
  useSimulatorResolveDispute,
  useSimulatorSettle,
  useSuperListMerchantAccounts,
  useSuperListSpaces,
} from '@space-sports/api-client';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, formatShortDateTime } from '@/lib/format';
import { ONLINE_METHOD_LABEL } from '@/lib/painel/labels';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { ReasonDialog } from '../reason-dialog';

/** Invalida as consultas do pagamento online no Super depois de cada ação simulada. */
function refreshAll(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (q) => {
      const head = q.queryKey[0];
      return typeof head === 'string' && head.startsWith('/v1/super/online-payments');
    },
  });
}

function itemLabel(c: SimulatorChargeListItemsItem): string {
  return `${c.payableType === 'BOOKING' ? 'Reserva' : 'Mensalidade'} · ${c.payer.name}`;
}

const dashed = 'border-[1.5px] border-dashed border-sandbox-border';

/** Simulador de pagamentos (RF-ONPAY-12): só existe com o gateway simulado, nunca em produção. */
export function SimulatorTab() {
  return (
    <div className="flex flex-col gap-6">
      <div
        role="note"
        className="border-sandbox-border bg-sandbox text-sandbox-foreground flex gap-3 rounded-lg border-[1.5px] p-4"
        data-testid="simulator-banner"
      >
        <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="grid gap-1">
          <p className="text-overline font-semibold uppercase">Simulador · ambiente de teste</p>
          <p className="text-sm">
            Estas ações fingem eventos do parceiro de pagamentos. Só existem com o gateway simulado
            e nunca em produção. Nada aqui movimenta dinheiro de verdade.
          </p>
        </div>
      </div>
      <PendingCharges />
      <div className="grid gap-6 lg:grid-cols-2">
        <Chargebacks />
        <PendingMerchants />
      </div>
      <Balances />
    </div>
  );
}

function useAction() {
  const queryClient = useQueryClient();
  return {
    onSuccess: (message: string) => {
      toast.success(message);
      void refreshAll(queryClient);
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  };
}

function PendingCharges() {
  const charges = useSimulatorListCharges({ status: 'PENDING' });
  const pay = useSimulatorPayCharge();
  const expire = useSimulatorExpireCharge();
  const { onSuccess, onError } = useAction();
  const busy = pay.isPending || expire.isPending;

  return (
    <Card className={dashed}>
      <CardHeader>
        <CardTitle>Cobranças pendentes</CardTitle>
      </CardHeader>
      <CardContent>
        {charges.isPending ? (
          <LoadingBlock rows={2} />
        ) : charges.isError ? (
          <ErrorBlock error={charges.error} onRetry={() => void charges.refetch()} />
        ) : charges.data.items.length === 0 ? (
          <EmptyBlock>Nenhuma cobrança pendente.</EmptyBlock>
        ) : (
          <Table aria-label="Cobranças pendentes">
            <TableHeader>
              <TableRow>
                <TableHead>Espaço</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Meio</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.data.items.map((c) => (
                <TableRow key={c.id} data-testid="simulator-charge">
                  <TableCell>{c.spaceName}</TableCell>
                  <TableCell>{itemLabel(c)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(c.amountCents)}
                  </TableCell>
                  <TableCell>{ONLINE_METHOD_LABEL[c.method]}</TableCell>
                  <TableCell className="tabular-nums">
                    {c.expiresAt ? formatShortDateTime(c.expiresAt) : '—'}
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        pay.mutate(
                          { chargeId: c.id },
                          {
                            onSuccess: () =>
                              onSuccess(
                                `${ONLINE_METHOD_LABEL[c.method]} de ${formatMoney(c.amountCents)} pago. O webhook foi enviado.`,
                              ),
                            onError,
                          },
                        )
                      }
                    >
                      Pagar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() =>
                        expire.mutate(
                          { chargeId: c.id },
                          {
                            onSuccess: () => onSuccess('Cobrança vencida. O webhook foi enviado.'),
                            onError,
                          },
                        )
                      }
                    >
                      Vencer
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Chargebacks() {
  const paid = useSimulatorListCharges({ status: 'PAID' });
  const disputed = useSimulatorListCharges({ status: 'CHARGEBACK' });
  const chargeback = useSimulatorChargebackCharge();
  const resolve = useSimulatorResolveDispute();
  const { onSuccess, onError } = useAction();
  const [chargeId, setChargeId] = useState('');
  const [disputedId, setDisputedId] = useState('');
  const cards = (paid.data?.items ?? []).filter((c) => c.method === 'CARD');
  const open = disputed.data?.items ?? [];

  return (
    <Card className={dashed}>
      <CardHeader>
        <CardTitle>Contestação</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Cobrança paga com cartão" htmlFor="sim-chargeback">
          <Select
            id="sim-chargeback"
            value={chargeId}
            onChange={(e) => setChargeId(e.target.value)}
          >
            <option value="">Escolha a cobrança</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.spaceName} · {itemLabel(c)} · {formatMoney(c.amountCents)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="outline"
          className="w-fit"
          disabled={!chargeId || chargeback.isPending}
          onClick={() =>
            chargeback.mutate(
              { chargeId },
              {
                onSuccess: () => {
                  setChargeId('');
                  onSuccess('Contestação gerada. O espaço é avisado com o prazo.');
                },
                onError,
              },
            )
          }
        >
          Gerar contestação
        </Button>
        {open.length > 0 ? (
          <div className="grid gap-2 border-t pt-4">
            <Field label="Decidir contestação" htmlFor="sim-dispute">
              <Select
                id="sim-dispute"
                value={disputedId}
                onChange={(e) => setDisputedId(e.target.value)}
              >
                <option value="">Escolha a cobrança contestada</option>
                {open.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.spaceName} · {itemLabel(c)} · {formatMoney(c.amountCents)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              {(['WON', 'LOST'] as const).map((outcome) => (
                <Button
                  key={outcome}
                  variant="outline"
                  disabled={!disputedId || resolve.isPending}
                  onClick={() =>
                    resolve.mutate(
                      { chargeId: disputedId, data: { outcome } },
                      {
                        onSuccess: () => {
                          setDisputedId('');
                          onSuccess(
                            outcome === 'WON'
                              ? 'Contestação ganha pelo espaço.'
                              : 'Contestação perdida pelo espaço.',
                          );
                        },
                        onError,
                      },
                    )
                  }
                >
                  {outcome === 'WON' ? 'Espaço ganha' : 'Espaço perde'}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PendingMerchants() {
  const merchants = useSuperListMerchantAccounts({ status: 'PENDING', pageSize: 50 });
  const approve = useSimulatorApproveMerchant();
  const reject = useSimulatorRejectMerchant();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = useAction();
  const [rejecting, setRejecting] = useState<{ spaceId: string; spaceName: string } | null>(null);

  return (
    <Card className={dashed}>
      <CardHeader>
        <CardTitle>Cadastros em análise</CardTitle>
      </CardHeader>
      <CardContent>
        {merchants.isPending ? (
          <LoadingBlock rows={2} />
        ) : merchants.isError ? (
          <ErrorBlock error={merchants.error} onRetry={() => void merchants.refetch()} />
        ) : merchants.data.items.length === 0 ? (
          <EmptyBlock>Nenhum cadastro em análise.</EmptyBlock>
        ) : (
          <ul className="grid gap-2 text-sm">
            {merchants.data.items.map((m) => (
              <li
                key={m.spaceId}
                className="flex items-center justify-between gap-2"
                data-testid="simulator-merchant"
              >
                <span>{m.spaceName}</span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate(
                        { spaceId: m.spaceId },
                        {
                          onSuccess: () => onSuccess(`Cadastro de ${m.spaceName} aprovado.`),
                          onError,
                        },
                      )
                    }
                  >
                    Aprovar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(m)}>
                    Recusar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={`Recusar o cadastro de ${rejecting?.spaceName ?? ''}`}
        description="O Dono vê o motivo e pode corrigir e reenviar."
        required
        confirmLabel="Recusar"
        pendingLabel="Recusando…"
        destructive
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await reject.mutateAsync({ spaceId: rejecting.spaceId, data: { reason: reason ?? '' } });
          toast.success(`Cadastro de ${rejecting.spaceName} recusado.`);
          void refreshAll(queryClient);
        }}
      />
    </Card>
  );
}

function Balances() {
  const spaces = useSuperListSpaces({ pageSize: 100 });
  const settle = useSimulatorSettle();
  const { onSuccess, onError } = useAction();
  const [spaceId, setSpaceId] = useState('');

  return (
    <Card className={dashed}>
      <CardHeader>
        <CardTitle>Saldos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <Field label="Espaço" htmlFor="sim-space">
            <Select id="sim-space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              <option value="">Todos</option>
              {spaces.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          variant="outline"
          disabled={settle.isPending}
          onClick={() =>
            settle.mutate(
              { data: spaceId ? { spaceId } : {} },
              {
                onSuccess: () => onSuccess('Saldos liberados e repasse executado.'),
                onError,
              },
            )
          }
        >
          Liberar tudo e repassar agora
        </Button>
        <p className="text-muted-foreground w-full text-xs">
          Libera o que estava a liberar e repassa o disponível para a conta do espaço.
        </p>
      </CardContent>
    </Card>
  );
}
