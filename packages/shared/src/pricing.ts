import type { Cents } from './money';

/**
 * RN-BOOK-01: preço = price_per_hour_cents × (duração em minutos ÷ 60), arredondado ao centavo.
 * Mesma função no app (pré-visualização) e na API (que sempre recalcula).
 */
export function calculateBookingPriceCents(pricePerHourCents: Cents, durationMin: number): Cents {
  assertNonNegativeInteger(pricePerHourCents, 'pricePerHourCents');
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    throw new RangeError('durationMin must be a positive integer');
  }
  return Math.round((pricePerHourCents * durationMin) / 60);
}

export interface SplitShare {
  isOrganizer: boolean;
  amountCents: Cents;
}

/**
 * RN-BOOK-09: cada parte é price ÷ people_count; a diferença de arredondamento fica com o organizador.
 * Retorna o organizador primeiro, seguido das demais partes.
 */
export function splitBookingPrice(priceCents: Cents, peopleCount: number): SplitShare[] {
  assertNonNegativeInteger(priceCents, 'priceCents');
  if (!Number.isInteger(peopleCount) || peopleCount < 1) {
    throw new RangeError('peopleCount must be a positive integer');
  }
  const share = Math.floor(priceCents / peopleCount);
  const remainder = priceCents - share * peopleCount;
  return [
    { isOrganizer: true, amountCents: share + remainder },
    ...Array.from({ length: peopleCount - 1 }, () => ({ isOrganizer: false, amountCents: share })),
  ];
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer (cents)`);
  }
}
