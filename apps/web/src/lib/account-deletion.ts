import type { PublicAccountDeletionInput } from '@space-sports/api-client';
import { isApiError } from '@space-sports/api-client';
import {
  collectErrors,
  type FieldErrors,
  normalizeEmail,
  validateEmail,
  validateRequiredPassword,
} from '@/lib/auth/validation';

/** Prazo que a equipe tem para responder ao titular (decisão 40, LGPD). */
export const DELETION_DEADLINE_DAYS = 15;
export const DELETION_REASON_MAX = 500;

export type DeletionFormValues = { email: string; password: string; reason: string };
export type DeletionFormResult =
  | { ok: true; data: PublicAccountDeletionInput }
  | { ok: false; errors: FieldErrors<'email' | 'password' | 'reason'> };

/** Valida o formulário público e monta o corpo de `POST /v1/public/deletion-request`. */
export function deletionRequestFromForm(values: DeletionFormValues): DeletionFormResult {
  const reason = values.reason.trim();
  const errors = collectErrors({
    email: validateEmail(values.email),
    password: validateRequiredPassword(values.password),
    reason:
      reason.length > DELETION_REASON_MAX
        ? `Use até ${DELETION_REASON_MAX} caracteres.`
        : undefined,
  });
  if (errors) return { ok: false, errors };
  return {
    ok: true,
    data: {
      email: normalizeEmail(values.email),
      password: values.password,
      ...(reason ? { reason } : {}),
    },
  };
}

/**
 * A resposta de sucesso é sempre a mesma (não revela se o e-mail existe nem se a senha confere);
 * só o limite de tentativas (429) e a falha de rede/servidor aparecem como erro.
 */
export function deletionRequestErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 429 || error.code === 'TOO_MANY_REQUESTS')
      return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
    if (error.code === 'VALIDATION_ERROR') return 'Confira o e-mail e a senha informados.';
    if (error.status >= 500) return 'Serviço indisponível no momento. Tente de novo em instantes.';
  }
  if (error instanceof TypeError) return 'Sem conexão com o servidor. Verifique a internet.';
  return 'Não foi possível enviar o pedido. Tente novamente.';
}
