'use client';

import { useListDelinquents } from '@space-sports/api-client';
import { Download, ListFilter } from 'lucide-react';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
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
import { formatLocalDate, formatMoney } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/painel/csv';
import { SUBSCRIPTION_STATUS } from '@/lib/painel/labels';
import { delinquentsCsvRows } from '@/lib/painel/subscriptions';
import type { StudentFilter } from './mensalidades-view';

/** Inadimplentes (RF-CLASS-11): uma linha por assinatura com mensalidade vencida em aberto. */
export function DelinquentsList({
  scope,
  onShowCharges,
}: {
  scope: SpaceScope;
  onShowCharges: (student: StudentFilter) => void;
}) {
  const query = useListDelinquents(scope.spaceId);

  if (query.isPending) return <LoadingBlock rows={4} label="Carregando inadimplentes" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { items, totalOverdueCents, date } = query.data;

  function exportCsv() {
    const { header, rows } = delinquentsCsvRows(items);
    downloadCsv(`inadimplentes-${date}.csv`, toCsv(header, rows));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-stretch gap-3">
        <Card className="min-w-64 flex-1">
          <CardHeader>
            <CardLabel>Vencido em {formatLocalDate(date)}</CardLabel>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p
              className="font-display text-4xl font-bold tabular-nums"
              data-testid="delinquents-total"
            >
              {formatMoney(totalOverdueCents)}
            </p>
            <p className="text-muted-foreground text-sm">
              {items.length} {items.length === 1 ? 'aluno' : 'alunos'} em atraso
            </p>
          </CardContent>
        </Card>
        <Button
          variant="outline"
          className="self-end"
          disabled={items.length === 0}
          onClick={exportCsv}
        >
          <Download /> Baixar CSV
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nenhum aluno inadimplente"
          description="Todas as mensalidades vencidas foram recebidas ou dispensadas."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Vencidas</TableHead>
                <TableHead className="text-right">Valor vencido</TableHead>
                <TableHead>Mais antiga</TableHead>
                <TableHead className="text-right">Atraso</TableHead>
                <TableHead>Assinatura</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.subscriptionId} data-testid="delinquent-row">
                  <TableCell className="font-medium">{d.student.name}</TableCell>
                  <TableCell>{d.plan.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.overdueCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(d.overdueCents)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatLocalDate(d.oldestDueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.daysOverdue} dias</TableCell>
                  <TableCell>
                    <StatusBadge info={SUBSCRIPTION_STATUS[d.subscriptionStatus]} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Ver mensalidades de ${d.student.name}`}
                      onClick={() =>
                        onShowCharges({ subscriptionId: d.subscriptionId, name: d.student.name })
                      }
                    >
                      <ListFilter />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
