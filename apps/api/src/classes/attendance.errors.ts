import { HttpStatus } from '@nestjs/common';
import type { ClassSessionStatus } from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros da lista de presença (o cliente trata por eles).

const error = (status: HttpStatus, code: string, message: string, details?: unknown) =>
  new AppException({ status, code, message, details });

/** RN-CLASS-04: confirmar ou desistir só com a lista aberta (e antes do início). */
export const attendanceListNotOpen = (status: ClassSessionStatus) =>
  error(
    HttpStatus.CONFLICT,
    'ATTENDANCE_LIST_NOT_OPEN',
    'A lista de presença desta aula não está aberta.',
    { status },
  );

/** RN-CLASS-05: passou do prazo para desistir. */
export const cancelDeadlinePassed = (deadline: Date) =>
  error(
    HttpStatus.CONFLICT,
    'CANCEL_DEADLINE_PASSED',
    'O prazo para desistir desta aula já passou.',
    { deadline: deadline.toISOString() },
  );

/** RN-CLASS-01/03, decisão 24: só confirma nas sessões das turmas em que está matriculado. */
export const notEnrolledInClass = () =>
  error(
    HttpStatus.FORBIDDEN,
    'NOT_ENROLLED_IN_CLASS',
    'Você só pode confirmar presença nas aulas das suas turmas.',
  );

/** RN-CLASS-08: a aula é depois do último dia de acesso do plano cancelado. */
export const subscriptionAccessEnded = () =>
  error(
    HttpStatus.FORBIDDEN,
    'SUBSCRIPTION_ACCESS_ENDED',
    'Esta aula é depois do último dia do seu plano.',
  );

/** RN-CLASS-06: mensalidade em atraso (com a regra ligada) não confirma. */
export const subscriptionPastDue = () =>
  error(
    HttpStatus.FORBIDDEN,
    'SUBSCRIPTION_PAST_DUE',
    'Há mensalidade em atraso: regularize no espaço para confirmar presença.',
  );

/**
 * Aula que conflita no horário (decisão 37): sem outros dados do espaço dela, nem a situação do
 * aluno na lista (o espaço de uma aula não vê o que ele faz no outro).
 */
export interface SessionOverlapConflict {
  classGroupName: string;
  spaceName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * RN-CLASS-01 (decisão 37): o aluno já está confirmado ou na espera de outra aula que se
 * sobrepõe a esta, em qualquer espaço.
 */
export const classSessionOverlap = (conflict: SessionOverlapConflict) =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_SESSION_OVERLAP',
    `O aluno já está na lista da aula ${conflict.classGroupName} (${conflict.spaceName}) no mesmo horário.`,
    { conflict },
  );

export const alreadyInSession = (status: string) =>
  error(HttpStatus.CONFLICT, 'ALREADY_IN_SESSION', 'O aluno já está na lista desta aula.', {
    status,
  });

export const notInSession = () =>
  error(HttpStatus.CONFLICT, 'NOT_IN_SESSION', 'O aluno não está na lista desta aula.');

/** Quem já teve a presença marcada fica na lista: a marcação é o registro da aula. */
export const presenceAlreadyMarked = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'PRESENCE_ALREADY_MARKED',
    'A presença deste aluno já foi marcada: ele não pode ser removido da aula.',
    { status },
  );

/** Ação que o status atual da sessão não permite (abrir já aberta, fechar cancelada…). */
export const sessionStatusConflict = (status: ClassSessionStatus, action: string) =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_SESSION_STATUS_CONFLICT',
    'Esta ação não é possível no status atual da aula.',
    { status, action },
  );

/** Presença real só a partir do início da aula. */
export const presenceTooEarly = (startsAt: Date) =>
  error(
    HttpStatus.CONFLICT,
    'PRESENCE_TOO_EARLY',
    'A presença só pode ser marcada a partir do início da aula.',
    { startsAt: startsAt.toISOString() },
  );

/** Presença de quem não está na lista nem matriculado na turma. */
export const studentNotInSession = (userIds: string[]) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'STUDENT_NOT_IN_SESSION',
    'Há alunos que não estão na lista nem matriculados na turma. Adicione-os à aula antes.',
    { userIds },
  );

export const userNotFound = () =>
  error(HttpStatus.UNPROCESSABLE_ENTITY, 'USER_NOT_FOUND', 'Usuário não encontrado.');

export const attendanceFilterRequired = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'ATTENDANCE_FILTER_REQUIRED',
    'Informe o aluno (`userId`) ou a turma (`classGroupId`).',
  );

export const attendanceRangeTooLong = (maxDays: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'ATTENDANCE_RANGE_TOO_LONG',
    `Consulte no máximo ${maxDays} dias por vez.`,
    { maxDays },
  );
