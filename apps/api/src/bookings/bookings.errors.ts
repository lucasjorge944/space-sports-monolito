import { HttpStatus } from '@nestjs/common';
import {
  BOOKING_EDIT_BLOCK_MESSAGES,
  type BookingEditBlockCode,
  type BookingTimeViolation,
} from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros de reserva, disponibilidade e pagamento (o cliente trata por eles).

const error = (status: HttpStatus, code: string, message: string, details?: unknown) =>
  new AppException({ status, code, message, details });

export const spaceNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');

/** Espaço suspenso/fechado ou sem preço/hora configurado (RN-SPACE-01). */
export const spaceNotBookable = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SPACE_NOT_BOOKABLE',
    'Este espaço não está aceitando reservas no momento.',
  );

export const courtNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'COURT_NOT_FOUND', 'Quadra não encontrada neste espaço.');

export const courtUnavailable = () =>
  error(HttpStatus.UNPROCESSABLE_ENTITY, 'COURT_UNAVAILABLE', 'A quadra não está ativa.');

export const sportNotOffered = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SPORT_NOT_OFFERED',
    'A quadra não está disponível para este esporte.',
  );

/** RN-BOOK-04. */
export const peopleExceedCapacity = (maxPlayers: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PEOPLE_EXCEED_CAPACITY',
    `A quadra comporta no máximo ${maxPlayers} pessoas para este esporte.`,
    { maxPlayers },
  );

/** RN-BOOK-11: `minPeople` é o organizador mais os convidados que não recusaram. */
export const peopleBelowParticipants = (minPeople: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PEOPLE_BELOW_PARTICIPANTS',
    `A reserva precisa de pelo menos ${minPeople} pessoas: você e os convidados que não recusaram.`,
    { minPeople },
  );

const TIME_MESSAGES: Record<BookingTimeViolation, string> = {
  INVALID_DURATION: 'A duração deve ser múltipla de 30 minutos.',
  DURATION_OUT_OF_RANGE: 'Duração fora dos limites do espaço.',
  MISALIGNED_START: 'O horário deve começar em hora cheia ou meia hora.',
  OUTSIDE_OPENING_HOURS: 'Horário fora do funcionamento do espaço.',
  BOOKING_IN_THE_PAST: 'Este horário já passou.',
  BOOKING_TOO_SOON: 'Este horário não respeita a antecedência mínima do espaço.',
  BOOKING_BEYOND_WINDOW: 'Este horário está além da janela de reservas do espaço.',
};

/** RN-BOOK-02 / RN-BOOK-06: o código é o próprio motivo. */
export const bookingTimeInvalid = (violation: BookingTimeViolation, details?: unknown) =>
  error(HttpStatus.UNPROCESSABLE_ENTITY, violation, TIME_MESSAGES[violation], details);

/** RN-BOOK-03: a constraint de exclusão do banco recusou a ocupação. */
export const slotUnavailable = () =>
  error(HttpStatus.CONFLICT, 'SLOT_UNAVAILABLE', 'Este horário acabou de ser ocupado.');

export const bookingNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Reserva não encontrada.');

export const invalidBookingStatus = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'INVALID_BOOKING_STATUS',
    'A reserva não está em um status que permita esta ação.',
    { status },
  );

/** RN-BOOK-05. */
export const cancellationDeadlinePassed = (deadline: Date) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'CANCELLATION_DEADLINE_PASSED',
    'O prazo para cancelar pelo app terminou. Fale com o espaço.',
    { cancellableUntil: deadline.toISOString() },
  );

/** RN-BOOK-10 a RN-BOOK-12: o código é o próprio motivo, o mesmo das flags do detalhe. */
export const bookingEditBlocked = (code: BookingEditBlockCode) =>
  error(HttpStatus.UNPROCESSABLE_ENTITY, code, BOOKING_EDIT_BLOCK_MESSAGES[code]);

export const bookingNotStarted = () =>
  error(HttpStatus.UNPROCESSABLE_ENTITY, 'BOOKING_NOT_STARTED', 'A reserva ainda não começou.');

export const customerNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'CUSTOMER_NOT_FOUND', 'Cliente não encontrado.');

export const bookingNotSplittable = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BOOKING_NOT_SPLITTABLE',
    'Só é possível dividir a conta de reserva confirmada, futura e com mais de uma pessoa.',
  );

export const tooManyInvites = (available: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'TOO_MANY_INVITES',
    'Há mais convites do que pessoas na reserva.',
    { available },
  );

export const inviteeNotFound = () =>
  error(
    HttpStatus.NOT_FOUND,
    'INVITEE_NOT_FOUND',
    'Um dos usuários convidados não existe ou não está ativo.',
  );

export const inviteNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'INVITE_NOT_FOUND', 'Convite não encontrado.');

export const inviteUnavailable = () =>
  error(HttpStatus.CONFLICT, 'INVITE_UNAVAILABLE', 'Este convite não está mais disponível.');

/** RF-CONTACT-02: cada link é uma vaga, e ela já é de outro contato. */
export const inviteSlotTaken = () =>
  error(HttpStatus.CONFLICT, 'INVITE_SLOT_TAKEN', 'Esta vaga já foi preenchida por outra pessoa.');

export const alreadyParticipant = () =>
  error(HttpStatus.CONFLICT, 'ALREADY_PARTICIPANT', 'Você já participa desta reserva.');

export const bookingNotPayable = (status: string) =>
  error(
    HttpStatus.CONFLICT,
    'BOOKING_NOT_PAYABLE',
    'Não é possível registrar pagamento para esta reserva.',
    { status },
  );

export const paymentExceedsDue = (dueCents: number) =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PAYMENT_EXCEEDS_DUE',
    'O valor é maior do que o valor em aberto.',
    { dueCents },
  );

/** Decisão 50: o recebimento é registrado só na reserva inteira. */
export const participantPaymentNotAllowed = () =>
  error(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PARTICIPANT_PAYMENT_NOT_ALLOWED',
    'O recebimento é registrado só na reserva inteira, não por participante.',
  );

export const payableNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'PAYABLE_NOT_FOUND', 'Item a pagar não encontrado neste espaço.');

export const paymentNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');

export const paymentAlreadyReversed = () =>
  error(HttpStatus.CONFLICT, 'PAYMENT_ALREADY_REVERSED', 'Este pagamento já foi estornado.');

export const courtBlockNotFound = () =>
  error(HttpStatus.NOT_FOUND, 'COURT_BLOCK_NOT_FOUND', 'Bloqueio não encontrado.');

export const invalidCursor = () =>
  error(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'Cursor de paginação inválido.');

/** RN-ONPAY-05: o registro de um pagamento online só muda pelo estorno da cobrança. */
export const onlinePaymentNeedsRefund = () =>
  error(
    HttpStatus.CONFLICT,
    'ONLINE_PAYMENT_NEEDS_REFUND',
    'Pagamento online: use o estorno da cobrança online para devolver o valor.',
  );
