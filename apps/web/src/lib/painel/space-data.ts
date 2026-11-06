import type { OpeningHour } from '@space-sports/api-client';

/** Instagram digitado (`@usuario`, `instagram.com/usuario`) → só o usuário. */
export function normalizeInstagram(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^@/, '');
  return cleaned || null;
}

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Cidade do catálogo que corresponde à do CEP, sem diferenciar acento nem maiúsculas. */
export function findCity<T extends { name: string; state: string }>(
  cities: readonly T[],
  address: { city: string; state: string },
): T | undefined {
  const name = plain(address.city);
  return cities.find((c) => c.state === address.state && plain(c.name) === name);
}

/** Intervalos do dia ordenados por abertura. */
export function hoursOfDay<T extends OpeningHour>(hours: readonly T[], weekday: number): T[] {
  return hours
    .filter((h) => h.weekday === weekday)
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt));
}

/** Copia o horário de um dia para outros dias (substitui os intervalos dos destinos). */
export function copyDayHours<T extends OpeningHour>(
  hours: readonly T[],
  from: number,
  to: readonly number[],
): T[] {
  const source = hoursOfDay(hours, from);
  const kept = hours.filter((h) => !to.includes(h.weekday));
  return [...kept, ...to.flatMap((weekday) => source.map((h) => ({ ...h, weekday })))];
}

/**
 * Valida o horário no cliente (a API valida de novo): `HH:MM` e sem sobreposição no mesmo dia.
 * Fechar igual ou antes de abrir significa passar da meia-noite, então só checamos sobreposição
 * entre intervalos que não atravessam a meia-noite.
 */
export function validateOpeningHours(hours: readonly OpeningHour[]): string | null {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const h of hours) {
    if (!re.test(h.opensAt) || !re.test(h.closesAt)) return 'Use horários no formato HH:MM.';
  }
  for (let weekday = 0; weekday < 7; weekday++) {
    const day = hoursOfDay(hours, weekday);
    for (let i = 1; i < day.length; i++) {
      const prev = day[i - 1] as OpeningHour;
      const cur = day[i] as OpeningHour;
      const prevCrosses = prev.closesAt <= prev.opensAt;
      if (prevCrosses || prev.closesAt > cur.opensAt) {
        return 'Há horários sobrepostos no mesmo dia.';
      }
    }
  }
  return null;
}

/** Iniciais para o avatar sem logo: primeira letra das duas primeiras palavras do nome. */
export function spaceInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w));
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '');
  return letters.join('').toLocaleUpperCase('pt-BR') || '?';
}
