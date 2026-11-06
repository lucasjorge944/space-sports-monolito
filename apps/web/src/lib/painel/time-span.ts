/** Prazo em linguagem de gente: a API guarda minutos; a tela mostra número + unidade. */

export type TimeUnit = 'MINUTES' | 'HOURS' | 'DAYS';

const MINUTES_IN: Record<TimeUnit, number> = { MINUTES: 1, HOURS: 60, DAYS: 1440 };

export const TIME_UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'MINUTES', label: 'minutos' },
  { value: 'HOURS', label: 'horas' },
  { value: 'DAYS', label: 'dias' },
];

/** Atalhos do controle de prazo, em minutos. */
export const TIME_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 60, label: '1h' },
  { minutes: 180, label: '3h' },
  { minutes: 720, label: '12h' },
  { minutes: 1440, label: '1 dia' },
  { minutes: 2880, label: '2 dias' },
];

export type TimeSpan = { amount: string; unit: TimeUnit };

/** Minutos da API → a maior unidade que os representa sem fração: `2880` → 2 dias, `90` → 90 min. */
export function splitMinutes(minutes: string): TimeSpan {
  const total = /^\d+$/.test(minutes) ? Number(minutes) : null;
  if (total === null) return { amount: '', unit: 'MINUTES' };
  if (total > 0 && total % MINUTES_IN.DAYS === 0)
    return { amount: String(total / MINUTES_IN.DAYS), unit: 'DAYS' };
  if (total > 0 && total % MINUTES_IN.HOURS === 0)
    return { amount: String(total / MINUTES_IN.HOURS), unit: 'HOURS' };
  return { amount: String(total), unit: 'MINUTES' };
}

/** Número + unidade → minutos da API, como texto (o formulário valida); vazio continua vazio. */
export function spanToMinutes({ amount, unit }: TimeSpan): string {
  return /^\d+$/.test(amount) ? String(Number(amount) * MINUTES_IN[unit]) : '';
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** `1500` → `1 dia e 1 hora`; `90` → `1 hora e 30 minutos`; `0` → `0 minutos`. */
export function formatSpan(minutes: number): string {
  const days = Math.floor(minutes / MINUTES_IN.DAYS);
  const hours = Math.floor((minutes % MINUTES_IN.DAYS) / MINUTES_IN.HOURS);
  const rest = minutes % MINUTES_IN.HOURS;
  const parts = [
    days > 0 ? plural(days, 'dia', 'dias') : null,
    hours > 0 ? plural(hours, 'hora', 'horas') : null,
    rest > 0 ? plural(rest, 'minuto', 'minutos') : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return '0 minutos';
  const last = parts.pop();
  return parts.length > 0 ? `${parts.join(', ')} e ${last}` : (last as string);
}

const parse = (minutes: string) => (/^\d+$/.test(minutes) ? Number(minutes) : null);

/** "A lista abre 2 dias antes da aula e fecha 1 hora antes"; `null` com um tempo incompleto. */
export function attendanceWindowSummary(open: string, close: string): string | null {
  const openMin = parse(open);
  const closeMin = parse(close);
  if (openMin === null || closeMin === null) return null;
  if (openMin === 0 && closeMin === 0) return 'A lista abre e fecha na hora da aula';
  const opens = openMin === 0 ? 'na hora da aula' : `${formatSpan(openMin)} antes da aula`;
  const closes = closeMin === 0 ? 'na hora da aula' : `${formatSpan(closeMin)} antes`;
  return `A lista abre ${opens} e fecha ${closes}`;
}

/** "O aluno pode desistir até 3 horas antes da aula"; `null` com o tempo incompleto. */
export function attendanceCancelSummary(deadline: string): string | null {
  const minutes = parse(deadline);
  if (minutes === null) return null;
  return minutes === 0
    ? 'O aluno pode desistir até a hora da aula'
    : `O aluno pode desistir até ${formatSpan(minutes)} antes da aula`;
}
