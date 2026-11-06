import { z } from 'zod';

/** Dinheiro sempre em centavos inteiros e não negativos. */
export const centsSchema = z.number().int().nonnegative();
export type Cents = z.infer<typeof centsSchema>;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos para exibição (ex.: 15000 → "R$ 150,00"). */
export function formatCents(cents: Cents): string {
  return brl.format(cents / 100);
}
