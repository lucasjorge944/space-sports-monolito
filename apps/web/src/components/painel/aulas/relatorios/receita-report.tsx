'use client';

import {
  exportSpaceStatementCsv,
  useGetSpaceStatement,
  useListDelinquents,
  useListSubscriptionCharges,
} from '@space-sports/api-client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardLabel } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-picker';
import { formatMoney } from '@/lib/format';
import { downloadCsv } from '@/lib/painel/csv';
import { apiErrorMessage } from '@/lib/painel/errors';
import { PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import { PAYMENT_METHODS, statementBounds, withBom } from '@/lib/painel/statement';
import { defaultMonthRange } from '@/lib/painel/subscriptions';
import { Stat } from './stat';

/**
 * Receita das mensalidades de aula no período (RF-CLASS-11): o que foi recebido (extrato do
 * serviço `CLASS`, por data de pagamento), o que vence no período e o vencido hoje.
 */
export function ReceitaReport({ scope }: { scope: SpaceScope }) {
  const [range, setRange] = useState(defaultMonthRange);
  const [exporting, setExporting] = useState(false);
  const bounds = statementBounds(range.from, range.to);

  const received = useGetSpaceStatement(
    scope.spaceId,
    { from: bounds?.from ?? '', to: bounds?.to ?? '', service: 'CLASS', limit: 1 },
    { query: { enabled: bounds !== null } },
  );
  const due = useListSubscriptionCharges(
    scope.spaceId,
    { status: ['PENDING', 'OVERDUE'], dueFrom: range.from, dueTo: range.to, limit: 1 },
    { query: { enabled: bounds !== null } },
  );
  const delinquents = useListDelinquents(scope.spaceId);

  async function exportCsv() {
    if (!bounds) return;
    setExporting(true);
    try {
      const csv = await exportSpaceStatementCsv(scope.spaceId, { ...bounds, service: 'CLASS' });
      downloadCsv(`receita-mensalidades-${range.from}-a-${range.to}.csv`, withBom(csv));
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  const error = received.error ?? due.error ?? delinquents.error;
  const loading = received.isPending || due.isPending || delinquents.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:max-w-md">
          <Field label="Período" group>
            <DateRangePicker
              from={range.from}
              to={range.to}
              onValueChange={(next) => next.from && next.to && setRange(next)}
            />
          </Field>
        </div>
        <Button variant="outline" disabled={!bounds || exporting} onClick={() => void exportCsv()}>
          <Download /> {exporting ? 'Gerando…' : 'Baixar CSV dos recebimentos'}
        </Button>
      </div>

      {!bounds ? (
        <EmptyState
          title="Período inválido"
          description="A data inicial precisa ser igual ou anterior à data final."
        />
      ) : loading ? (
        <LoadingBlock rows={3} label="Carregando receita" />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void received.refetch();
            void due.refetch();
            void delinquents.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Recebido no período"
              value={formatMoney(received.data?.totals.receivedCents ?? 0)}
              hint={`${received.data?.totals.paymentsCount ?? 0} pagamento(s)`}
              testId="revenue-received"
            />
            <Stat
              label="Estornado"
              value={formatMoney(received.data?.totals.reversedCents ?? 0)}
              testId="revenue-reversed"
            />
            <Stat
              label="A receber (vence no período)"
              value={formatMoney(due.data?.totalDueCents ?? 0)}
              testId="revenue-due"
            />
            <Stat
              label="Vencido hoje"
              value={formatMoney(delinquents.data?.totalOverdueCents ?? 0)}
              hint={`${delinquents.data?.items.length ?? 0} aluno(s) inadimplente(s)`}
              testId="revenue-overdue"
            />
          </div>

          <Card>
            <CardHeader>
              <CardLabel>Recebido por forma de pagamento</CardLabel>
            </CardHeader>
            <CardContent>
              {(received.data?.byMethod.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nenhum recebimento de mensalidade no período.
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PAYMENT_METHODS.flatMap((m) => {
                    const row = received.data?.byMethod.find((b) => b.method === m);
                    return row
                      ? [
                          <div key={m} data-testid="revenue-by-method">
                            <dt className="text-muted-foreground text-sm">
                              {PAYMENT_METHOD_LABEL[m]}
                            </dt>
                            <dd className="font-semibold tabular-nums">
                              {formatMoney(row.receivedCents)}
                            </dd>
                            <dd className="text-muted-foreground text-xs">
                              {row.paymentsCount}{' '}
                              {row.paymentsCount === 1 ? 'pagamento' : 'pagamentos'}
                            </dd>
                          </div>,
                        ]
                      : [];
                  })}
                </dl>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
