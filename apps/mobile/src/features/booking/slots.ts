import type { AvailabilityCourtDto, AvailabilityResponseDto } from '@space-sports/api-client';

export interface TimeOption {
  startsAt: string;
  endsAt: string;
  /** Quadras livres neste horário (RF-BOOK-01: o jogador sempre escolhe a quadra). */
  courts: AvailabilityCourtDto[];
}

/** Horários em que ao menos uma quadra está livre, em ordem, cada um com as quadras livres. */
export function timeOptions(availability: AvailabilityResponseDto): TimeOption[] {
  const byStart = new Map<string, TimeOption>();
  for (const court of availability.courts) {
    for (const slot of court.slots) {
      if (!slot.available) continue;
      const option = byStart.get(slot.startsAt) ?? {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        courts: [],
      };
      option.courts.push(court);
      byStart.set(slot.startsAt, option);
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Durações que o espaço aceita, de 30 em 30 min (RN-BOOK-02). */
export function durationOptions(minMin: number, maxMin: number): number[] {
  const options: number[] = [];
  for (let d = minMin; d <= maxMin; d += 30) options.push(d);
  return options;
}

/** Número de pessoas padrão: 2, limitado à capacidade da quadra. */
export function defaultPeople(maxPlayers: number): number {
  return Math.max(1, Math.min(2, maxPlayers));
}

/** Mantém o nº de pessoas dentro de 1..capacidade (RN-BOOK-04) ao trocar de quadra. */
export function clampPeople(people: number, maxPlayers: number): number {
  return Math.max(1, Math.min(people, maxPlayers));
}
