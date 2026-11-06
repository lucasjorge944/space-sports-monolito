'use client';

import {
  exportSpaceStatementCsv,
  getGetSpaceStatementQueryKey,
  getSpaceStatement,
  type PaymentMethod,
  type StatementEntry,
  type StatementService,
} from '@space-sports/api-client';
import { PAYMENT_CHANNELS, type PaymentChannel } from '@space-sports/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, NoPermission } from '@/components/painel/states';
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
import { formatDateTime, formatMoney } from '@/lib/format';
import { downloadCsv } from '@/lib/painel/csv';
import { apiErrorMessage } from '@/lib/painel/errors';
import { PAYMENT_CHANNEL_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import {
  defaultStatementRange,
  PAYMENT_METHODS,
  STATEMENT_PERMISSION,
  STATEMENT_SERVICE_LABEL,
  splitReversed,
  statementBounds,
  statementCsvFilename,
  statementEntryLabel,
  withBom,
} from '@/lib/painel/statement';

const ALL = 'all';

/** Aba "Extrato" de Recebimentos (RF-PAY-03): pagamentos registrados por período, forma e serviço. */
export function ExtratoView({
  scope,
  defaultService,
}: {
  scope: SpaceScope;
  /** Serviço já filtrado ao abrir (ex.: mensalidades de aula). */
  defaultService?: StatementService;
}) {
  if (!scope.can(STATEMENT_PERMISSION)) return <NoPermission />;
  return <Extrato scope={scope} defaultService={defaultService} />;
}

function Extrato({
  scope,
  defaultService,
}: {
  scope: SpaceScope;
  defaultService: StatementService | undefined;
}) {
  const [range, setRange] = useState(defaultStatementRange);
  const [method, setMethod] = useState(ALL);
  const [service, setService] = useState<string>(defaultService ?? ALL);
  const [channel, setChannel] = useState(ALL);
  const [exporting, setExporting] = useState(false);

  const bounds = statementBounds(range.from, range.to);
  const filters = {
    ...(method !== ALL ? { method: method as PaymentMethod } : {}),
    ...(service !== ALL ? { service: service as StatementService } : {}),
    ...(channel !== ALL ? { channel: channel as PaymentChannel } : {}),
  };

  const query = useInfiniteQuery({
    queryKey: [
      ...getGetSpaceStatementQueryKey(scope.spaceId, {
        from: bounds?.from ?? '',
        to: bounds?.to ?? '',
        ...filters,
        limit: 50,
      }),
      'list',
    ],
    enabled: bounds !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getSpaceStatement(scope.spaceId, {
        from: bounds?.from ?? '',
        to: bounds?.to ?? '',
        ...filters,
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  // Totais e por forma valem para o período inteiro e vêm iguais em todas as páginas.
  const summary = query.data?.pages[0];
  const { active, reversed } = splitReversed(items);

  async function exportCsv() {
    if (!bounds) return;
    setExporting(true);
    try {
      const csv = await exportSpaceStatementCsv(scope.spaceId, { ...bounds, ...filters });
      downloadCsv(statementCsvFilename(range.from, range.to), withBom(csv));
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Período" group>
            <DateRangePicker
              from={range.from}
              to={range.to}
              onValueChange={(next) => next.from && next.to && setRange(next)}
            />
          </Field>
          <Field label="Forma de pagamento" htmlFor="x-method">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="x-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Serviço" htmlFor="x-service">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger id="x-service" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {(Object.keys(STATEMENT_SERVICE_LABEL) as StatementService[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATEMENT_SERVICE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Canal" htmlFor="x-channel">
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger id="x-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {PAYMENT_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {PAYMENT_CHANNEL_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button variant="outline" disabled={!bounds || exporting} onClick={() => void exportCsv()}>
          <Download /> {exporting ? 'Gerando…' : 'Baixar CSV'}
        </Button>
      </div>

      {!bounds ? (
        <EmptyState
          title="Período inválido"
          description="A data inicial precisa ser igual ou anterior à data final."
        />
      ) : query.isPending ? (
        <LoadingBlock rows={5} label="Carregando extrato" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {summary ? (
            <div className="grid gap-3 md:grid-cols-[2fr_3fr]">
              <Card>
                <CardHeader>
                  <CardLabel>Total recebido</CardLabel>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  <p
                    className="font-display text-4xl font-bold tabular-nums"
                    data-testid="statement-total"
                  >
                    {formatMoney(summary.totals.receivedCents)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {summary.totals.paymentsCount}{' '}
                    {summary.totals.paymentsCount === 1 ? 'pagamento' : 'pagamentos'}
                    {summary.totals.reversedCents > 0 ? (
                      <>
                        {' · '}
                        <span data-testid="statement-reversed-total">
                          {formatMoney(summary.totals.reversedCents)} estornados
                        </span>
                      </>
                    ) : null}
                  </p>
                  {summary.byChannel.length > 0 ? (
                    <dl className="text-muted-foreground flex flex-wrap gap-x-4 text-sm">
                      {PAYMENT_CHANNELS.flatMap((c) => {
                        const row = summary.byChannel.find((b) => b.channel === c);
                        return row
                          ? [
                              <div
                                key={c}
                                className="flex gap-1"
                                data-testid="statement-by-channel"
                              >
                                <dt>{PAYMENT_CHANNEL_LABEL[c]}:</dt>
                                <dd className="text-foreground font-medium tabular-nums">
                                  {formatMoney(row.receivedCents)}
                                </dd>
                              </div>,
                            ]
                          : [];
                      })}
                    </dl>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardLabel>Por forma de pagamento</CardLabel>
                </CardHeader>
                <CardContent>
                  {summary.byMethod.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Nenhum recebimento no período.</p>
                  ) : (
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {PAYMENT_METHODS.flatMap((m) => {
                        const row = summary.byMethod.find((b) => b.method === m);
                        return row
                          ? [
                              <div key={m} data-testid="statement-by-method">
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
            </div>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              title="Nenhum pagamento no período"
              description="Ajuste as datas ou os filtros para ver outros recebimentos."
            />
          ) : (
            <>
              {active.length > 0 ? (
                <EntriesTable entries={active} label="Pagamentos" testId="statement-row" />
              ) : null}
              {reversed.length > 0 ? (
                <section className="flex flex-col gap-2" aria-labelledby="estornos">
                  <h2 id="estornos" className="text-lg font-semibold">
                    Estornos
                  </h2>
                  <EntriesTable
                    entries={reversed}
                    label="Estornos"
                    testId="statement-reversal-row"
                    reversed
                  />
                </section>
              ) : null}
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
    </div>
  );
}

function EntriesTable({
  entries,
  label,
  testId,
  reversed = false,
}: {
  entries: StatementEntry[];
  label: string;
  testId: string;
  reversed?: boolean;
}) {
  return (
    <div className="rounded-lg border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>Pago em</TableHead>
            <TableHead>Serviço</TableHead>
            <TableHead>Referência</TableHead>
            <TableHead>Pagador</TableHead>
            <TableHead>Forma</TableHead>
            <TableHead>Canal</TableHead>
            <TableHead>Registrado por</TableHead>
            {reversed ? <TableHead>Estornado em</TableHead> : null}
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id} data-testid={testId}>
              <TableCell className="tabular-nums">{formatDateTime(e.paidAt)}</TableCell>
              <TableCell>{STATEMENT_SERVICE_LABEL[e.service]}</TableCell>
              <TableCell>{statementEntryLabel(e)}</TableCell>
              <TableCell>{e.payerName ?? '—'}</TableCell>
              <TableCell>{PAYMENT_METHOD_LABEL[e.method]}</TableCell>
              <TableCell>
                <Badge variant="muted">{PAYMENT_CHANNEL_LABEL[e.channel]}</Badge>
              </TableCell>
              {/* Pagamento online não tem quem registrou (RN-ONPAY-04). */}
              <TableCell>
                {e.recordedByName ?? (e.channel === 'ONLINE' ? 'Pelo app' : '—')}
              </TableCell>
              {reversed ? (
                <TableCell className="tabular-nums">
                  {e.reversedAt ? formatDateTime(e.reversedAt) : '—'}
                </TableCell>
              ) : null}
              <TableCell className="text-right tabular-nums">
                {formatMoney(e.amountCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
