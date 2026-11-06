import { APIError } from 'better-auth/api';

/** Rotas do Better Auth cujo corpo aceitaria `image`, mapeado para `users.avatar_url`. */
export const ROUTES_WITHOUT_IMAGE = ['/sign-up/email', '/update-user'] as const;

/**
 * A foto de perfil só muda por `/v1/me/avatar` (RF-AUTH-02), que confere o arquivo e apaga a foto
 * anterior do storage. Gravar `avatar_url` com qualquer URL pelo Better Auth deixaria a foto
 * enviada órfã (e pública) e serviria de atalho para apontar a foto de outra pessoa. O login
 * social (foto do Google, decisão 71) grava a foto pelo cadastro interno, sem passar por aqui.
 * Chamada pelo middleware `before` do Better Auth (auth.ts).
 */
export function rejectProfileImage(path: string, body: unknown): void {
  if (!(ROUTES_WITHOUT_IMAGE as readonly string[]).includes(path)) return;
  if (body && typeof body === 'object' && 'image' in body) {
    throw new APIError('BAD_REQUEST', {
      code: 'IMAGE_NOT_ALLOWED',
      message: 'A foto de perfil é enviada por /v1/me/avatar.',
    });
  }
}
