import { addDays, DEFAULT_TIME_ZONE, utcToZoned, weekdayOf } from '@space-sports/shared';

export const WEEKDAY_NAMES = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

const MONTH_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Hora local `HH:MM` de um instante ISO no fuso do espaço. */
export function formatTime(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  let fmt = timeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

/** `2026-11-02` → 2, 11, 2026 (sem passar por `Date` local, para não mudar de dia com o fuso). */
function dateParts(date: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return { year, month, day };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `2026-11-02` → "02/11/2026": o formato de toda data exibida no app. */
export function formatDate(date: string): string {
  const { year, month, day } = dateParts(date);
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** `2026-11-02` → "Seg, 02/11/2026". */
export function formatDayShort(date: string): string {
  return `${WEEKDAY_SHORT[weekdayOf(date)]}, ${formatDate(date)}`;
}

/**
 * `2026-11-02` → "Seg, 02/11": sem o ano, só nos chips de data da reserva, em que a janela é curta
 * e a linha não fica ambígua. Em qualquer outro lugar, use `formatDayShort`.
 */
export function formatDayCompact(date: string): string {
  const { month, day } = dateParts(date);
  return `${WEEKDAY_SHORT[weekdayOf(date)]}, ${pad(day)}/${pad(month)}`;
}

/** `2026-11-02` → "Segunda, 02/11/2026". */
export function formatDayLong(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${formatDate(date)}`;
}

/** "13/11/2026" de um instante ISO no fuso do espaço. */
export function formatInstantDate(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return formatDate(utcToZoned(new Date(iso), timeZone).date);
}

/** "29/10/2026, 19:00" de um instante ISO no fuso do espaço (central de notificações, prazos). */
export function formatDateTime(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return `${formatInstantDate(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

/** `2026-11-01` → "nov 2026" (competência da mensalidade). */
export function formatMonthYear(date: string): string {
  const { year, month } = dateParts(date);
  return `${MONTH_SHORT[month - 1]} ${year}`;
}

/** "Seg, 02/11/2026 · 10:00 – 11:00" no fuso do espaço. */
export function formatBookingWhen(
  startsAt: string,
  endsAt: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const { date } = utcToZoned(new Date(startsAt), timeZone);
  return `${formatDayShort(date)} · ${formatTime(startsAt, timeZone)} – ${formatTime(endsAt, timeZone)}`;
}

/** 60 → "1h", 90 → "1h30", 30 → "30 min". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
}

/** Data local de hoje no fuso do espaço. */
export function todayIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  return utcToZoned(now, timeZone).date;
}

/** Hoje e os próximos `windowDays` dias (a janela de reserva do espaço). */
export function bookingDates(
  windowDays: number,
  timeZone: string = DEFAULT_TIME_ZONE,
  now: Date = new Date(),
): string[] {
  const today = todayIn(timeZone, now);
  return Array.from({ length: Math.max(windowDays, 0) + 1 }, (_, i) => addDays(today, i));
}

/** 850 → "850 m", 1234 → "1,2 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(Math.round(meters / 10) * 10, 10)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

const DAY_MINUTES = 24 * 60;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export const formatMinutes = (minutes: number) => {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Minutos de funcionamento de um período, contando a virada do dia: 08:00–00:00 → 960,
 * 18:00–02:00 → 480 e 00:00–00:00 (ou abre e fecha na mesma hora) → 1440, o dia inteiro.
 */
export function openingWindowMinutes(opensAt: string, closesAt: string): number {
  return (toMinutes(closesAt) - toMinutes(opensAt) + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES;
}

/** Horários `HH:MM` de 30 em 30 min em `[opensAt, opensAt + janela)`, já normalizados com % 1440. */
export function halfHourSlots(opensAt: string, closesAt: string): string[] {
  const open = toMinutes(opensAt);
  const slots: string[] = [];
  for (
    let m = Math.ceil(open / 30) * 30;
    m < open + openingWindowMinutes(opensAt, closesAt);
    m += 30
  ) {
    slots.push(formatMinutes(m));
  }
  return slots;
}
