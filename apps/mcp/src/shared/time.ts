import { DEFAULT_TIME_ZONE, utcToZoned, zonedToUtc } from '@space-sports/shared';
import { z } from 'zod';

/** Data local `YYYY-MM-DD` válida (inclusive 29/02 só nos anos bissextos). */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Data inválida');

/**
 * Data local `YYYY-MM-DD` entre `min` e `max` (inclusive): os filtros de período das tools, com a
 * faixa que a API aceita (`ANALYTICS_MIN_DATE`/`PERIOD_MIN_DATE` a `…_MAX_DATE` de
 * `@space-sports/shared`), para a tool recusar antes de chamar a API.
 */
export const dateBetween = (min: string, max: string) =>
  localDateSchema.refine(
    (value) => value >= min && value <= max,
    `Use uma data entre ${min} e ${max}`,
  );

/** Hora local `HH:mm`. */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm (24 horas)');

/** Data e hora locais de um instante, no fuso do espaço. */
export interface LocalDateTime {
  date: string;
  time: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function minutesToTime(minuteOfDay: number): string {
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

export function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Instante (ISO/Date) → data e hora locais no fuso (padrão America/Sao_Paulo). */
export function toLocal(instant: string | Date, timeZone = DEFAULT_TIME_ZONE): LocalDateTime {
  const zoned = utcToZoned(new Date(instant), timeZone);
  return { date: zoned.date, time: minutesToTime(zoned.minuteOfDay) };
}

/** Data `YYYY-MM-DD` + hora `HH:mm` locais → instante UTC. */
export function fromLocal(date: string, time: string, timeZone = DEFAULT_TIME_ZONE): Date {
  return zonedToUtc(date, timeToMinutes(time), timeZone);
}

/** Hoje (data local) no fuso. */
export function localToday(now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return utcToZoned(now, timeZone).date;
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? String(weekday);
}
