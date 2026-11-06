import type { OpeningHour, PublicSpace } from '@space-sports/api-client';
import { weekdayOf } from '@space-sports/shared';
import { todayIn, WEEKDAY_NAMES } from '@/lib/datetime';

/** "Rua A, 10 · Savassi · Belo Horizonte/MG". Só o que estiver preenchido. */
export function formatAddress(address: PublicSpace['address']): string {
  const street = [address.street, address.number].filter(Boolean).join(', ');
  return [street, address.neighborhood, `${address.city.name}/${address.city.state}`]
    .filter(Boolean)
    .join(' · ');
}

/** "08:00–22:00"; abertura e fechamento iguais significam o dia inteiro. */
function hoursRange(opensAt: string, closesAt: string) {
  return opensAt === closesAt ? 'Aberto 24h' : `${opensAt}–${closesAt}`;
}

/** Horário de hoje ("08:00–22:00"); `null` se o espaço não abre hoje. */
export function todayOpeningRange(hours: OpeningHour[], now: Date = new Date()): string | null {
  const weekday = weekdayOf(todayIn(undefined, now));
  const today = hours.find((h) => h.weekday === weekday);
  return today ? hoursRange(today.opensAt, today.closesAt) : null;
}

/** Agrupa os dias com o mesmo horário: "Seg a Sex · 08:00–22:00". */
export function groupOpeningHours(hours: OpeningHour[]): { days: string; range: string }[] {
  const byDay = new Map(hours.map((h) => [h.weekday, hoursRange(h.opensAt, h.closesAt)]));
  const groups: { first: number; last: number; range: string }[] = [];
  for (let day = 0; day < 7; day += 1) {
    const range = byDay.get(day);
    if (!range) continue;
    const last = groups[groups.length - 1];
    if (last && last.range === range && last.last === day - 1) last.last = day;
    else groups.push({ first: day, last: day, range });
  }
  const short = (d: number) => (WEEKDAY_NAMES[d] as string).slice(0, 3);
  return groups.map((g) => ({
    days: g.first === g.last ? short(g.first) : `${short(g.first)} a ${short(g.last)}`,
    range: g.range,
  }));
}
