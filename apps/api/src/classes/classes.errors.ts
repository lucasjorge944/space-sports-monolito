import { HttpStatus } from '@nestjs/common';
import { type OccupationKind, type Teacher, utcToZoned } from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros de aulas (o cliente trata por eles).

const error = (status: HttpStatus, code: string, message: string, details?: unknown) =>
  new AppException({ status, code, message, details });

export const classGroupNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'CLASS_GROUP_NOT_FOUND', 'Turma não encontrada.');

export const classSessionNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'CLASS_SESSION_NOT_FOUND', 'Aula não encontrada.');

export const planNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Plano não encontrado.');

export const sportNotFound = () =>
  error(HttpStatus.UNPROCESSABLE_ENTITY, 'SPORT_NOT_FOUND', 'Esporte não encontrado.');

/** Um dos `teacherMemberIds` não é um Professor ativo do espaço (RF-CLASS-01). */
export const teacherNotFound = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'TEACHER_NOT_FOUND',
    'O professor informado não faz parte da equipe do espaço.',
  );

/** Conflito do horário semanal da turma com a agenda da quadra. */
export interface ScheduleConflictDetails {
  /** `CLASS_GROUP` e `RECURRING_BOOKING`: o horário semanal colide; os demais, uma data. */
  conflictsWith: OccupationKind | 'CLASS_GROUP' | 'RECURRING_BOOKING';
  /** Id da turma ou do mensalista (horário semanal). */
  refId?: string;
  /** Primeira sessão que não cabe (conflitos de data). */
  startsAt?: string;
}

export const scheduleConflict = (details: ScheduleConflictDetails) =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_SCHEDULE_CONFLICT',
    'O horário da turma conflita com a agenda da quadra.',
    details,
  );

const clock = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;

/**
 * Decisão 47: o professor tem aula em outro espaço no horário. A mensagem e os `details` trazem só
 * a data e o horário da aula que está sendo gravada, no fuso do espaço dela: nada do outro espaço.
 */
export const teacherScheduleConflict = (
  teacher: Pick<Teacher, 'memberId' | 'name'>,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
) => {
  const start = utcToZoned(startsAt, timeZone);
  const end = utcToZoned(endsAt, timeZone);
  const [year, month, day] = start.date.split('-');
  return error(
    HttpStatus.CONFLICT,
    'TEACHER_SCHEDULE_CONFLICT',
    `${teacher.name} já tem aula em outro espaço no dia ${day}/${month}/${year}, entre ${clock(start.minuteOfDay)} e ${clock(end.minuteOfDay)}.`,
    {
      teacher: { memberId: teacher.memberId, name: teacher.name },
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timeZone,
    },
  );
};

/** RN-CLASS-02: a turma tem matrículas ativas. */
export const classGroupHasActiveEnrollments = (enrolledCount: number) =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS',
    'A turma tem alunos matriculados. Transfira ou desmatricule os alunos antes.',
    { enrolledCount },
  );

/** A turma tem matrículas ativas: o esporte não muda (as assinaturas são do esporte do plano). */
export const classGroupSportLocked = (enrolledCount: number) =>
  error(
    HttpStatus.CONFLICT,
    'SPORT_CHANGE_NOT_ALLOWED',
    'A turma tem alunos matriculados e não pode mudar de esporte. Crie outra turma.',
    { enrolledCount },
  );

/** O plano tem assinaturas em andamento: o esporte não muda. */
export const planSportLocked = (subscriptionCount: number) =>
  error(
    HttpStatus.CONFLICT,
    'SPORT_CHANGE_NOT_ALLOWED',
    'O plano tem assinaturas em andamento e não pode mudar de esporte. Crie outro plano.',
    { subscriptionCount },
  );

/** Turma com aulas passadas, confirmações ou matrículas encerradas: desative em vez de excluir. */
export const classGroupHasHistory = () =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_GROUP_HAS_HISTORY',
    'A turma já tem aulas ou matrículas registradas. Desative a turma em vez de excluí-la.',
  );

/** RN-CLASS-02: a capacidade nova é menor que as matrículas ativas. */
export const capacityBelowEnrollments = (enrolledCount: number) =>
  error(
    HttpStatus.CONFLICT,
    'CAPACITY_BELOW_ENROLLMENTS',
    'A capacidade não pode ficar abaixo do número de alunos matriculados.',
    { enrolledCount },
  );

/**
 * RN-CLASS-03: a capacidade da sessão é menor que as vagas ocupadas (confirmados + presenças
 * marcadas; `confirmedCount` no `details`).
 */
export const capacityBelowConfirmed = (confirmedCount: number) =>
  error(
    HttpStatus.CONFLICT,
    'CAPACITY_BELOW_CONFIRMED',
    'A capacidade não pode ficar abaixo do número de alunos confirmados ou com presença marcada.',
    { confirmedCount },
  );

export const classSessionNotEditable = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'CLASS_SESSION_NOT_EDITABLE',
    'Esta aula já terminou ou foi cancelada.',
    { status },
  );

export const planHasSubscriptions = () =>
  error(
    HttpStatus.CONFLICT,
    'PLAN_HAS_SUBSCRIPTIONS',
    'O plano já tem assinaturas. Desative o plano em vez de excluí-lo.',
  );

export const sessionsRangeTooLong = (maxDays: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CLASS_SESSIONS_RANGE_TOO_LONG',
    `Consulte no máximo ${maxDays} dias por vez.`,
    { maxDays },
  );
