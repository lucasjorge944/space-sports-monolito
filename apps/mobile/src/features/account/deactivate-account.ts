import { deactivateMe, isApiError } from '@space-sports/api-client';
import { authErrorMessage } from '@/features/auth/errors';

/**
 * Inativação da própria conta (RF-AUTH-03). Chama `POST /v1/me/deactivate` (204), que marca a conta
 * como inativa e encerra todas as sessões; reservas, mensalistas e pagamentos continuam como estão.
 * A API recusa com 409 `LAST_OWNER`, 409 `SUPER_ACCOUNT` e 403 `ACCOUNT_INACTIVE`/`USER_BLOCKED`;
 * veja `deactivateAccountErrorMessage`.
 */
export async function requestAccountDeactivation(): Promise<void> {
  await deactivateMe();
}

/** Mensagem em PT-BR por código; o que não for específico daqui cai nas mensagens de auth. */
export function deactivateAccountErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'LAST_OWNER':
        return 'Você é o único Dono de um espaço. Transfira a titularidade para outra pessoa antes de inativar sua conta.';
      case 'SUPER_ACCOUNT':
        return 'Esta conta administra a plataforma e não pode ser inativada pelo app. Fale com o suporte.';
      case 'USER_BLOCKED':
        return 'Sua conta está bloqueada e não pode ser inativada pelo app. Fale com o suporte.';
    }
  }
  return authErrorMessage(error);
}
