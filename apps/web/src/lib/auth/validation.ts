/** Limites iguais aos da API (Better Auth: `minPasswordLength`/`maxPasswordLength`). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Informe seu e-mail';
  if (!EMAIL.test(email)) return 'Informe um e-mail válido';
  return undefined;
}

export function validateName(value: string): string | undefined {
  if (!value.trim()) return 'Informe seu nome';
  return undefined;
}

/** Senha de cadastro/redefinição (a de login só precisa estar preenchida). */
export function validateNewPassword(value: string): string | undefined {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  return undefined;
}

export function validateRequiredPassword(value: string): string | undefined {
  return value ? undefined : 'Informe sua senha';
}

export function validatePasswordConfirmation(password: string, confirmation: string) {
  return password === confirmation ? undefined : 'As senhas não conferem';
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Remove as chaves sem erro; `undefined` se o formulário está válido. */
export function collectErrors<K extends string>(
  checks: Record<K, string | undefined>,
): FieldErrors<K> | undefined {
  const errors: FieldErrors<K> = {};
  for (const key of Object.keys(checks) as K[]) {
    const message = checks[key];
    if (message) errors[key] = message;
  }
  return Object.keys(errors).length ? errors : undefined;
}
