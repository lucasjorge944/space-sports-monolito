import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros de assinaturas e mensalidades (tarefa 2.2).

const error = (status: HttpStatus, code: string, message: string, details?: unknown) =>
  new AppException({ status, code, message, details });

export const subscriptionNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'SUBSCRIPTION_NOT_FOUND', 'Assinatura não encontrada.');

export const subscriptionChargeNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'SUBSCRIPTION_CHARGE_NOT_FOUND', 'Mensalidade não encontrada.');

export const enrollmentNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'ENROLLMENT_NOT_FOUND', 'O aluno não está matriculado nesta turma.');

/** Plano desativado: não aceita novas assinaturas. */
export const planInactive = () =>
  error(HttpStatus.CONFLICT, 'PLAN_INACTIVE', 'Este plano não está disponível para contratação.');

/** Já há uma assinatura em aberto (pendente, ativa ou em atraso) neste plano. */
export const subscriptionAlreadyExists = () =>
  error(
    HttpStatus.CONFLICT,
    'SUBSCRIPTION_ALREADY_EXISTS',
    'Você já tem uma assinatura em aberto neste plano.',
  );

export const invalidSubscriptionStatus = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'INVALID_SUBSCRIPTION_STATUS',
    'A assinatura não permite esta ação no status atual.',
    { status },
  );

/** RN-CLASS-01: plano Nx/semana = exatamente N turmas. */
export const classGroupCountMismatch = (expected: number, received: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CLASS_GROUP_COUNT_MISMATCH',
    `Este plano exige escolher exatamente ${expected} turma(s).`,
    { expected, received },
  );

/** Turma de outro espaço, inativa ou de outro esporte que não o do plano. */
export const classGroupNotEligible = (classGroupId: string) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CLASS_GROUP_NOT_ELIGIBLE',
    'Turma indisponível para este plano.',
    { classGroupId },
  );

/** Duas turmas escolhidas no mesmo horário. */
export const classGroupsOverlap = (classGroupIds: [string, string]) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CLASS_GROUPS_OVERLAP',
    'As turmas escolhidas acontecem no mesmo horário.',
    { classGroupIds },
  );

/** RN-CLASS-02: matrículas ativas = capacidade da turma. */
export const classGroupFull = (classGroupId: string) =>
  error(HttpStatus.CONFLICT, 'CLASS_GROUP_FULL', 'A turma não tem vagas.', { classGroupId });

export const alreadyEnrolled = (classGroupId: string) =>
  error(HttpStatus.CONFLICT, 'ALREADY_ENROLLED', 'O aluno já está matriculado nesta turma.', {
    classGroupId,
  });

/** RN-CLASS-01: o plano Nx/semana já tem as N turmas. */
export const planFrequencyReached = (weeklyFrequency: number) =>
  error(
    HttpStatus.CONFLICT,
    'PLAN_FREQUENCY_REACHED',
    `O plano permite ${weeklyFrequency} turma(s) por semana. Troque uma turma em vez de adicionar.`,
    { weeklyFrequency },
  );

/** RN-CLASS-08: com o cancelamento pedido, o aluno desiste dele antes de trocar de turma. */
export const subscriptionCancelRequested = (endsOn: string | null) =>
  error(
    HttpStatus.CONFLICT,
    'SUBSCRIPTION_CANCEL_REQUESTED',
    'O cancelamento deste plano já foi pedido: desista dele para trocar de turma.',
    { endsOn },
  );

/** Turma que conflita no horário (decisão 37): sem outros dados do espaço dela. */
export interface ScheduleOverlapConflict {
  classGroupName: string;
  spaceName: string;
  weekday: number;
  startTime: string;
  durationMin: number;
  /** Fuso do espaço da turma (o horário é local dele). */
  timeZone: string;
}

/**
 * RN-CLASS-01 (decisão 37): a turma coincide no horário com outra turma em que o aluno já está
 * matriculado (ou pediu matrícula), em qualquer plano ou espaço.
 */
export const classScheduleOverlap = (classGroupId: string, conflict: ScheduleOverlapConflict) =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_SCHEDULE_OVERLAP',
    `O aluno já tem a turma ${conflict.classGroupName} (${conflict.spaceName}) neste horário.`,
    { classGroupId, conflict },
  );

/** Mensalidade dispensada não aceita pagamento. */
export const chargeNotPayable = (status: string) =>
  error(HttpStatus.CONFLICT, 'CHARGE_NOT_PAYABLE', 'Esta mensalidade foi dispensada.', {
    status,
  });

/** Mensalidade já paga não se dispensa (estorne o pagamento antes, se foi engano). */
export const chargeNotWaivable = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'CHARGE_NOT_WAIVABLE',
    'Só é possível dispensar mensalidade em aberto.',
    { status },
  );

/** Há pagamento registrado e não estornado: dispensar esconderia o dinheiro recebido. */
export const chargeHasPayments = () =>
  error(
    HttpStatus.CONFLICT,
    'CHARGE_HAS_PAYMENTS',
    'Esta mensalidade tem pagamento registrado. Estorne o pagamento antes de dispensá-la.',
  );
