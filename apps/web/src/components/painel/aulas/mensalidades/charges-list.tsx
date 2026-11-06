'use client';

import {
  getListSubscriptionChargesQueryKey,
  type ListSubscriptionChargesParams,
  listSubscriptionCharges,
  type SpaceSubscriptionChargePageItemsItem,
} from '@space-sports/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ban, Download, HandCoins, ReceiptText, X } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/painel/field';
import { type Payable, PaymentDialog } from '@/components/painel/payment-dialog';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardLabel } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatLocalDate, formatMoney } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/painel/csv';
import { CHARGE_STATUS } from '@/lib/painel/labels';
import {
  canReceiveCharge,
  canWaiveCharge,
  chargeMonth,
  chargesCsvRows,
  waiveNote,
} from '@/lib/painel/subscriptions';
import { ChargePaymentsDialog, WaiveDialog } from './charge-dialogs';
import type { StudentFilter } from './mensalidades-view';

type Charge = SpaceSubscriptionChargePageItemsItem;

const FILTERS: Record<string, { label: string; params: ListSubscriptionChargesParams }> = {
  open: { label: 'Em aberto', params: { status: ['PENDING', 'OVERDUE'] } },
  overdue: { label: 'Vencidas', params: { overdue: 'true' } },
  paid: { label: 'Pagas', params: { status: ['PAID'] } },
  waived: { label: 'Dispensadas', params: { status: ['WAIVED'] } },
  all: { label: 'Todas', params: {} },
};

const PAGE_SIZE = 50;

export function ChargesList({
  scope,
  student,
  onClearStudent,
}: {
  scope: SpaceScope;
  student: StudentFilter | null;
  onClearStudent: () => void;
}) {
  const canPay = scope.canWrite('payment.record');
  const canWaive = scope.canWrite('charge.waive');
  const [filter, setFilter] = useState('open');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [payable, setPayable] = useState<Payable | null>(null);
  const [paymentsOf, setPaymentsOf] = useState<Charge | null>(null);
  const [waiving, setWaiving] = useState<Charge | null>(null);

  const rangeInvalid = dueFrom !== '' && dueTo !== '' && dueFrom > dueTo;
  const params: ListSubscriptionChargesParams = {
    ...FILTERS[filter]?.params,
    ...(student ? { subscriptionId: student.subscriptionId } : {}),
    ...(dueFrom ? { dueFrom } : {}),
    ...(dueTo ? { dueTo } : {}),
    limit: PAGE_SIZE,
  };
  const query = useInfiniteQuery({
    queryKey: [...getListSubscriptionChargesQueryKey(scope.spaceId, params), 'list'],
    enabled: !rangeInvalid,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listSubscriptionCharges(scope.spaceId, {
        ...params,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totalDue = query.data?.pages[0]?.totalDueCents ?? 0;

  function exportCsv() {
    const { header, rows } = chargesCsvRows(items, (s) => CHARGE_STATUS[s].label);
    downloadCsv('mensalidades.csv', toCsv(header, rows));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
          <Field label="Situação" htmlFor="charges-filter">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger id="charges-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FILTERS).map(([value, f]) => (
                  <SelectItem key={value} value={value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vencimento" group>
            <DateRangePicker
              from={dueFrom}
              to={dueTo}
              fromLabel="Vence de"
              toLabel="Vence até"
              onValueChange={({ from, to }) => {
                setDueFrom(from);
                setDueTo(to);
              }}
            />
          </Field>
        </div>
        <Button variant="outline" disabled={items.length === 0} onClick={exportCsv}>
          <Download /> Baixar CSV
        </Button>
      </div>

      {student ? (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="info" data-testid="student-filter">
            Aluno: {student.name}
          </Badge>
          <Button size="sm" variant="ghost" onClick={onClearStudent}>
            <X /> Limpar
          </Button>
        </div>
      ) : null}

      {rangeInvalid ? (
        <EmptyState
          title="Período inválido"
          description="A data inicial precisa ser igual ou anterior à data final."
        />
      ) : query.isPending ? (
        <LoadingBlock rows={5} label="Carregando mensalidades" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardLabel>Falta receber (com os filtros)</CardLabel>
            </CardHeader>
            <CardContent>
              <p
                className="font-display text-4xl font-bold tabular-nums"
                data-testid="charges-total-due"
              >
                {formatMoney(totalDue)}
              </p>
            </CardContent>
          </Card>

          {items.length === 0 ? (
            <EmptyState
              title="Nenhuma mensalidade encontrada"
              description="As mensalidades são geradas todo mês para as assinaturas ativas. Ajuste os filtros para ver outras."
            />
          ) : (
            <>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Aluno</TableHead>
                      <TableHead>Mês</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Pago</TableHead>
                      <TableHead className="text-right">Em aberto</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="w-32" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((c) => (
                      <TableRow key={c.id} data-testid="charge-row">
                        <TableCell>
                          <div className="font-medium">{c.student.name}</div>
                          <div className="text-muted-foreground text-xs">{c.plan.name}</div>
                        </TableCell>
                        <TableCell className="tabular-nums">{chargeMonth(c.periodStart)}</TableCell>
                        <TableCell className="tabular-nums">{formatLocalDate(c.dueDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(c.amountCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(c.paidCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(c.dueCents)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge info={CHARGE_STATUS[c.status]} />
                          {c.openOnlineCharge?.method === 'PIX' ? (
                            <Badge variant="muted" className="ml-1.5">
                              Pix aberto
                            </Badge>
                          ) : null}
                          {waiveNote(c) ? (
                            <div className="text-muted-foreground mt-1 text-xs">{waiveNote(c)}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {canPay && canReceiveCharge(c) ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Registrar pagamento de ${c.student.name} (${chargeMonth(c.periodStart)})`}
                              onClick={() =>
                                setPayable({
                                  type: 'SUBSCRIPTION_CHARGE',
                                  id: c.id,
                                  dueCents: c.dueCents,
                                  label: `Mensalidade ${chargeMonth(c.periodStart)} de ${c.student.name}`,
                                  askDate: true,
                                  openOnlineCharge: c.openOnlineCharge,
                                })
                              }
                            >
                              <HandCoins />
                            </Button>
                          ) : null}
                          {c.payments.length > 0 ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Pagamentos de ${c.student.name} (${chargeMonth(c.periodStart)})`}
                              onClick={() => setPaymentsOf(c)}
                            >
                              <ReceiptText />
                            </Button>
                          ) : null}
                          {canWaive && canWaiveCharge(c) ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Dispensar mensalidade de ${c.student.name} (${chargeMonth(c.periodStart)})`}
                              onClick={() => setWaiving(c)}
                            >
                              <Ban />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {query.hasNextPage ? (
                <Button
                  variant="outline"
                  className="w-fit self-center"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </Button>
              ) : null}
            </>
          )}
        </>
      )}

      <PaymentDialog spaceId={scope.spaceId} payable={payable} onClose={() => setPayable(null)} />
      <ChargePaymentsDialog
        scope={scope}
        charge={paymentsOf}
        canReverse={canPay}
        onClose={() => setPaymentsOf(null)}
      />
      <WaiveDialog scope={scope} charge={waiving} onClose={() => setWaiving(null)} />
    </div>
  );
}
