import { minutesToLabel } from '@/lib/painel/agenda';

/** Horários de 30 em 30 min entre `from` e `to` (minutos desde 00:00, `to` inclusive se `inclusive`). */
export function timeOptions(from: number, to: number, inclusive = false) {
  const out: { value: string; label: string }[] = [];
  for (let m = from; inclusive ? m <= to : m < to; m += 30) {
    out.push({ value: String(m), label: m === 1440 ? '24:00' : minutesToLabel(m) });
  }
  return out;
}

/** Durações permitidas pelo espaço (múltiplos de 30 entre mínimo e máximo). */
export function durationOptions(min: number, max: number) {
  const out: { value: string; label: string }[] = [];
  for (let d = Math.max(30, min); d <= max; d += 30)
    out.push({ value: String(d), label: String(d) });
  return out;
}
