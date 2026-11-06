import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros de mensalista (o cliente trata por eles).

const error = (status: HttpStatus, code: string, message: string, details?: unknown) =>
  new AppException({ status, code, message, details });

export const recurringNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'RECURRING_BOOKING_NOT_FOUND', 'Mensalista não encontrado.');

/** A transição de estado não existe (PENDING_APPROVAL → ACTIVE ⇄ PAUSED | ENDED | REJECTED). */
export const invalidRecurringStatus = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'INVALID_RECURRING_STATUS',
    'O mensalista não está em um status que permita esta ação.',
    { status },
  );

export const recurringStartInPast = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'RECURRING_START_IN_PAST',
    'A data de início não pode ser anterior a hoje.',
  );

/** O mensalista já tem uma solicitação pendente para este mesmo horário. */
export const recurringRequestDuplicate = () =>
  error(
    HttpStatus.CONFLICT,
    'RECURRING_REQUEST_DUPLICATE',
    'Você já tem uma solicitação pendente para este horário.',
  );
