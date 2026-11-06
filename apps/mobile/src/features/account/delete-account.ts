import { isApiError, requestMyAccountDeletion } from '@space-sports/api-client';
import { authErrorMessage } from '@/features/auth/errors';
import { formatInstantDate } from '@/lib/datetime';

/** Prazo que a equipe do Space Sports tem para responder (LGPD, decisão 40). */
export const DELETION_DEADLINE_DAYS = 15;

export interface DeletionReceipt {
  requestId: string;
  requestedAt: string;
  dueAt: string;
}

/**
 * Pedido de exclusão da própria conta (RF-AUTH-03, decisão 40). Chama
 * `POST /v1/me/deletion-request` (201): a conta é inativada na hora, as sessões são encerradas e a
 * equipe confirma até `dueAt`. Sem `password` a API só aceita sessão aberta há até 10 minutos.
 */
export async function requestAccountDeletion(input: {
  password?: string;
  reason?: string;
}): Promise<DeletionReceipt> {
  const password = input.password?.trim() ? input.password : undefined;
  const reason = input.reason?.trim() || undefined;
  return requestMyAccountDeletion({
    ...(password ? { password } : {}),
    ...(reason ? { reason } : {}),
  });
}

/** Erro mostrado no campo de senha: senha errada ou sessão antiga demais para excluir sem senha. */
export function passwordFieldError(error: unknown): string | null {
  if (!isApiError(error)) return null;
  if (error.code === 'INVALID_PASSWORD') return 'Senha incorreta';
  if (error.code === 'REAUTHENTICATION_REQUIRED') return 'Digite a senha da sua conta';
  return null;
}

/** Mensagem em PT-BR por código; o que não for específico daqui cai nas mensagens de auth. */
export function deleteAccountErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'INVALID_PASSWORD':
        return 'Senha incorreta. Confira e tente de novo.';
      case 'REAUTHENTICATION_REQUIRED':
        return 'Por segurança, digite a senha para continuar. Se você entra com Google, Apple ou telefone e não tem senha, saia, entre de novo e peça a exclusão logo em seguida.';
      case 'DELETION_REQUEST_PENDING':
        return 'Você já tem um pedido de exclusão em análise. Para desistir, fale com o atendimento.';
      case 'LAST_OWNER':
        return 'Você é o único Dono de um espaço. Defina outro Dono antes de pedir a exclusão da conta.';
      case 'SUPER_ACCOUNT':
        return 'Esta conta administra a plataforma e não pode ser excluída pelo app. Fale com o suporte.';
      case 'USER_BLOCKED':
        return 'Sua conta está bloqueada e não pode ser excluída pelo app. Fale com o suporte.';
    }
  }
  return authErrorMessage(error);
}

/** `dueAt` (instante ISO) como "13/11/2026", no fuso America/Sao_Paulo. */
export function formatDueDate(dueAt: string): string {
  return formatInstantDate(dueAt);
}

/** Texto do aviso exibido depois do pedido, já com a conta fora do app. */
export function deletionReceiptMessage(receipt: Pick<DeletionReceipt, 'dueAt'>): string {
  return `Sua conta foi inativada e você saiu do app. A equipe do Space Sports confirma a exclusão até ${formatDueDate(receipt.dueAt)}. Para desistir antes disso, fale com o atendimento.`;
}
