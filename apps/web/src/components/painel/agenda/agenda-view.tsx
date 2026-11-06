'use client';

import {
  type CourtBlockDto,
  getListSpaceBookingsQueryKey,
  listSpaceBookings,
  type SpaceBookingDto,
  useGetManagedSpace,
  useListCourtBlocks,
  useListCourts,
} from '@space-sports/api-client';
import { addDays, weekdayOf } from '@space-sports/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BookingDetailSheet } from '@/components/painel/booking-detail-sheet';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDayLabel, formatLocalDate, todayLocal } from '@/lib/format';
import {
  dayBounds,
  fetchAllPages,
  gridRange,
  minutesIntoDay,
  rangeBounds,
  weekDates,
} from '@/lib/painel/agenda';
import { type AgendaColumn, AgendaGrid } from './agenda-grid';
import { BlockDialog, type BlockDraft, BlockInfoDialog } from './block-dialogs';
import { DeskBookingDialog, type DeskDraft } from './desk-booking-dialog';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function AgendaView() {
  return (
    <SpaceGate permission="schedule.view" loadingRows={6}>
      {(scope) => <Agenda scope={scope} />}
    </SpaceGate>
  );
}

function Agenda({ scope }: { scope: SpaceScope }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const rawDate = params.get('data');
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : todayLocal();
  const view = params.get('visao') === 'semana' ? 'semana' : 'dia';
  const courtParam = params.get('quadra');

  function navigate(next: { data?: string; visao?: string; quadra?: string | null }) {
    const search = new URLSearchParams(params.toString());
    if (next.data) search.set('data', next.data);
    if (next.visao) search.set('visao', next.visao);
    if (next.quadra === null) search.delete('quadra');
    else if (next.quadra) search.set('quadra', next.quadra);
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  }

  const courtsQuery = useListCourts(scope.spaceId);
  const spaceQuery = useGetManagedSpace(scope.spaceId);

  const courts = useMemo(
    () => (courtsQuery.data?.items ?? []).filter((c) => c.status !== 'INACTIVE'),
    [courtsQuery.data],
  );
  const weekCourt = courts.find((c) => c.id === courtParam) ?? courts[0];

  const days = view === 'semana' ? weekDates(date) : [date];
  const bounds =
    view === 'semana' ? rangeBounds(days[0] as string, days[6] as string) : dayBounds(date);

  const bookingsQuery = useQuery({
    queryKey: [...getListSpaceBookingsQueryKey(scope.spaceId), 'agenda', bounds.from, bounds.to],
    queryFn: () =>
      fetchAllPages((cursor) =>
        listSpaceBookings(scope.spaceId, {
          from: bounds.from,
          to: bounds.to,
          status: ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'],
          limit: 100,
          ...(cursor ? { cursor } : {}),
        }),
      ),
    refetchInterval: 60_000,
  });
  const blocksQuery = useListCourtBlocks(
    scope.spaceId,
    { from: bounds.from, to: bounds.to },
    { query: { refetchInterval: 60_000 } },
  );

  const [detailId, setDetailId] = useState<string | null>(null);
  const [desk, setDesk] = useState<DeskDraft | null>(null);
  const [block, setBlock] = useState<BlockDraft | null>(null);
  const [blockInfo, setBlockInfo] = useState<CourtBlockDto | null>(null);

  const canCreate = scope.canWrite('booking.create');

  const columns: AgendaColumn[] = useMemo(() => {
    if (view === 'semana') {
      if (!weekCourt) return [];
      return days.map((d) => ({
        key: d,
        date: d,
        courtId: weekCourt.id,
        title: formatDayLabel(d),
      }));
    }
    return courts.map((c) => ({
      key: c.id,
      date,
      courtId: c.id,
      title: c.name,
      subtitle: c.status === 'MAINTENANCE' ? 'Em manutenção' : c.covered ? 'Coberta' : 'Descoberta',
      unavailable: c.status === 'MAINTENANCE',
    }));
  }, [view, courts, weekCourt, date, days]);

  const bookings: SpaceBookingDto[] = bookingsQuery.data?.items ?? [];
  const truncated = bookingsQuery.data?.truncated ?? false;
  const blocks: CourtBlockDto[] = blocksQuery.data ?? [];

  const range = useMemo(() => {
    const extra = [...bookings, ...blocks].flatMap((item) =>
      days.map((d) => ({
        startMin: Math.max(0, minutesIntoDay(item.startsAt, d)),
        endMin: Math.min(24 * 60, minutesIntoDay(item.endsAt, d)),
      })),
    );
    return gridRange(
      spaceQuery.data?.openingHours ?? [],
      days.map((d) => weekdayOf(d)),
      extra.filter((e) => e.endMin > e.startMin && e.endMin > 0 && e.startMin < 24 * 60),
    );
  }, [spaceQuery.data?.openingHours, days, bookings, blocks]);

  const loading =
    courtsQuery.isPending ||
    spaceQuery.isPending ||
    bookingsQuery.isPending ||
    blocksQuery.isPending;
  const failed = courtsQuery.error ?? spaceQuery.error ?? bookingsQuery.error ?? blocksQuery.error;
  const title =
    view === 'semana'
      ? `${formatLocalDate(days[0] as string)} a ${formatLocalDate(days[6] as string)}`
      : formatDayLabel(date);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Agenda"
        description={title}
        actions={
          canCreate ? (
            <>
              <Button onClick={() => setDesk({ date, courtId: weekCourt?.id })}>
                <CalendarPlus /> Reserva de balcão
              </Button>
              <Button variant="outline" onClick={() => setBlock({ date, courtId: weekCourt?.id })}>
                <Lock /> Bloquear horário
              </Button>
            </>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={view === 'semana' ? 'Semana anterior' : 'Dia anterior'}
          onClick={() => navigate({ data: addDays(date, view === 'semana' ? -7 : -1) })}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => navigate({ data: todayLocal() })}>
          Hoje
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={view === 'semana' ? 'Próxima semana' : 'Próximo dia'}
          onClick={() => navigate({ data: addDays(date, view === 'semana' ? 7 : 1) })}
        >
          <ChevronRight />
        </Button>
        <DatePicker
          aria-label="Ir para a data"
          className="w-40"
          value={date}
          onValueChange={(d) => d && navigate({ data: d })}
        />
        <Tabs value={view} onValueChange={(v) => navigate({ visao: v })}>
          <TabsList>
            <TabsTrigger value="dia">Dia</TabsTrigger>
            <TabsTrigger value="semana">Semana</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === 'semana' && courts.length > 0 ? (
          <Select value={weekCourt?.id} onValueChange={(v) => navigate({ quadra: v })}>
            <SelectTrigger aria-label="Quadra da semana" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {courts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {loading ? (
        <LoadingBlock rows={6} label="Carregando a agenda" />
      ) : failed ? (
        <ErrorState
          error={failed}
          onRetry={() => {
            void courtsQuery.refetch();
            void spaceQuery.refetch();
            void bookingsQuery.refetch();
            void blocksQuery.refetch();
          }}
        />
      ) : courts.length === 0 ? (
        <EmptyState
          title="Nenhuma quadra cadastrada"
          description="Cadastre as quadras do espaço em Espaço → Quadras para montar a agenda."
        />
      ) : (
        <>
          {truncated ? (
            <Alert variant="warning" className="py-2" data-testid="agenda-truncated">
              Há reservas demais neste período e a lista foi cortada. Reduza o período (use a visão
              do dia) ou veja o restante em Reservas.
            </Alert>
          ) : null}
          {bookings.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma reserva neste período.</p>
          ) : null}
          <AgendaGrid
            columns={columns}
            range={range}
            bookings={bookings}
            blocks={blocks}
            canCreate={canCreate}
            onSlot={(column, startMin) => {
              if (!canCreate) return;
              setDesk({ date: column.date, courtId: column.courtId, startMin });
            }}
            onBooking={(b) => setDetailId(b.id)}
            onBlock={setBlockInfo}
          />
        </>
      )}

      <BookingDetailSheet scope={scope} bookingId={detailId} onClose={() => setDetailId(null)} />
      <DeskBookingDialog
        scope={scope}
        courts={courtsQuery.data?.items ?? []}
        draft={desk}
        onClose={() => setDesk(null)}
      />
      <BlockDialog
        scope={scope}
        courts={courtsQuery.data?.items ?? []}
        draft={block}
        onClose={() => setBlock(null)}
      />
      <BlockInfoDialog
        scope={scope}
        block={blockInfo}
        courtName={courts.find((c) => c.id === blockInfo?.courtId)?.name}
        onClose={() => setBlockInfo(null)}
      />
    </div>
  );
}
