'use client';

import {
  superExportMonthlyFeeReportCsv,
  superExportPlatformRevenueCsv,
  useSuperGetMonthlyFeeReport,
  useSuperGetPlatformRevenue,
  useSuperListSpaces,
} from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatLocalDate, formatMoney, formatSignedMoney } from '@/lib/format';
import { ONLINE_METHOD_LONG_LABEL } from '@/lib/painel/labels';
import { downloadTextFile } from '@/lib/super/csv';
import {
  defaultReportMonth,
  defaultRevenueRange,
  grossFeeShare,
  monthLabel,
  nfseCsvFilename,
  type RevenueRow,
  type RevenueSortKey,
  recentMonths,
  revenueCsvFilename,
  sortRevenue,
} from '@/lib/super/online-payments';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { StatCard } from '../stat-card';

type Method = 'PIX' | 'CARD';

/** Receita da plataforma (RF-ONPAY-11): pela data de cada lançamento; sem gráfico (a tabela responde). */
export function RevenueTab() {
  const [range, setRange] = useState(defaultRevenueRange);
  const [spaceId, setSpaceId] = useState('');
  const [method, setMethod] = useState<'' | Method>('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [reportOpen, setReportOpen] = useState(false);

  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const params = {
    from: range.from,
    to: range.to,
    ...(spaceId ? { spaceId } : {}),
    ...(method ? { method } : {}),
  };
  const revenue = useSuperGetPlatformRevenue(params, {
    query: { enabled: valid, placeholderData: keepPreviousData },
  });
  const spaces = useSuperListSpaces({ pageSize: 100 });

  async function exportCsv() {
    setExportError(undefined);
    setExporting(true);
    try {
      const csv = await superExportPlatformRevenueCsv(params);
      downloadTextFile(revenueCsvFilename(range.from, range.to), csv);
    } catch (thrown) {
      setExportError(describeError(thrown));
    } finally {
      setExporting(false);
    }
  }

  const data = revenue.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <form
          aria-label="Filtros da receita"
          className="grid flex-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]"
          onSubmit={(e) => e.preventDefault()}
        >
          <Field label="Período" group>
            <DateRangePicker
              from={range.from}
              to={range.to}
              onValueChange={(next) => setRange({ from: next.from, to: next.to })}
            />
          </Field>
          <Field label="Espaço" htmlFor="revenue-space">
            <Select id="revenue-space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              <option value="">Todos os espaços</option>
              {spaces.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Meio" htmlFor="revenue-method">
            <Select
              id="revenue-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as '' | Method)}
            >
              <option value="">Todos</option>
              <option value="PIX">Pix</option>
              <option value="CARD">Cartão</option>
            </Select>
          </Field>
        </form>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!valid || exporting}>
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </Button>
          <Button variant="outline" onClick={() => setReportOpen(true)}>
            <FileText aria-hidden />
            Relatório NFS-e
          </Button>
        </div>
      </div>

      <FormError message={exportError} />
      <FormError
        message={
          valid
            ? undefined
            : 'Informe um período válido: a data inicial não pode ser depois da final.'
        }
      />

      {!valid ? null : revenue.isPending ? (
        <LoadingBlock />
      ) : revenue.isError ? (
        <ErrorBlock error={revenue.error} onRetry={() => void revenue.refetch()} />
      ) : data ? (
        <div className="flex flex-col gap-6" aria-busy={revenue.isPlaceholderData}>
          <p className="text-muted-foreground text-sm">
            Período: {formatLocalDate(data.period.from)} a {formatLocalDate(data.period.to)}
          </p>
          <section
            aria-label="Totais"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="revenue-totals"
          >
            <StatCard
              label="Volume pago"
              value={formatMoney(data.totals.volumeCents)}
              hint={`${data.totals.chargesCount} pagamentos`}
            />
            <StatCard
              label="Taxa bruta"
              value={formatMoney(data.totals.grossFeeCents)}
              hint={grossFeeShare(data.totals)}
            />
            <StatCard
              label="Tarifa do gateway"
              value={formatSignedMoney(-data.totals.gatewayCostCents)}
            />
            <StatCard
              label="Taxa devolvida"
              value={formatSignedMoney(-data.totals.feeRefundedCents)}
              hint="Estornos e contestações (chargeback)"
            />
            <StatCard
              label="Taxa recobrada"
              value={formatSignedMoney(data.totals.feeRechargedCents)}
              hint="Contestações ganhas pelo espaço"
            />
            <StatCard
              label="Receita líquida"
              value={formatMoney(data.totals.netRevenueCents)}
              hint="bruta − tarifa − devolvida + recobrada"
            />
          </section>

          <Tabs defaultValue="espaco">
            <TabsList>
              <TabsTrigger value="espaco">Por espaço</TabsTrigger>
              <TabsTrigger value="mes">Por mês</TabsTrigger>
              <TabsTrigger value="meio">Por meio</TabsTrigger>
            </TabsList>
            <TabsContent value="espaco" className="mt-4">
              <RevenueTable
                label="Espaço"
                rows={data.bySpace.map((r) => ({
                  ...r,
                  key: r.spaceId,
                  name: (
                    <Link
                      href={`/super/espacos/${r.spaceId}`}
                      className="text-link hover:underline"
                    >
                      {r.spaceName}
                    </Link>
                  ),
                }))}
                totals={data.totals}
              />
            </TabsContent>
            <TabsContent value="mes" className="mt-4">
              <RevenueTable
                label="Mês"
                rows={data.byMonth.map((r) => ({ ...r, key: r.month, name: monthLabel(r.month) }))}
                totals={data.totals}
              />
            </TabsContent>
            <TabsContent value="meio" className="mt-4">
              <RevenueTable
                label="Meio"
                rows={data.byMethod.map((r) => ({
                  ...r,
                  key: r.method,
                  name: ONLINE_METHOD_LONG_LABEL[r.method],
                }))}
                totals={data.totals}
              />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      <NfseReportDialog open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  );
}

const COLUMNS: { key: RevenueSortKey; label: string; money: boolean }[] = [
  { key: 'chargesCount', label: 'Pagamentos', money: false },
  { key: 'volumeCents', label: 'Volume', money: true },
  { key: 'grossFeeCents', label: 'Taxa bruta', money: true },
  { key: 'gatewayCostCents', label: 'Tarifa', money: true },
  { key: 'feeRefundedCents', label: 'Devolvida', money: true },
  { key: 'feeRechargedCents', label: 'Recobrada', money: true },
  { key: 'netRevenueCents', label: 'Líquida', money: true },
];

function RevenueTable({
  label,
  rows,
  totals,
}: {
  label: string;
  rows: (RevenueRow & { key: string; name: React.ReactNode })[];
  totals: RevenueRow;
}) {
  const [sort, setSort] = useState<{ key: RevenueSortKey; dir: 'asc' | 'desc' }>({
    key: 'netRevenueCents',
    dir: 'desc',
  });
  if (rows.length === 0) return <EmptyBlock>Nenhum pagamento online no período.</EmptyBlock>;
  const sorted = sortRevenue(rows, sort.key, sort.dir);
  const cell = (row: RevenueRow, key: RevenueSortKey, money: boolean) =>
    money ? formatMoney(row[key]) : row[key];

  return (
    <div className="rounded-lg border">
      <Table aria-label={`Receita por ${label.toLowerCase()}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            {COLUMNS.map((c) => {
              const active = sort.key === c.key;
              return (
                <TableHead
                  key={c.key}
                  className="text-right"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() =>
                      setSort({
                        key: c.key,
                        dir: active && sort.dir === 'desc' ? 'asc' : 'desc',
                      })
                    }
                  >
                    {c.label}
                    {active ? (
                      sort.dir === 'desc' ? (
                        <ArrowDown className="size-3" aria-hidden />
                      ) : (
                        <ArrowUp className="size-3" aria-hidden />
                      )
                    ) : null}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.key} data-testid="revenue-row">
              <TableCell>{row.name}</TableCell>
              {COLUMNS.map((c) => (
                <TableCell key={c.key} className="text-right tabular-nums">
                  {cell(row, c.key, c.money)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="font-medium">
            <TableCell>Total</TableCell>
            {COLUMNS.map((c) => (
              <TableCell key={c.key} className="text-right tabular-nums">
                {cell(totals, c.key, c.money)}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/**
 * Relatório mensal para a NFS-e (decisão 91): o único lugar com o documento completo do cadastro;
 * cada leitura fica na auditoria (`super.payment_report.*`). Base = bruta − devolvida + recobrada.
 */
function NfseReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [month, setMonth] = useState(defaultReportMonth);
  const [show, setShow] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  // Cada leitura do relatório (documento completo) é auditada: só busca quando pedido, sem
  // refazer a consulta ao voltar o foco para a janela.
  const report = useSuperGetMonthlyFeeReport(
    { month },
    {
      query: {
        enabled: open && show,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
      },
    },
  );

  async function download() {
    setError(undefined);
    setDownloading(true);
    try {
      const csv = await superExportMonthlyFeeReportCsv({ month });
      downloadTextFile(nfseCsvFilename(month), csv);
    } catch (thrown) {
      setError(describeError(thrown));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setShow(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Relatório para NFS-e</DialogTitle>
          <DialogDescription>
            Taxas por espaço no mês, com o documento completo do cadastro no gateway. Cada consulta
            e cada download ficam registrados na auditoria.
          </DialogDescription>
        </DialogHeader>
        <Field label="Mês" htmlFor="nfse-month">
          <Select
            id="nfse-month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setShow(false);
            }}
          >
            {recentMonths().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <FormError message={error} />
        {show ? (
          report.isPending ? (
            <LoadingBlock rows={3} />
          ) : report.isError ? (
            <ErrorBlock error={report.error} onRetry={() => void report.refetch()} />
          ) : report.data.items.length === 0 ? (
            <EmptyBlock>Nenhuma taxa no mês.</EmptyBlock>
          ) : (
            <div className="rounded-lg border">
              <Table aria-label="Relatório para NFS-e">
                <TableHeader>
                  <TableRow>
                    <TableHead>Espaço</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead className="text-right">Taxa bruta</TableHead>
                    <TableHead className="text-right">Devolvida</TableHead>
                    <TableHead className="text-right">Recobrada</TableHead>
                    <TableHead className="text-right">Base da nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.items.map((item) => (
                    <TableRow key={item.spaceId} data-testid="nfse-row">
                      <TableCell>
                        {item.spaceName}
                        {item.legalName ? (
                          <span className="text-muted-foreground block text-xs">
                            {item.legalName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {item.document ? `${item.documentType ?? ''} ${item.document}`.trim() : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.grossFeeCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.feeRefundedCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.feeRechargedCents)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(item.invoiceBaseCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : null}
        <DialogFooter>
          {!show ? (
            <Button variant="outline" onClick={() => setShow(true)}>
              Ver relatório
            </Button>
          ) : null}
          <Button onClick={download} disabled={downloading}>
            {downloading ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            Baixar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
