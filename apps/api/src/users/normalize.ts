/**
 * Forma canônica do e-mail (sem espaços nas pontas, minúsculas): é a que vai para o banco, onde o
 * CHECK users_email_normalized a garante. Assim o UNIQUE de users.email não diferencia maiúsculas.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Primeira palavra do nome: é o que aparece a quem não é da conta. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}
