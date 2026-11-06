'use client';

import { type ReceivablesTodayDto, useGetReceivablesToday } from '@space-sports/api-client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { type Payable, PaymentDialog } from '@/components/painel/payment-dialog';
import { ExtratoView } from '@/components/painel/recebimentos/extrato-view';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardLabel } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCsvMoney, formatLocalDate, formatMoney, formatTime } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/painel/csv';
import { BOOKING_PAYMENT_STATUS } from '@/lib/painel/labels';
import { STATEMENT_PERMISSION } from '@/lib/painel/statement';

export function RecebimentosView() {
  // A API exige `payment.record` até para consultar o "a receber".
  return (
    <SpaceGate permission="payment.record">{(scope) => <Recebimentos scope={scope} />}</SpaceGate>
  );
}

function Recebimentos({ scope }: { scope: SpaceScope }) {
  const query = useGetReceivablesToday(scope.spaceId, { query: { refetchInterval: 60_000 } });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Recebimentos"
        description="O que ainda falta receber no espaço. Os pagamentos no local são registrados por você; os feitos pelo app entram sozinhos."
        actions={
          query.data ? (
            <Button variant="outline" onClick={() => exportReceivables(query.data)}>
              <Download /> Exportar CSV
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      <Tabs defaultValue="hoje">
        <TabsList>
          <TabsTrigger value="hoje">A receber hoje</TabsTrigger>
          {scope.can(STATEMENT_PERMISSION) ? (
            <TabsTrigger value="extrato">Extrato</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="hoje" className="mt-4 flex flex-col gap-4">
          {query.isPending ? (
            <LoadingBlock rows={4} label="Carregando recebimentos" />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <Today scope={scope} data={query.data} />
          )}
        </TabsContent>
        <TabsContent value="extrato" className="mt-4">
          <ExtratoView scope={scope} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function exportReceivables(data: ReceivablesTodayDto) {
  const rows: (string | number)[][] = [
    ...data.items.map(({ booking: b, dueCents }) => [
      'Reserva',
      b.organizer.name,
      b.court.name,
      formatLocalDate(data.date),
      formatTime(b.startsAt),
      formatCsvMoney(b.priceCents),
      formatCsvMoney(dueCents),
    ]),
  ];
  downloadCsv(
    `a-receber-${data.date}.csv`,
    toCsv(['Tipo', 'Cliente', 'Quadra', 'Data', 'Horário', 'Valor (R$)', 'Em aberto (R$)'], rows),
  );
}

function Today({ scope, data }: { scope: SpaceScope; data: ReceivablesTodayDto }) {
  const canPay = scope.canWrite('payment.record');
  const [payable, setPayable] = useState<Payable | null>(null);
  const empty = data.items.length === 0;

  return (
    <>
      <Card>
        <CardHeader>
          <CardLabel>Total a receber hoje ({formatLocalDate(data.date)})</CardLabel>
        </CardHeader>
        <CardContent>
          <p className="font-display text-4xl font-bold tabular-nums" data-testid="total-due">
            {formatMoney(data.totalDueCents)}
          </p>
        </CardContent>
      </Card>

      {empty ? (
        <EmptyState
          title="Nada a receber hoje"
          description="Tudo o que venceu hoje já foi recebido."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Quadra</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                {canPay ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Reserva aguardando pagamento está sendo paga pelo app: não entra no "a receber" (decisão 96). */}
              {data.items
                .filter(({ booking: b }) => b.status !== 'PENDING_PAYMENT')
                .map(({ booking: b, dueCents }) => (
                  <TableRow key={b.id} data-testid="receivable-row">
                    <TableCell className="tabular-nums">Reserva {formatTime(b.startsAt)}</TableCell>
                    <TableCell className="font-medium">{b.organizer.name}</TableCell>
                    <TableCell>{b.court.name}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge info={BOOKING_PAYMENT_STATUS[b.paymentStatus]} />
                        {b.openOnlineCharge?.method === 'PIX' ? (
                          <Badge variant="muted">Pix aberto</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(dueCents)}
                    </TableCell>
                    {canPay ? (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPayable({
                              type: 'BOOKING',
                              id: b.id,
                              dueCents,
                              label: `Reserva de ${b.organizer.name}`,
                              openOnlineCharge: b.openOnlineCharge,
                            })
                          }
                        >
                          Receber
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PaymentDialog spaceId={scope.spaceId} payable={payable} onClose={() => setPayable(null)} />
    </>
  );
}
