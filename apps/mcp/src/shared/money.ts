import { formatCents } from '@space-sports/shared';

/** Dinheiro nas saídas: centavos (inteiro) e o texto em BRL, como no app. */
export interface Money {
  cents: number;
  formatted: string;
}

export function money(cents: number): Money {
  return { cents, formatted: formatCents(cents) };
}
