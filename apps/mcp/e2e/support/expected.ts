// Valores esperados calculados a partir das ESPECIFICAÇÕES do mundo (world.ts), nunca da resposta
// da API: assim o teste não repete a conta do produto (docs/14-mcp.md 8.4).
import {
  BLOCK_A,
  BOOKINGS_A,
  type BookingSpec,
  localDate,
  localInstant,
  localParts,
} from './world.js';

export const COUNTED = new Set<BookingSpec['status']>(['CONFIRMED', 'COMPLETED', 'NO_SHOW']);

const inRange = (day: number, from: string, to: string) => {
  const date = localDate(day);
  return date >= from && date <= to;
};

/** Reservas do espaço A que COMEÇAM no período (datas locais, inclusivas). */
export const bookingsIn = (from: string, to: string) =>
  BOOKINGS_A.filter((b) => inRange(b.day, from, to));

export const countedIn = (from: string, to: string) =>
  bookingsIn(from, to).filter((b) => COUNTED.has(b.status));

export function bookingTotals(from: string, to: string) {
  const counted = countedIn(from, to);
  const cancelled = bookingsIn(from, to).filter((b) => b.status === 'CANCELLED').length;
  return {
    bookings: counted.length,
    hours: counted.reduce((sum, b) => sum + b.durationMin / 60, 0),
    noShows: counted.filter((b) => b.status === 'NO_SHOW').length,
    cancelled,
    cancellationRate:
      counted.length + cancelled === 0 ? null : cancelled / (counted.length + cancelled),
  };
}

/** Pedaços de 30 min de cada reserva que conta, atribuídos à data/hora/dia da semana LOCAIS. */
function bookedSlices(from: string, to: string) {
  const slices: { date: string; hour: number; weekday: number }[] = [];
  for (const booking of BOOKINGS_A.filter((b) => COUNTED.has(b.status))) {
    const start = localInstant(localDate(booking.day), booking.time).getTime();
    for (let offset = 0; offset < booking.durationMin; offset += 30) {
      const parts = localParts(new Date(start + offset * 60_000));
      if (parts.date >= from && parts.date <= to) slices.push(parts);
    }
  }
  return slices;
}

function blockedSlices(from: string, to: string) {
  const start = localInstant(localDate(BLOCK_A.day), BLOCK_A.start).getTime();
  const slices: { date: string; hour: number; weekday: number }[] = [];
  for (let offset = 0; offset < BLOCK_A.hours * 60; offset += 30) {
    const parts = localParts(new Date(start + offset * 60_000));
    if (parts.date >= from && parts.date <= to) slices.push(parts);
  }
  return slices;
}

/** Datas locais de `from` a `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let cursor = new Date(`${from}T12:00:00Z`);
    cursor.toISOString().slice(0, 10) <= to;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    out.push(cursor.toISOString().slice(0, 10));
  }
  return out;
}

/** Ocupação do espaço A (2 quadras, 24 h) por dia da semana (0 = domingo) ou por hora local. */
export function occupancy(from: string, to: string, by: 'weekday' | 'hour') {
  const keys = by === 'weekday' ? [0, 1, 2, 3, 4, 5, 6] : Array.from({ length: 24 }, (_, i) => i);
  const dates = datesBetween(from, to);
  const result = new Map<number, { open: number; blocked: number; booked: number }>();
  for (const key of keys) result.set(key, { open: 0, blocked: 0, booked: 0 });
  for (const date of dates) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (let hour = 0; hour < 24; hour++) {
      const bucket = result.get(by === 'weekday' ? weekday : hour);
      if (bucket) bucket.open += 2; // 2 quadras
    }
  }
  for (const slice of blockedSlices(from, to)) {
    const bucket = result.get(by === 'weekday' ? slice.weekday : slice.hour);
    if (bucket) bucket.blocked += 0.5;
  }
  for (const slice of bookedSlices(from, to)) {
    const bucket = result.get(by === 'weekday' ? slice.weekday : slice.hour);
    if (bucket) bucket.booked += 0.5;
  }
  return result;
}

export const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
