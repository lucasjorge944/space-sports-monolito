'use client';

import {
  getListSpaceRecurringBookingsQueryKey,
  listSpaceRecurringBookings,
  type RecurringBookingDto,
  type RecurringStatus,
  useListCourts,
  useListRecurringConflicts,
} from '@space-sports/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, formatDuration } from '@/lib/format';
import { RECURRING_STATUS, WEEKDAY_SHORT } from '@/lib/painel/labels';
import { RecurringDeskDialog } from './recurring-desk-dialog';
import { RecurringDetailSheet } from './recurring-detail-sheet';

const CURRENT: RecurringStatus[] = ['ACTIVE', 'PAUSED'];
const CLOSED: RecurringStatus[] = ['ENDED', 'REJECTED'];

export function MensalistasView() {
  return (
    <SpaceGate permission="schedule.view">{(scope) => <Mensalistas scope={scope} />}</SpaceGate>
  );
}

function Mensalistas({ scope }: { scope: SpaceScope }) {
  const canCreate = scope.canWrite('booking.create');
  const courts = useListCourts(scope.spaceId);
  const [deskOpen, setDeskOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Contador de solicitações pendentes para destacar a aba.
  const pending = useInfiniteQuery({
    queryKey: [
      ...getListSpaceRecurringBookingsQueryKey(scope.spaceId, { status: ['PENDING_APPROVAL'] }),
      'count',
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: () =>
      listSpaceRecurringBookings(scope.spaceId, { status: ['PENDING_APPROVAL'], limit: 100 }),
    getNextPageParam: () => undefined,
  });
  const pendingCount = pending.data?.pages[0]?.items.length ?? 0;

  // Abre em "Solicitações" quando há pendências, sem atropelar uma aba que a pessoa já escolheu.
  const [tab, setTab] = useState('ativos');
  const chose = useRef(false);
  useEffect(() => {
    if (pendingCount > 0 && !chose.current) setTab('solicitacoes');
  }, [pendingCount]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Mensalistas"
        description="Horários fixos semanais e solicitações."
        actions={
          canCreate ? (
            <Button onClick={() => setDeskOpen(true)}>
              <UserPlus /> Cadastrar mensalista
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          chose.current = true;
          setTab(v);
        }}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="solicitacoes">
            Solicitações{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </TabsTrigger>
          <TabsTrigger value="ativos">Mensalistas</TabsTrigger>
          <TabsTrigger value="conflitos">Conflitos</TabsTrigger>
        </TabsList>

        <TabsContent value="solicitacoes" className="mt-4">
          <RecurringList
            scope={scope}
            statuses={['PENDING_APPROVAL']}
            onOpen={setDetailId}
            emptyTitle="Nenhuma solicitação pendente"
          />
        </TabsContent>
        <TabsContent value="ativos" className="mt-4">
          <RecurringList
            scope={scope}
            statuses={CURRENT}
            closedStatuses={CLOSED}
            onOpen={setDetailId}
            emptyTitle="Nenhum mensalista ainda"
          />
        </TabsContent>
        <TabsContent value="conflitos" className="mt-4">
          <Conflicts scope={scope} />
        </TabsContent>
      </Tabs>

      <RecurringDetailSheet
        scope={scope}
        recurringId={detailId}
        onClose={() => setDetailId(null)}
      />
      <RecurringDeskDialog
        scope={scope}
        courts={courts.data?.items ?? []}
        open={deskOpen}
        onClose={() => setDeskOpen(false)}
      />
    </div>
  );
}

function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function RecurringList({
  scope,
  statuses,
  closedStatuses,
  onOpen,
  emptyTitle,
}: {
  scope: SpaceScope;
  statuses: RecurringStatus[];
  /** Quando informado, mostra o seletor "Ativos / Encerrados e recusados". */
  closedStatuses?: RecurringStatus[];
  onOpen: (id: string) => void;
  emptyTitle: string;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const params = {
    status: showClosed && closedStatuses ? closedStatuses : statuses,
    limit: 50,
    ...(q ? { q } : {}),
  };
  const query = useInfiniteQuery({
    queryKey: [...getListSpaceRecurringBookingsQueryKey(scope.spaceId, params), 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listSpaceRecurringBookings(scope.spaceId, {
        ...params,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items: RecurringBookingDto[] = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Field label="Buscar por nome ou telefone" htmlFor={`rec-q-${statuses.join('-')}`}>
            <Input
              id={`rec-q-${statuses.join('-')}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        {closedStatuses ? (
          <Button variant="outline" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ver ativos e pausados' : 'Ver encerrados e recusados'}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <LoadingBlock rows={4} label="Carregando mensalistas" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={showClosed ? 'Nenhum mensalista encerrado' : emptyTitle} />
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mensalista</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Quadra</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow
                    key={r.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    data-testid="recurring-row"
                    onClick={() => onOpen(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
                  >
                    <TableCell className="font-medium">{r.customer.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {WEEKDAY_SHORT[r.weekday]} {r.startTime.slice(0, 5)} ·{' '}
                      {formatDuration(r.durationMin)}
                    </TableCell>
                    <TableCell>{r.court.name}</TableCell>
                    <TableCell>
                      <StatusBadge info={RECURRING_STATUS[r.status]} />
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
    </div>
  );
}

const CONFLICT_LABEL = {
  BOOKING: 'Reserva',
  CLASS: 'Aula',
  TOURNAMENT: 'Torneio',
  BLOCK: 'Bloqueio',
} as const;

function Conflicts({ scope }: { scope: SpaceScope }) {
  const query = useListRecurringConflicts(scope.spaceId);
  if (query.isPending) return <LoadingBlock rows={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const items = query.data;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhum conflito"
        description="Quando uma ocorrência semanal coincide com bloqueio ou torneio, ela aparece aqui para você resolver."
      />
    );
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ocorrência</TableHead>
            <TableHead>Mensalista</TableHead>
            <TableHead>Quadra</TableHead>
            <TableHead>Coincide com</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="tabular-nums">{formatDateTime(c.startsAt)}</TableCell>
              <TableCell>{c.customer.name}</TableCell>
              <TableCell>{c.court.name}</TableCell>
              <TableCell>{CONFLICT_LABEL[c.conflictsWith]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
