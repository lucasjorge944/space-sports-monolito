// Validação de formulário só para dar retorno imediato; a regra de verdade é da API.

import { brazilianPhoneSchema, normalizePhone } from '@space-sports/shared';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return 'Informe seu e-mail';
  if (!email.includes('@')) return 'Confira o e-mail: falta o @';
  return EMAIL.test(email) ? null : 'Confira o e-mail';
}

export function validateNewPassword(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) return `Use até ${MAX_PASSWORD_LENGTH} caracteres`;
  return null;
}

export function validateRequired(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

/**
 * Telefone do cadastro e do perfil (decisão 64): brasileiro, com DDD, pelo `brazilianPhoneSchema`
 * que a API também usa. `(31) 99999-8888` → `+5531999998888`; `null` se não servir.
 */
export function phoneToE164(value: string): string | null {
  const phone = normalizePhone(value);
  return phone && brazilianPhoneSchema.safeParse(phone).success ? phone : null;
}

export function validatePhone(value: string): string | null {
  return phoneToE164(value) ? null : 'Informe o telefone com DDD';
}

export function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return 'Informe seu nome';
  return name.length < 2 ? 'Use pelo menos 2 letras' : null;
}

/** `+5531999998888` → `+55 (31) 99999-8888` (só números brasileiros; o resto volta como está). */
export function formatPhone(e164: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return match ? `+55 (${match[1]}) ${match[2]}-${match[3]}` : e164;
}
