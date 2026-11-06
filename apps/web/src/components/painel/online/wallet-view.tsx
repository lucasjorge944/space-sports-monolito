'use client';

import {
  exportWalletEntriesCsv,
  getListWalletEntriesQueryKey,
  type LedgerEntryPageItemsItem,
  listWalletEntries,
  type MerchantAccount,
  useGetWalletSummary,
  useListWalletPayouts,
  type WalletSummary,
} from '@space-sports/api-client';
import type { LedgerEntryKind, OnlinePaymentMethod } from '@space-sports/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardLabel, CardTitle } from '@/components/ui/card';
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
import {
  formatDateTime,
  formatDayLabel,
  formatMoney,
  formatShortDate,
  formatSignedMoney,
} from '@/lib/format';
import { downloadCsv } from '@/lib/painel/csv';
import { apiErrorMessage } from '@/lib/painel/errors';
import { LEDGER_KIND_LABEL, ONLINE_METHOD_LABEL, PAYOUT_STATUS } from '@/lib/painel/labels';
import {
  barPercent,
  cursorsFor,
  defaultWalletRange,
  LEDGER_FILTERS,
  ledgerDescription,
  type Paging,
  releaseRows,
  WALLET_METHOD_FILTERS,
  WALLET_PAGE_SIZE,
  walletBounds,
  walletCsvFilename,
  walletPageLabel,
} from '@/lib/painel/online-payments';
import { withBom } from '@/lib/painel/statement';
import { cn } from '@/lib/utils';
import { isSandbox, SandboxBanner } from './sandbox';

const ALL = 'all';

