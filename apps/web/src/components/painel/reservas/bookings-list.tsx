'use client';

import {
  type BookingPaymentStatus,
  type BookingSource,
  type BookingStatus,
  getListSpaceBookingsQueryKey,
  listSpaceBookings,
  useListCourts,
} from '@space-sports/api-client';
import { addDays } from '@space-sports/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BookingDetailSheet } from '@/components/painel/booking-detail-sheet';
import { Field } from '@/components/painel/field';
import { SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
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
import { formatDateTime, formatMoney, formatTime, todayLocal } from '@/lib/format';
import { dayBounds, rangeBounds } from '@/lib/painel/agenda';
import { BOOKING_PAYMENT_STATUS, BOOKING_SOURCE_LABEL, BOOKING_STATUS } from '@/lib/painel/labels';

const ALL = 'all';

export function BookingsList() {
  return <SpaceGate permission="schedule.view">{(scope) => <List scope={scope} />}</SpaceGate>;
}

function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function List({ scope }: { scope: SpaceScope }) {
  // Decisão 53: sem `payment.record`, a API não manda valores nem filtra por pagamento.
  const canSeeMoney = scope.can('payment.record');
  const today = todayLocal();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, 30));
  const [courtId, setCourtId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [payment, setPayment] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [detailId, setDetailId] = useState<string | null>(null);

  const courts = useListCourts(scope.spaceId);
  const bounds = from <= to ? rangeBounds(from, to) : dayBounds(from);

  // Reservas avulsas: as de mensalista ficam em Reservas → Mensalistas.
  const sources: BookingSource[] = source === ALL ? ['APP', 'DESK'] : [source as BookingSource];
  const params = {
    from: bounds.from,
    to: bounds.to,
    source: sources,
    limit: 25,
    ...(courtId !== ALL ? { courtId } : {}),
    ...(status !== ALL ? { status: [status as BookingStatus] } : {}),
    ...(payment !== ALL ? { paymentStatus: [payment as BookingPaymentStatus] } : {}),
    ...(q ? { q } : {}),
  };

  const query = useInfiniteQuery({
    queryKey: [...getListSpaceBookingsQueryKey(scope.spaceId, params), 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listSpaceBookings(scope.spaceId, { ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reservas avulsas" description="Reservas feitas pelo app ou no balcão." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="sm:col-span-2">
          <Field label="Período" group>
            <DateRangePicker
              from={from}
              to={to}
              onValueChange={(next) => {
                if (!next.from || !next.to) return;
                setFrom(next.from);
                setTo(next.to);
              }}
            />
          </Field>
        </div>
        <Field label="Quadra" htmlFor="f-court">
          <Select value={courtId} onValueChange={setCourtId}>
            <SelectTrigger id="f-court" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {(courts.data?.items ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Situação" htmlFor="f-status">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="f-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {(Object.keys(BOOKING_STATUS) as BookingStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {BOOKING_STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {canSeeMoney ? (
          <Field label="Pagamento" htmlFor="f-payment">
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger id="f-payment" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {(Object.keys(BOOKING_PAYMENT_STATUS) as BookingPaymentStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {BOOKING_PAYMENT_STATUS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label="Origem" htmlFor="f-source">
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger id="f-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>App e balcão</SelectItem>
              <SelectItem value="APP">{BOOKING_SOURCE_LABEL.APP}</SelectItem>
              <SelectItem value="DESK">{BOOKING_SOURCE_LABEL.DESK}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Cliente ou telefone" htmlFor="f-q">
          <Input
            id="f-q"
            value={search}
            placeholder="Buscar…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </div>

      {query.isPending ? (
        <LoadingBlock rows={6} label="Carregando reservas" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma reserva encontrada"
          description="Ajuste o período ou os filtros para ver outras reservas."
        />
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Quadra</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Situação</TableHead>
                  {canSeeMoney ? (
                    <>
                      <TableHead>Pagamento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow
                    key={b.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    data-testid="booking-row"
                    onClick={() => setDetailId(b.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setDetailId(b.id)}
                  >
                    <TableCell className="tabular-nums">
                      {formatDateTime(b.startsAt)}–{formatTime(b.endsAt)}
                    </TableCell>
                    <TableCell>{b.court.name}</TableCell>
                    <TableCell>{b.organizer.name}</TableCell>
                    <TableCell>{BOOKING_SOURCE_LABEL[b.source]}</TableCell>
                    <TableCell>
                      <StatusBadge info={BOOKING_STATUS[b.status]} />
                      {b.status === 'PENDING_PAYMENT' && b.paymentDueAt ? (
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          Guardado até {formatTime(b.paymentDueAt)}
                        </span>
                      ) : null}
                    </TableCell>
                    {canSeeMoney ? (
                      <>
                        <TableCell>
                          {b.paymentStatus ? (
                            <StatusBadge info={BOOKING_PAYMENT_STATUS[b.paymentStatus]} />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.priceCents !== null ? formatMoney(b.priceCents) : null}
                        </TableCell>
                      </>
                    ) : null}
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

      <BookingDetailSheet scope={scope} bookingId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
