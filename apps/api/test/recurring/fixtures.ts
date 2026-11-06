import { addDays, utcToZoned, weekdayOf, zonedToUtc } from '@space-sports/shared';

export const TIME_ZONE = 'America/Sao_Paulo';
/** Data local de hoje (o relógio do teste está congelado ao meio-dia por `useMiddayClock`). */
export const today = () => utcToZoned(new Date(), TIME_ZONE).date;

/**
 * Dia da semana de amanhã: o horário fixo nunca cai hoje, então a janela de 4 semanas tem
 * exatamente 4 ocorrências (amanhã + 0, 7, 14 e 21 dias).
 */
export const slotWeekday = () => weekdayOf(addDays(today(), 1));

/** Data local da n-ésima ocorrência (0 = amanhã) de um horário fixo criado com `slotWeekday()`. */
export const occurrenceDate = (n: number) => addDays(today(), 1 + 7 * n);

/** Instante UTC da n-ésima ocorrência no horário `HH:MM` local. */
export function occurrenceStart(n: number, startTime: string): Date {
  const [hour, minute] = startTime.split(':').map(Number);
  return zonedToUtc(occurrenceDate(n), (hour ?? 0) * 60 + (minute ?? 0), TIME_ZONE);
}
