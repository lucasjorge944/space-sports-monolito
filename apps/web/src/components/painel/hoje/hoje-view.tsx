'use client';

import {
  getListSpaceBookingsQueryKey,
  listSpaceBookings,
  type SpaceBookingDto,
  useGetReceivablesToday,
  useListSpaceRecurringBookings,
} from '@space-sports/api-client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { BookingDetailSheet } from '@/components/painel/booking-detail-sheet';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardLabel } from '@/components/ui/card';
import { formatDayLabel, formatMoney, formatTime, todayLocal } from '@/lib/format';
import { dayBounds, fetchAllPages } from '@/lib/painel/agenda';
import { BOOKING_PAYMENT_STATUS, BOOKING_STATUS } from '@/lib/painel/labels';
import { cn, textLink } from '@/lib/utils';

export function HojeView() {
  return <SpaceGate permission="schedule.view">{(scope) => <Hoje scope={scope} />}</SpaceGate>;
}

function Hoje({ scope }: { scope: SpaceScope }) {
  const today = todayLocal();
  const bounds = dayBounds(today);
  const [detailId, setDetailId] = useState<string | null>(null);

  const bookings = useQuery({
    queryKey: [...getListSpaceBookingsQueryKey(scope.spaceId), 'hoje', bounds.from],
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
  const canSeeMoney = scope.can('payment.record');
  const receivables = useGetReceivablesToday(scope.spaceId, { query: { enabled: canSeeMoney } });
  const pending = useListSpaceRecurringBookings(scope.spaceId, {
    status: ['PENDING_APPROVAL'],
    limit: 100,
  });

  const items: SpaceBookingDto[] = [...(bookings.data?.items ?? [])].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Hoje" description={`${formatDayLabel(today)} · ${scope.spaceName}`} />
      <ReadOnlyNotice scope={scope} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardLabel>Reservas hoje</CardLabel>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold tabular-nums">
              {bookings.isSuccess ? items.length : '—'}
            </p>
          </CardContent>
        </Card>
        {canSeeMoney ? (
          <Card>
            <CardHeader>
              <CardLabel>A receber hoje</CardLabel>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-bold tabular-nums">
                {receivables.isSuccess ? formatMoney(receivables.data.totalDueCents) : '—'}
              </p>
              <Link href="/painel/recebimentos" className={cn(textLink, 'text-sm')}>
                Ver recebimentos
              </Link>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardLabel>Solicitações de mensalista</CardLabel>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold tabular-nums">
              {pending.isSuccess ? pending.data.items.length : '—'}
            </p>
            <Link href="/painel/reservas/mensalistas" className={cn(textLink, 'text-sm')}>
              Ver mensalistas
            </Link>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold">Reservas do dia</h2>
        {bookings.data?.truncated ? (
          <Alert variant="warning" className="py-2">
            Há reservas demais hoje e a lista foi cortada. Veja todas em Reservas.
          </Alert>
        ) : null}
        {bookings.isPending ? (
          <LoadingBlock rows={4} label="Carregando reservas do dia" />
        ) : bookings.isError ? (
          <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nenhuma reserva para hoje"
            description="Reservas do app, do balcão e dos mensalistas aparecem aqui."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setDetailId(b.id)}
                  className="hover:bg-accent flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  data-testid="today-booking"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="tabular-nums">
                        {formatTime(b.startsAt)}–{formatTime(b.endsAt)}
                      </span>{' '}
                      · {b.organizer.name}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {b.court.name} · {b.sport.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <StatusBadge info={BOOKING_STATUS[b.status]} />
                    {b.paymentStatus ? (
                      <StatusBadge info={BOOKING_PAYMENT_STATUS[b.paymentStatus]} />
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BookingDetailSheet scope={scope} bookingId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
