/**
 * E-mail mascarado para logs e auditoria: a primeira letra do usuário e o domínio
 * (`ana.souza@exemplo.com` → `a***@exemplo.com`). Identifica o convite para quem já conhece o
 * endereço, sem gravar o dado pessoal em texto.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
