import { formatCents } from '@space-sports/api-client';
import { DEFAULT_TIME_ZONE, maskPhone, utcToZoned } from '@space-sports/shared';
import { WEEKDAY_SHORT } from '@/lib/painel/labels';

/** Fuso de exibição (datas vêm em UTC da API). */
export const DISPLAY_TIME_ZONE = DEFAULT_TIME_ZONE;

/** Centavos (inteiro, como vem da API) → "R$ 150,00". */
export const formatMoney = formatCents;

const dateParts = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
const timeParts = { hour: '2-digit', minute: '2-digit' } as const;

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DISPLAY_TIME_ZONE,
  ...dateParts,
  ...timeParts,
});
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: DISPLAY_TIME_ZONE, ...dateParts });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: DISPLAY_TIME_ZONE, ...timeParts });
const shortDateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
});

/** Instante UTC (ISO) → "28/10/2026, 14:30" em America/Sao_Paulo. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateTimeFmt.format(new Date(iso));
}

/** Instante UTC (ISO) → "28/10/2026" em America/Sao_Paulo. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(new Date(iso));
}

/** Instante UTC (ISO) → "14:30" em America/Sao_Paulo. */
export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** Instante UTC (ISO) → "08/11" (dia e mês) em America/Sao_Paulo. */
export function formatShortDate(iso: string): string {
  return shortDateFmt.format(new Date(iso));
}

/** Instante UTC (ISO) → "08/11 18:42" em America/Sao_Paulo. */
export function formatShortDateTime(iso: string): string {
  return `${formatShortDate(iso)} ${formatTime(iso)}`;
}

/**
 * Centavos com sinal tipográfico (docs/05, "Pagamento online"): `+ R$ 120,00`, `− R$ 4,80` (menos
 * U+2212 e espaço fino inseparável antes do `R$`, para o sinal não quebrar a linha). Zero sai sem
 * sinal.
 */
export function formatSignedMoney(cents: number): string {
  if (cents === 0) return formatMoney(0);
  return `${cents > 0 ? '+' : '\u2212'}\u202f${formatMoney(Math.abs(cents))}`;
}

/** Dia local ("2026-10-28", sem hora) → "28/10/2026", sem passar por fuso. */
export function formatLocalDate(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

/** Dia local → "Qua, 28/10/2026". */
export function formatDayLabel(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return `${WEEKDAY_SHORT[weekday]}, ${formatLocalDate(day)}`;
}

/** Hoje em America/Sao_Paulo como "AAAA-MM-DD" (formato dos filtros de período da API). */
export function todayLocal(now: Date = new Date()): string {
  return utcToZoned(now, DISPLAY_TIME_ZONE).date;
}

/** Primeiro dia do mês corrente em America/Sao_Paulo. */
export function startOfMonthLocal(now: Date = new Date()): string {
  return `${todayLocal(now).slice(0, 8)}01`;
}

/** Duração em minutos → `1h30`, `2h`, `45min`. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Centavos → coluna de CSV (`15050` → `150,50`), sem o símbolo da moeda. */
export function formatCsvMoney(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** E.164 brasileiro → `(31) 99999-8888`; outros números voltam como vieram. */
export function formatPhone(e164: string | null | undefined): string {
  return e164 ? maskPhone(e164) : '';
}
