'use client';

import type { CourtBlockDto, SpaceBookingDto } from '@space-sports/api-client';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDayLabel, formatTime, todayLocal } from '@/lib/format';
import {
  type GridRange,
  minutesIntoDay,
  minutesToLabel,
  PX_PER_MIN,
  placeInterval,
  SLOT_MIN,
  slotStarts,
} from '@/lib/painel/agenda';
import { cn, focusRing } from '@/lib/utils';

export type AgendaColumn = {
  key: string;
  /** Data local da coluna (`YYYY-MM-DD`). */
  date: string;
  courtId: string;
  title: string;
  subtitle?: string;
  unavailable?: boolean;
};

type Props = {
  columns: AgendaColumn[];
  range: GridRange;
  bookings: SpaceBookingDto[];
  blocks: CourtBlockDto[];
  canCreate: boolean;
  onSlot: (column: AgendaColumn, startMin: number) => void;
  onBooking: (booking: SpaceBookingDto) => void;
  onBlock: (block: CourtBlockDto) => void;
};

function bookingTone(b: SpaceBookingDto): string {
  // Aguardando pagamento online (decisão 85): borda tracejada, o horário está só guardado.
  if (b.status === 'PENDING_PAYMENT') {
    return 'border-[1.5px] border-dashed border-warning-subtle-border bg-warning-subtle';
  }
  if (b.status === 'COMPLETED') return 'border-success bg-success-subtle';
  if (b.status === 'NO_SHOW') return 'border-destructive bg-destructive-subtle';
  if (b.source === 'RECURRING') return 'border-info bg-info-subtle';
  // Sem `payment.record`, a API não diz a situação do pagamento (decisão 53): cor neutra.
  if (b.paymentStatus === null) return 'border-border bg-muted';
  if (b.paymentStatus === 'PAID') return 'border-success bg-success-subtle';
  return 'border-warning bg-warning-subtle';
}

/** Grade de horários: colunas por quadra (dia) ou por dia (semana), 30 min = 36 px. */
export function AgendaGrid({
  columns,
  range,
  bookings,
  blocks,
  canCreate,
  onSlot,
  onBooking,
  onBlock,
}: Props) {
  const slots = slotStarts(range);
  const height = (range.endMin - range.startMin) * PX_PER_MIN;
  const today = todayLocal();
  const [nowMin, setNowMin] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNowMin(minutesIntoDay(new Date().toISOString(), today));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [today]);

  return (
    <div className="isolate overflow-auto rounded-lg border" data-testid="agenda-grid">
      <div className="flex min-w-max">
        <div className="bg-background sticky left-0 z-30 w-14 shrink-0 border-r">
          <div className="h-12 border-b" />
          <div className="relative" style={{ height }}>
            {slots
              .filter((m) => m % 60 === 0)
              .map((m) => (
                <span
                  key={m}
                  className="text-muted-foreground absolute right-2 -translate-y-1/2 text-xs tabular-nums"
                  style={{ top: (m - range.startMin) * PX_PER_MIN }}
                >
                  {minutesToLabel(m)}
                </span>
              ))}
          </div>
        </div>

        {columns.map((column) => {
          const colBookings = bookings.filter(
            (b) =>
              b.court.id === column.courtId &&
              placeInterval(b.startsAt, b.endsAt, column.date, range),
          );
          const colBlocks = blocks.filter(
            (b) =>
              b.courtId === column.courtId &&
              placeInterval(b.startsAt, b.endsAt, column.date, range),
          );
          const isToday = column.date === today;
          return (
            <div key={column.key} className="w-44 shrink-0 border-r last:border-r-0 sm:w-52">
              <div
                className={cn(
                  'bg-background sticky top-0 z-20 flex h-12 flex-col justify-center border-b px-2',
                  // Hoje é estado, não link: a cor de ação (Mar no claro, Sol no escuro).
                  isToday && 'text-primary',
                )}
              >
                <span className={cn('truncate text-sm font-medium', isToday && 'font-semibold')}>
                  {column.title}
                </span>
                {column.subtitle ? (
                  <span className="text-muted-foreground truncate text-xs">{column.subtitle}</span>
                ) : null}
              </div>
              <div
                className={cn('relative', column.unavailable && 'opacity-60')}
                style={{ height }}
              >
                {slots.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={!canCreate}
                    aria-label={`${column.title}, ${minutesToLabel(m)}: novo horário`}
                    onClick={() => onSlot(column, m)}
                    className={cn(
                      'hover:bg-accent absolute inset-x-0 block border-t disabled:cursor-default disabled:hover:bg-transparent',
                      m % 60 === 0 ? 'border-border' : 'border-border border-dashed',
                      focusRing,
                    )}
                    style={{
                      top: (m - range.startMin) * PX_PER_MIN,
                      height: SLOT_MIN * PX_PER_MIN,
                    }}
                  />
                ))}

                {colBlocks.map((block) => {
                  const place = placeInterval(block.startsAt, block.endsAt, column.date, range);
                  if (!place) return null;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      onClick={() => onBlock(block)}
                      className="bg-muted text-muted-foreground absolute inset-x-1 z-10 overflow-hidden rounded-md border border-dashed px-2 py-1 text-left text-xs [background-image:repeating-linear-gradient(135deg,transparent,transparent_6px,var(--border)_6px,var(--border)_7px)]"
                      style={place}
                    >
                      <span className="flex items-center gap-1 font-medium">
                        <Lock className="size-3" aria-hidden /> Bloqueado
                      </span>
                      {block.reason ? <span className="line-clamp-2">{block.reason}</span> : null}
                    </button>
                  );
                })}

                {colBookings.map((booking) => {
                  const place = placeInterval(booking.startsAt, booking.endsAt, column.date, range);
                  if (!place) return null;
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={() => onBooking(booking)}
                      className={cn(
                        'absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-xs',
                        bookingTone(booking),
                        focusRing,
                      )}
                      style={place}
                      data-testid="agenda-booking"
                    >
                      <span className="block truncate font-medium tabular-nums">
                        {formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}
                      </span>
                      <span className="block truncate">{booking.organizer.name}</span>
                      {booking.status === 'PENDING_PAYMENT' ? (
                        <span className="text-warning-subtle-foreground block truncate">
                          Aguardando pagamento
                          {booking.paymentDueAt ? ` · até ${formatTime(booking.paymentDueAt)}` : ''}
                        </span>
                      ) : place.height > 60 ? (
                        <span className="text-muted-foreground block truncate">
                          {booking.source === 'RECURRING' ? 'Mensalista' : booking.sport.name}
                          {booking.paymentStatus === 'PAID' ? ' · pago' : ''}
                        </span>
                      ) : null}
                    </button>
                  );
                })}

                {isToday && nowMin != null && nowMin >= range.startMin && nowMin <= range.endMin ? (
                  <div
                    aria-hidden
                    className="bg-destructive pointer-events-none absolute inset-x-0 z-20 h-px"
                    style={{ top: (nowMin - range.startMin) * PX_PER_MIN }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function weekdayColumnTitle(date: string) {
  return formatDayLabel(date);
}
