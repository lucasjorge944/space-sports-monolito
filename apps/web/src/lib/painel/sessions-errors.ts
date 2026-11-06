import { isApiError } from '@space-sports/api-client';
import { apiErrorMessage } from './errors';

/** Mensagens dos códigos das sessões de aula (fase 2); os demais caem em `apiErrorMessage`. */
const MESSAGES: Record<string, string> = {
  CLASS_SESSION_NOT_FOUND: 'Aula não encontrada.',
  CLASS_GROUP_NOT_FOUND: 'Turma não encontrada.',
  CLASS_SESSIONS_RANGE_TOO_LONG: 'O período é longo demais. Escolha no máximo 62 dias.',
  CLASS_SESSION_STATUS_CONFLICT:
    'A situação da aula mudou e esta ação não vale mais. Atualizamos os dados.',
  CLASS_SESSION_NOT_EDITABLE: 'Esta aula não pode mais ser alterada.',
  ALREADY_IN_SESSION: 'Este aluno já está na lista desta aula.',
  NOT_IN_SESSION: 'Este aluno não está mais na lista desta aula.',
  PRESENCE_ALREADY_MARKED: 'Este aluno já tem presença marcada e não pode ser removido da aula.',
  PRESENCE_TOO_EARLY: 'A presença só pode ser marcada a partir do início da aula.',
  STUDENT_NOT_IN_SESSION: 'Algum aluno não está na lista nem matriculado nesta turma.',
  USER_NOT_FOUND: 'Aluno não encontrado.',
  TEACHER_NOT_FOUND: 'Esse professor não está mais ativo neste espaço.',
  CAPACITY_BELOW_CONFIRMED: 'A capacidade não pode ficar abaixo das vagas já ocupadas.',
  ATTENDANCE_FILTER_REQUIRED: 'Escolha uma turma ou um aluno para consultar.',
  ATTENDANCE_RANGE_TOO_LONG: 'O período é longo demais. Escolha no máximo 366 dias.',
};

export function sessionErrorCode(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}

/** O erro indica que a tela está desatualizada (outra pessoa mudou a aula): recarregar resolve. */
export function isStaleSessionError(error: unknown): boolean {
  const code = sessionErrorCode(error);
  return (
    code === 'CLASS_SESSION_STATUS_CONFLICT' ||
    code === 'NOT_IN_SESSION' ||
    code === 'ALREADY_IN_SESSION' ||
    code === 'PRESENCE_ALREADY_MARKED'
  );
}

export function sessionErrorMessage(
  error: unknown,
  fallback = 'Não foi possível concluir. Tente novamente.',
): string {
  const code = sessionErrorCode(error);
  const known = code ? MESSAGES[code] : undefined;
  return known ?? apiErrorMessage(error, fallback);
}