/** Aba "Carteira" (RF-ONPAY-07): saldos, a liberar, repasses e lançamentos. */
export function WalletView({
  scope,
  merchant,
  onOpenDisputes,
}: {
  scope: SpaceScope;
  merchant: MerchantAccount;
  onOpenDisputes: () => void;
}) {
  const summary = useGetWalletSummary(scope.spaceId);
  const [kind, setKind] = useState<string>(ALL);
  const [method, setMethod] = useState<string>(ALL);
  const entriesRef = useRef<HTMLElement>(null);

  if (summary.isPending) return <LoadingBlock rows={5} label="Carregando carteira" />;
  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  const data = summary.data;

  return (
    <div className="flex flex-col gap-6" data-testid="wallet">
      <WalletAlerts data={data} onOpenDisputes={onOpenDisputes} />

      <section aria-label="Saldos" className="grid gap-4 md:grid-cols-3">
        <Stat
          label="Disponível"
          value={data.availableCents}
          hint={
            data.payoutsPaused
              ? 'Fica no saldo até a aprovação da nova conta.'
              : 'Entra no próximo repasse automático.'
          }
          testId="wallet-available"
        />
        <Stat
          label="A liberar"
          value={data.pendingCents}
          hint="Vendas ainda no prazo de liberação."
          testId="wallet-pending"
        />
        <Stat
          label="Repassado"
          value={data.paidOutCents}
          hint="Enviado para a conta do espaço desde a ativação."
          testId="wallet-paid-out"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <ReleaseCard upcoming={data.upcoming} />
        <PayoutsCard
          scope={scope}
          payoutMasked={merchant.payoutMasked}
          onSeeAll={() => {
            // Repasse não tem meio: "Ver todos" mostra todos os repasses.
            setKind('PAYOUT');
            setMethod(ALL);
            entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      </div>

      <Entries
        scope={scope}
        kind={kind}
        onKindChange={setKind}
        method={method}
        onMethodChange={setMethod}
        sectionRef={entriesRef}
      />
    </div>
  );
}

function WalletAlerts({
  data,
  onOpenDisputes,
}: {
  data: WalletSummary;
  onOpenDisputes: () => void;
}) {
  const { openDisputes, failedPayouts } = data;
  return (
    <>
      {openDisputes.count > 0 ? (
        <Alert variant="destructive" className="flex flex-wrap items-center gap-x-2">
          <span>
            {openDisputes.count === 1
              ? '1 contestação aguardando resposta'
              : `${openDisputes.count} contestações aguardando resposta`}
            {openDisputes.nextRespondBy
              ? ` até ${formatShortDate(openDisputes.nextRespondBy)}`
              : ''}
            .
          </span>
          <Button variant="link" className="h-auto p-0" onClick={onOpenDisputes}>
            Responder
          </Button>
        </Alert>
      ) : null}
      {failedPayouts.count > 0 ? (
        <Alert variant="destructive">
          {failedPayouts.lastAmountCents !== null
            ? `Um repasse de ${formatMoney(failedPayouts.lastAmountCents)} não foi enviado.`
            : 'Um repasse não foi enviado.'}{' '}
          Confira a conta bancária com o suporte.
        </Alert>
      ) : null}
      {data.payoutsPaused ? (
        <Alert variant="warning" role="status">
          Repasses pausados até a aprovação da nova conta.
        </Alert>
      ) : null}
      {isSandbox(data.paymentEnvironment) ? (
        <SandboxBanner>
          <p>Ambiente de teste: os valores são simulados.</p>
        </SandboxBanner>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: number;
  hint: string;
  testId: string;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader>
        <CardLabel>{label}</CardLabel>
      </CardHeader>
      <CardContent>
        <p className="font-display text-4xl font-bold tabular-nums" data-testid={testId}>
          {formatMoney(value)}
        </p>
        <p className="text-muted-foreground mt-1 text-[13px] leading-[18px]">{hint}</p>
      </CardContent>
    </Card>
  );
}

/**
 * "A liberar por data": lista com barra de apoio (série única, magnitude por data, `chart-1`).
 * O texto de cada linha já tem a data e o valor; a barra é só visual (`aria-hidden`).
 */
function ReleaseCard({ upcoming }: { upcoming: WalletSummary['upcoming'] }) {
  const { rows, rest, max } = releaseRows(upcoming);
  return (
    <Card>
      <CardHeader>
        <CardTitle>A liberar por data</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nada a liberar. Novas vendas aparecem aqui.
          </p>
        ) : (
          <ul className="grid text-sm" data-testid="release-list">
            {rows.map((row) => (
              <ReleaseLine
                key={row.date}
                label={formatDayLabel(row.date).slice(0, 10)}
                amount={row.amountCents}
                max={max}
              />
            ))}
            {rest ? (
              <ReleaseLine
                label={`Depois de ${formatDayLabel(rest.after).slice(5, 10)}`}
                amount={rest.amountCents}
                max={max}
              />
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReleaseLine({ label, amount, max }: { label: string; amount: number; max: number }) {
  const width = barPercent(amount, max);
  return (
    <li className="grid h-9 grid-cols-[6rem_1fr_auto] items-center gap-3">
      <span className="tabular-nums">{label}</span>
      <span className="flex h-2 items-center" aria-hidden>
        {width > 0 ? (
          <span className="bg-chart-1 h-2 min-w-0.5 rounded-[4px]" style={{ width: `${width}%` }} />
        ) : null}
      </span>
      <span className="text-right font-medium tabular-nums">
        {amount > 0 ? formatMoney(amount) : '—'}
      </span>
    </li>
  );
}

function PayoutsCard({
  scope,
  payoutMasked,
  onSeeAll,
}: {
  scope: SpaceScope;
  payoutMasked: string | null;
  onSeeAll: () => void;
}) {
  const payouts = useListWalletPayouts(scope.spaceId, { limit: 5 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repasses</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {payouts.isPending ? (
          <LoadingBlock rows={3} label="Carregando repasses" />
        ) : payouts.isError ? (
          <ErrorState error={payouts.error} onRetry={() => void payouts.refetch()} />
        ) : payouts.data.items.length === 0 ? (
          <p className="text-muted-foreground">Nenhum repasse ainda.</p>
        ) : (
          <ul className="grid gap-2" data-testid="payouts-list">
            {payouts.data.items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="tabular-nums">{formatShortDate(p.paidAt ?? p.scheduledFor)}</span>
                <span className="tabular-nums">{formatMoney(p.amountCents)}</span>
                <StatusBadge info={PAYOUT_STATUS[p.status]} />
              </li>
            ))}
          </ul>
        )}
        <div className="text-muted-foreground flex items-center justify-between gap-2 border-t pt-2">
          <span className="tabular-nums">{payoutMasked ? `Conta ${payoutMasked}` : null}</span>
          <Button variant="ghost" size="sm" onClick={onSeeAll}>
            Ver todos
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Entries({
  scope,
  kind,
  onKindChange,
  method,
  onMethodChange,
  sectionRef,
}: {
  scope: SpaceScope;
  kind: string;
  onKindChange: (kind: string) => void;
  method: string;
  onMethodChange: (method: string) => void;
  sectionRef: React.RefObject<HTMLElement | null>;
}) {
  const [range, setRange] = useState(defaultWalletRange);
  const [exporting, setExporting] = useState(false);
  const bounds = walletBounds(range.from, range.to);
  // O CSV usa os mesmos filtros da tabela (período, tipo e meio).
  const filters = {
    ...(bounds ?? {}),
    ...(kind !== ALL ? { kind: [kind as LedgerEntryKind] } : {}),
    ...(method !== ALL ? { method: method as OnlinePaymentMethod } : {}),
  };
  // Pilha de cursores (a página N usa `cursors[N - 1]`; a API pagina por cursor e manda o total),
  // presa aos filtros: trocar o período, o tipo ou o meio, inclusive pelo "Ver todos", volta à
  // página 1.
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState<Paging>({ key: filterKey, cursors: [undefined] });
  const cursors = cursorsFor(paging, filterKey);
  const setCursors = (next: (c: (string | undefined)[]) => (string | undefined)[]) =>
    setPaging({ key: filterKey, cursors: next(cursors) });
  const page = cursors.length;
  const cursor = cursors.at(-1);
  const params = { ...filters, limit: WALLET_PAGE_SIZE, ...(cursor ? { cursor } : {}) };
  const query = useQuery({
    queryKey: getListWalletEntriesQueryKey(scope.spaceId, params),
    queryFn: () => listWalletEntries(scope.spaceId, params),
    enabled: bounds !== null,
    placeholderData: keepPreviousData,
  });

  async function exportCsv() {
    if (!bounds) return;
    setExporting(true);
    try {
      const csv = await exportWalletEntriesCsv(scope.spaceId, filters);
      downloadCsv(walletCsvFilename(scope.slug, range.from, range.to), withBom(csv));
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section ref={sectionRef} className="flex flex-col gap-3" aria-labelledby="lancamentos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lancamentos" className="text-lg font-semibold">
          Lançamentos
        </h2>
        <Button variant="outline" disabled={!bounds || exporting} onClick={() => void exportCsv()}>
          <Download /> {exporting ? 'Gerando…' : 'Exportar CSV'}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Período" group>
          <DateRangePicker
            from={range.from}
            to={range.to}
            onValueChange={(next) => {
              if (next.from && next.to) {
                setRange(next);
              }
            }}
          />
        </Field>
        <Field label="Tipo" htmlFor="wallet-kind">
          <Select
            value={kind}
            onValueChange={(value) => {
              onKindChange(value);
            }}
          >
            <SelectTrigger id="wallet-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {LEDGER_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Meio" htmlFor="wallet-method">
          <Select value={method} onValueChange={onMethodChange}>
            <SelectTrigger id="wallet-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {WALLET_METHOD_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {!bounds ? (
        <EmptyState
          title="Período inválido"
          description="A data inicial precisa ser igual ou anterior à data final."
        />
      ) : query.isPending ? (
        <LoadingBlock rows={5} label="Carregando lançamentos" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="Nenhum lançamento com esses filtros." />
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={query.isPlaceholderData}>
            <Table aria-label="Lançamentos">
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Meio</TableHead>
                  <TableHead>Libera em</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
          <nav
            aria-label="Paginação dos lançamentos"
            className="flex items-center justify-end gap-3 text-sm"
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              <ChevronLeft aria-hidden /> Anterior
            </Button>
            <span className="text-muted-foreground" data-testid="wallet-page">
              {walletPageLabel(page, query.data.total)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!query.data.nextCursor}
              onClick={() => {
                const next = query.data?.nextCursor;
                if (next) setCursors((c) => [...c, next]);
              }}
            >
              Próxima <ChevronRight aria-hidden />
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

function EntryRow({ entry }: { entry: LedgerEntryPageItemsItem }) {
  const releasesLater = !entry.available && new Date(entry.availableAt).getTime() > Date.now();
  return (
    <TableRow data-testid="ledger-row">
      <TableCell className="tabular-nums">{formatDateTime(entry.createdAt)}</TableCell>
      <TableCell>{LEDGER_KIND_LABEL[entry.kind]}</TableCell>
      <TableCell>{ledgerDescription(entry)}</TableCell>
      <TableCell>{entry.method ? ONLINE_METHOD_LABEL[entry.method] : '—'}</TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {releasesLater ? formatShortDate(entry.availableAt) : '—'}
      </TableCell>
      <TableCell
        className={cn('text-right tabular-nums', entry.amountCents > 0 && 'text-amount-positive')}
      >
        {formatSignedMoney(entry.amountCents)}
      </TableCell>
    </TableRow>
  );
}
