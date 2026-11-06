import { z } from 'zod';

// Busca de endereço por CEP (decisão 52).

/** Só os dígitos do CEP (aceita hífen, ponto e espaços); `null` se não forem 8 dígitos. */
export function normalizeCep(value: string): string | null {
  const digits = value.replace(/[\s.-]/g, '');
  return /^[0-9]{8}$/.test(digits) ? digits : null;
}

/** GET /v1/address/cep/:cep */
export const cepAddressSchema = z.object({
  /** CEP só com dígitos (8). */
  postalCode: z.string().regex(/^[0-9]{8}$/),
  /** Logradouro; nulo no CEP geral de um município. */
  street: z.string().nullable(),
  /** Bairro; nulo no CEP geral de um município. */
  neighborhood: z.string().nullable(),
  city: z.string(),
  /** UF. */
  state: z.string().length(2),
});
export type CepAddress = z.infer<typeof cepAddressSchema>;
