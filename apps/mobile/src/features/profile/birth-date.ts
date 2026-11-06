import { birthDateSchema } from '@space-sports/shared';

// Data de nascimento (decisão 68): data civil, digitada como `dd/mm/aaaa` e enviada como
// `YYYY-MM-DD`. Opcional; a regra de verdade (1900 até hoje em America/Sao_Paulo) é do Zod do
// pacote shared, o mesmo que a API usa.

/** `01021990` → `01/02/1990` enquanto se digita. */
export function maskBirthDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** `01/02/1990` → `1990-02-01`; `null` se incompleta, inexistente ou fora do intervalo. */
export function parseBirthDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return birthDateSchema.safeParse(iso).success ? iso : null;
}

/** `1990-02-01` → `01/02/1990` (sem fuso: é uma data civil). */
export function formatBirthDate(iso: string | null | undefined): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** Vazio vale (é opcional); preenchido, precisa ser uma data válida, de 1900 até hoje. */
export function validateBirthDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return 'Use o formato dd/mm/aaaa';
  const result = birthDateSchema.safeParse(`${match[3]}-${match[2]}-${match[1]}`);
  if (result.success) return null;
  const message = result.error.issues[0]?.message ?? '';
  if (/futuro/i.test(message)) return 'A data não pode ser no futuro';
  if (/1900/.test(message)) return 'Use uma data a partir de 1900';
  return 'Confira a data';
}
