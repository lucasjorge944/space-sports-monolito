/** Prefixo dos cookies do Better Auth na API (`advanced.cookiePrefix`). */
export const SESSION_COOKIE_NAME = 'space-sports.session_token';

/**
 * O cookie de sessão está presente? (`__Secure-` na frente em HTTPS.) Só um atalho para não
 * chamar a API de quem nunca entrou; quem valida a sessão é `GET /v1/me`.
 */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => {
    const name = part.split('=')[0]?.trim() ?? '';
    return name === SESSION_COOKIE_NAME || name === `__Secure-${SESSION_COOKIE_NAME}`;
  });
}
