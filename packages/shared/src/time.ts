/** Fuso padrão dos espaços (as datas ficam em UTC no banco e são exibidas neste fuso). */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const MINUTE_MS = 60_000;

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

/**
 * Instante UTC (ms) de ano, mês (1–12), dia e hora, como `Date.UTC`, mas com o ano literal:
 * `Date.UTC` trata os anos 0 a 99 como 1900 a 1999 (BUG-MCP2-2). Mês, dia, hora e minuto fora
 * da faixa transbordam como no `Date.UTC` (minuto 600 = 10:00).
 */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** `YYYY-MM-DD` de uma data, com o ano em (pelo menos) 4 dígitos. */
function formatDate(year: number, month: number, day: number): string {
  const pad = (value: number, size: number) => String(value).padStart(size, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Diferença (ms) entre a hora local do fuso e o UTC no instante. */
function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = utcMs(p.year, p.month, p.day, p.hour, p.minute, p.second);
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
  const naive = utcMs(y, m, d, 0, minuteOfDay);
  const guess = naive - offsetMs(naive, timeZone);
  return new Date(naive - offsetMs(guess, timeZone));
}

/** Data/hora locais de um instante no fuso. */
export function utcToZoned(instant: Date, timeZone: string): ZonedTime {
  const p = zonedParts(instant.getTime(), timeZone);
  return {
    date: formatDate(p.year, p.month, p.day),
    minuteOfDay: p.hour * 60 + p.minute,
    weekday: new Date(utcMs(p.year, p.month, p.day)).getUTCDay(),
  };
}

/**
 * Soma dias a uma data `YYYY-MM-DD` (calendário gregoriano, inclusive nos anos 0000 a 0099).
 * Resultado fora de 0000-01-01 a 9999-12-31: `RangeError`.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  const result = new Date(utcMs(y, m, d + days));
  const year = result.getUTCFullYear();
  if (!(year >= 0 && year <= 9999)) {
    throw new RangeError(`data fora de 0000-01-01 a 9999-12-31: ${date} + ${days} dias`);
  }
  return formatDate(year, result.getUTCMonth() + 1, result.getUTCDate());
}

/** A mais tarde de duas datas `YYYY-MM-DD`. */
export function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Dia da semana (0 = domingo) de uma data `YYYY-MM-DD`. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseDate(date);
  return new Date(utcMs(y, m, d)).getUTCDay();
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
