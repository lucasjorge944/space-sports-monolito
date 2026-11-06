import { addDays, timeToMinutes, utcToZoned, zonedToUtc } from '@space-sports/shared';
import { DISPLAY_TIME_ZONE } from '@/lib/format';

/** Altura de 1 minuto na grade da agenda (px): 30 min = 36 px. */
export const PX_PER_MIN = 1.2;
export const SLOT_MIN = 30;

export type GridRange = { startMin: number; endMin: number };

/** Faixa mostrada quando o espaço não tem horário de funcionamento cadastrado. */
export const FALLBACK_RANGE: GridRange = { startMin: 6 * 60, endMin: 23 * 60 };

type Hours = { weekday: number; opensAt: string; closesAt: string };

/**
 * Faixa de horas da grade (minutos desde 00:00) cobrindo o funcionamento dos dias mostrados.
 * Fechamento até a meia-noite ou depois (`00:00`, ou `closesAt <= opensAt`) vai até 24:00; a faixa
 * é alinhada à hora cheia. `extra` amplia a faixa para caber reservas fora do horário.
 */
export function gridRange(
  openingHours: readonly Hours[],
  weekdays: readonly number[],
  extra: readonly { startMin: number; endMin: number }[] = [],
): GridRange {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const h of openingHours) {
    if (!weekdays.includes(h.weekday)) continue;
    const opens = timeToMinutes(h.opensAt);
    const closesRaw = timeToMinutes(h.closesAt);
    const closes = closesRaw <= opens ? 24 * 60 : closesRaw;
    start = Math.min(start, opens);
    end = Math.max(end, closes);
  }
  if (!Number.isFinite(start)) {
    start = FALLBACK_RANGE.startMin;
    end = FALLBACK_RANGE.endMin;
  }
  for (const e of extra) {
    start = Math.min(start, e.startMin);
    end = Math.max(end, e.endMin);
  }
  return {
    startMin: Math.floor(start / 60) * 60,
    endMin: Math.min(24 * 60, Math.ceil(end / 60) * 60),
  };
}

/** Início e fim (instantes UTC, ISO) do dia local `date` no fuso do espaço. */
export function dayBounds(date: string): { from: string; to: string } {
  return {
    from: zonedToUtc(date, 0, DISPLAY_TIME_ZONE).toISOString(),
    to: zonedToUtc(addDays(date, 1), 0, DISPLAY_TIME_ZONE).toISOString(),
  };
}

/** Intervalo de datas locais `[first, last]` → instantes UTC (`to` exclusivo). */
export function rangeBounds(firstDate: string, lastDate: string): { from: string; to: string } {
  return { from: dayBounds(firstDate).from, to: dayBounds(lastDate).to };
}

/** Instante ISO (UTC) de uma data local + minutos desde 00:00. */
export function localToIso(date: string, minuteOfDay: number): string {
  return zonedToUtc(date, minuteOfDay, DISPLAY_TIME_ZONE).toISOString();
}

/** Minutos desde 00:00 do dia `date` (pode passar de 1440 ou ser negativo se for outro dia). */
export function minutesIntoDay(iso: string, date: string): number {
  return Math.round(
    (new Date(iso).getTime() - zonedToUtc(date, 0, DISPLAY_TIME_ZONE).getTime()) / 60_000,
  );
}

export type Placement = { top: number; height: number };

/**
 * Posição (px) de um intervalo dentro da coluna do dia, recortada à faixa visível; `null` se
 * ficar totalmente fora (ex.: reserva que atravessa a meia-noite só aparece no dia certo).
 */
export function placeInterval(
  startsAt: string,
  endsAt: string,
  date: string,
  range: GridRange,
): Placement | null {
  const start = Math.max(minutesIntoDay(startsAt, date), range.startMin);
  const end = Math.min(minutesIntoDay(endsAt, date), range.endMin);
  if (end <= start) return null;
  return { top: (start - range.startMin) * PX_PER_MIN, height: (end - start) * PX_PER_MIN };
}

/** Horários de início (minutos) de 30 em 30 dentro da faixa, para o rótulo lateral e a seleção. */
export function slotStarts(range: GridRange): number[] {
  const out: number[] = [];
  for (let m = range.startMin; m < range.endMin; m += SLOT_MIN) out.push(m);
  return out;
}

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Datas locais da semana (domingo a sábado) que contém `date`. */
export function weekDates(date: string): string[] {
  const weekday = utcToZoned(
    zonedToUtc(date, 12 * 60, DISPLAY_TIME_ZONE),
    DISPLAY_TIME_ZONE,
  ).weekday;
  const sunday = addDays(date, -weekday);
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

export const MAX_PAGES = 20;

/**
 * Busca todas as páginas de uma listagem paginada por cursor (a agenda precisa do período inteiro).
 * Para depois de `maxPages` páginas e avisa em `truncated`, para a tela não mostrar um período
 * incompleto como se estivesse completo.
 */
export async function fetchAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  maxPages = MAX_PAGES,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor) return { items, truncated: false };
    cursor = result.nextCursor;
  }
  return { items, truncated: true };
}
