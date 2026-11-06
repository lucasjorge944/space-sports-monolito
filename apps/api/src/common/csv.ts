import { utcToZoned } from '@space-sports/shared';

/** Excel BR: CSV em UTF-8 com BOM. */
export const CSV_BOM = '﻿';

/** Telefone completo não é fórmula: a planilha lê como número, e o `'` estragaria o contato. */
const E164 = /^\+[1-9]\d{7,14}$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-03` ou `2026-03-10` → `03/2026`. */
export function csvMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Instante em UTC como `dd/mm/aaaa hh:mm:ss`, para as colunas `*_em_utc`. */
export function csvUtcDateTime(instant: Date | string): string {
  const iso = new Date(instant).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}`;
}

/** Instante no fuso como `dd/mm/aaaa hh:mm`. */
export function csvLocalDateTime(instant: Date, timeZone: string): string {
  const { date, minuteOfDay } = utcToZoned(instant, timeZone);
  const time = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`;
}

/** Uma linha CSV (CRLF). Texto que começa como fórmula recebe `'` (injeção em planilhas). */
export function csvLine(cells: (string | number)[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) && !E164.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
