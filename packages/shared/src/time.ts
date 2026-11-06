/** Fuso padrão dos espaços (as datas ficam em UTC no banco e são exibidas neste fuso). */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Intervalo `[start, end)`. */
export interface Interval {
  start: Date;
  end: Date;
}

/** Data e hora locais de um instante em um fuso. */
export interface ZonedTime {
  /** `YYYY-MM-DD` no fuso. */
  date: string;
  /** Minutos desde 00:00 local (0–1439). */
  minuteOfDay: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function zonedParts(instant: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** Diferença (ms) entre a hora local do fuso e o UTC no instante. */
function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

function parseDate(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`data inválida: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Instante UTC de uma data + minutos locais no fuso (`2026-11-02`, 600 → 10:00 local). */
export function zonedToUtc(date: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = parseDate(date);
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const guess = naive - offsetMs(naive, timeZone);
  return new Date(naive - offsetMs(guess, timeZone));
}

/** Data/hora locais de um instante no fuso. */
export function utcToZoned(instant: Date, timeZone: string): ZonedTime {
  const p = zonedParts(instant.getTime(), timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return {
    date,
    minuteOfDay: p.hour * 60 + p.minute,
    weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
  };
}

/** Soma dias a uma data `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A mais tarde de duas datas `YYYY-MM-DD`. */
export function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Dia da semana (0 = domingo) de uma data `YYYY-MM-DD`. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Minutos desde 00:00 de um horário `HH:MM` ou `HH:MM:SS`. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) throw new RangeError(`horário inválido: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
