import type { OpeningHour } from '@space-sports/api-client';
import { formatMinutes, openingWindowMinutes } from '@/lib/datetime';

const DAY_MINUTES = 24 * 60;
const SLOT_MINUTES = 30;
const MIN_DURATION_MIN = 30;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * Horários de início possíveis no dia da semana, de 30 em 30 min, de modo que a duração inteira
 * caiba no funcionamento (RN-BOOK-02). O servidor valida de novo.
 *
 * O período vai de `opensAt` por `(closesAt − opensAt + 1440) % 1440 || 1440` minutos, então
 * 08:00–00:00 e 18:00–02:00 funcionam. Um início depois das 24h de um período cai no dia
 * seguinte: a API grava o mensalista com o `weekday` do dia civil em que o jogo começa e o
 * `startTime` local (`zonedToUtc(data do weekday, startTime)`, validada com o período da
 * véspera). Por isso 18:00–02:00 na sexta dá 00:30 em `weekday` = sábado.
 */
export function startTimesFor(
  hours: OpeningHour[],
  weekday: number,
  durationMin: number,
): string[] {
  const out = new Set<string>();
  for (const h of hours) {
    const open = toMinutes(h.opensAt);
    const lastStart = open + openingWindowMinutes(h.opensAt, h.closesAt) - durationMin;
    for (let m = Math.ceil(open / SLOT_MINUTES) * SLOT_MINUTES; m <= lastStart; m += SLOT_MINUTES) {
      if ((h.weekday + Math.floor(m / DAY_MINUTES)) % 7 === weekday) out.add(formatMinutes(m));
    }
  }
  return [...out].sort();
}

/** Dias da semana (0 = domingo) com ao menos um início possível, inclusive os que só têm a madrugada do período da véspera. */
export function openWeekdays(hours: OpeningHour[]): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => startTimesFor(hours, d, MIN_DURATION_MIN).length > 0);
}
