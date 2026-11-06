/**
 * Cookie de roteamento do modo suporte: só avisa o `proxy.ts` que este navegador tem uma sessão de
 * suporte aberta, para um Super poder abrir o `/painel`. Não concede nada: a API valida o header
 * `X-Support-Session` em cada requisição.
 */
export const SUPPORT_COOKIE = 'space-sports.support';

export function setSupportCookie(active: boolean, expiresAt?: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const expires = active && expiresAt ? `; Expires=${new Date(expiresAt).toUTCString()}` : '';
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API ainda não é universal.
  document.cookie = active
    ? `${SUPPORT_COOKIE}=1; Path=/${expires}; SameSite=Lax${secure}`
    : `${SUPPORT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
