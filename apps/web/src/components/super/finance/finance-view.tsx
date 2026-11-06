'use client';

import {
  superFinanceExportCsv,
  useSuperFinanceSummary,
  useSuperListSpaces,
} from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatLocalDate, formatMoney, startOfMonthLocal, todayLocal } from '@/lib/format';
import { PAYMENT_CHANNEL_LABEL } from '@/lib/painel/labels';
import { downloadTextFile } from '@/lib/super/csv';
import { methodLabel, serviceLabel } from '@/lib/super/labels';
import { PageHeader } from '../page-header';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { StatCard } from '../stat-card';

type Column<T> = { header: string; cell: (row: T) => React.ReactNode; numeric?: boolean };

function BreakdownTable<T>({
  rows,
  columns,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
}) {
  if (rows.length === 0) return <EmptyBlock>Nenhum registro no período.</EmptyBlock>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.header} className={column.numeric ? 'text-right' : undefined}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell
                key={column.header}
                className={column.numeric ? 'text-right tabular-nums' : undefined}
              >
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Financeiro consolidado, só leitura sobre os registros de pagamento dos espaços (RF-SUPER-05). */
export function FinanceView() {
  const [from, setFrom] = useState(startOfMonthLocal);
  const [to, setTo] = useState(todayLocal);
  const [spaceId, setSpaceId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  const validRange = Boolean(from) && Boolean(to) && from <= to;
  const params = { from, to, ...(spaceId ? { spaceId } : {}) };
  const summary = useSuperFinanceSummary(params, {
    query: { enabled: validRange, placeholderData: keepPreviousData },
  });
  const spaces = useSuperListSpaces({ pageSize: 100 });

  async function exportCsv() {
    setExportError(undefined);
    setExporting(true);
    try {
      const csv = await superFinanceExportCsv(params);
      downloadTextFile(`pagamentos-${from}_${to}.csv`, csv);
    } catch (thrown) {
      setExportError(describeError(thrown));
    } finally {
      setExporting(false);
    }
  }

  const data = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financeiro"
        description="Pagamentos dos espaços: os registrados no local e os feitos pelo app. Aqui é só leitura; a taxa de serviço fica em Pagamento online."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!validRange || exporting}>
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </Button>
        }
      />

      <form
        aria-label="Filtros do financeiro"
        className="grid gap-3 sm:grid-cols-[2fr_1fr]"
        onSubmit={(event) => event.preventDefault()}
      >
        <Field label="Período" group>
          <DateRangePicker
            from={from}
            to={to}
            onValueChange={(next) => {
              setFrom(next.from);
              setTo(next.to);
            }}
          />
        </Field>
        <Field label="Espaço" htmlFor="finance-space">
          <Select id="finance-space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
            <option value="">Todos os espaços</option>
            {spaces.data?.items.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>

      <FormError message={exportError} />
      <FormError
        message={
          !validRange
            ? 'Informe um período válido: a data inicial não pode ser depois da final.'
            : undefined
        }
      />

      {!validRange ? null : summary.isPending ? (
        <LoadingBlock />
      ) : summary.isError ? (
        <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-6" aria-busy={summary.isPlaceholderData}>
          <p className="text-muted-foreground text-sm">
            Período: {formatLocalDate(data.period.from)} a {formatLocalDate(data.period.to)}
          </p>
          <section aria-label="Totais" className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Recebido"
              value={formatMoney(data.totals.receivedCents)}
              hint={`${data.totals.paymentsCount} pagamentos`}
            />
            <StatCard label="Estornado" value={formatMoney(data.totals.reversedCents)} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>No local × online</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                rows={data.byChannel}
                rowKey={(row) => row.channel}
                columns={[
                  { header: 'Canal', cell: (row) => PAYMENT_CHANNEL_LABEL[row.channel] },
                  { header: 'Pagamentos', numeric: true, cell: (row) => row.paymentsCount },
                  {
                    header: 'Recebido',
                    numeric: true,
                    cell: (row) => formatMoney(row.receivedCents),
                  },
                ]}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Por espaço</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={data.bySpace}
                  rowKey={(row) => row.spaceId}
                  columns={[
                    { header: 'Espaço', cell: (row) => row.spaceName },
                    { header: 'Pagamentos', numeric: true, cell: (row) => row.paymentsCount },
                    {
                      header: 'Recebido',
                      numeric: true,
                      cell: (row) => formatMoney(row.receivedCents),
                    },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Por serviço</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={data.byService}
                  rowKey={(row) => row.service}
                  columns={[
                    { header: 'Serviço', cell: (row) => serviceLabel[row.service] },
                    { header: 'Pagamentos', numeric: true, cell: (row) => row.paymentsCount },
                    {
                      header: 'Recebido',
                      numeric: true,
                      cell: (row) => formatMoney(row.receivedCents),
                    },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Por forma de pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={data.byMethod}
                  rowKey={(row) => row.method}
                  columns={[
                    { header: 'Forma', cell: (row) => methodLabel[row.method] },
                    { header: 'Pagamentos', numeric: true, cell: (row) => row.paymentsCount },
                    {
                      header: 'Recebido',
                      numeric: true,
                      cell: (row) => formatMoney(row.receivedCents),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
