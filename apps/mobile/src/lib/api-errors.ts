import { isApiError } from '@space-sports/api-client';
import { BOOKING_EDIT_BLOCK_MESSAGES } from '@space-sports/shared';
import { AUTH_ERROR_MESSAGES, authErrorMessage } from '@/features/auth/errors';
import { formatBookingWhen, formatMinutes, WEEKDAY_NAMES } from '@/lib/datetime';

/** Mensagens em PT-BR por `code` da API nos fluxos de espaço, reserva, convite e mensalista. */
export const DOMAIN_ERROR_MESSAGES: Record<string, string> = {
  SLOT_UNAVAILABLE: 'Este horário acabou de ser ocupado. Escolha outro horário.',
  SPACE_NOT_FOUND: 'Espaço não encontrado.',
  SPACE_NOT_BOOKABLE: 'Este espaço não está recebendo reservas no momento.',
  SPACE_READ_ONLY: 'Este espaço está temporariamente indisponível para novas operações.',
  COURT_NOT_FOUND: 'Quadra não encontrada neste espaço.',
  COURT_UNAVAILABLE: 'Esta quadra não está disponível no momento.',
  SPORT_NOT_FOUND: 'Esporte não encontrado.',
  SPORT_NOT_OFFERED: 'Esta quadra não oferece o esporte escolhido.',
  PEOPLE_EXCEED_CAPACITY: 'O número de pessoas passa da capacidade da quadra.',
  DURATION_OUT_OF_RANGE: 'A duração está fora dos limites do espaço.',
  BOOKING_NOT_FOUND: 'Reserva não encontrada.',
  // Motivos de edição (RN-BOOK-10 a 12) que só existem no PATCH da reserva; os códigos que os outros
  // fluxos também usam (`SPACE_READ_ONLY`, `COURT_UNAVAILABLE`…) mantêm o texto geral acima.
  NOT_BOOKING_ORGANIZER: BOOKING_EDIT_BLOCK_MESSAGES.NOT_BOOKING_ORGANIZER,
  BOOKING_ENDED: BOOKING_EDIT_BLOCK_MESSAGES.BOOKING_ENDED,
  BOOKING_NOT_EDITABLE: BOOKING_EDIT_BLOCK_MESSAGES.BOOKING_NOT_EDITABLE,
  BOOKING_STARTED: BOOKING_EDIT_BLOCK_MESSAGES.BOOKING_STARTED,
  BOOKING_EDIT_DEADLINE_PASSED: BOOKING_EDIT_BLOCK_MESSAGES.BOOKING_EDIT_DEADLINE_PASSED,
  BOOKING_HAS_PAYMENT: BOOKING_EDIT_BLOCK_MESSAGES.BOOKING_HAS_PAYMENT,
  PEOPLE_BELOW_PARTICIPANTS:
    'O número de pessoas não pode ser menor que você e os convidados que não recusaram.',
  INVALID_DURATION: 'A duração deve ser múltipla de 30 minutos.',
  MISALIGNED_START: 'O horário deve começar em hora cheia ou meia hora.',
  OUTSIDE_OPENING_HOURS: 'Este horário está fora do funcionamento do espaço.',
  BOOKING_IN_THE_PAST: 'Este horário já passou.',
  BOOKING_TOO_SOON: 'Este horário não respeita a antecedência mínima do espaço.',
  BOOKING_BEYOND_WINDOW: 'Este horário está além da janela de reservas do espaço.',
  INVALID_BOOKING_STATUS: 'Esta reserva não pode mais ser alterada.',
  CANCELLATION_DEADLINE_PASSED: 'O prazo para cancelar acabou. Fale com o espaço.',
  BOOKING_NOT_SPLITTABLE: 'Esta reserva não pode ter a conta dividida.',
  TOO_MANY_INVITES: 'Você já convidou todas as pessoas desta reserva.',
  INVITE_NOT_FOUND: 'Convite não encontrado. Peça um novo link a quem convidou.',
  INVITE_UNAVAILABLE: 'Este convite não está mais disponível.',
  INVITE_SLOT_TAKEN: 'Esta vaga já foi preenchida por outra pessoa.',
  ALREADY_PARTICIPANT: 'Você já participa desta reserva.',
  SUGGESTED_USER_MISMATCH: 'Esta conta não é mais a sugerida. Confira a lista de convidados.',
  RECURRING_BOOKING_NOT_FOUND: 'Mensalista não encontrado.',
  INVALID_RECURRING_STATUS: 'Este mensalista não pode mais ser alterado.',
  RECURRING_START_IN_PAST: 'A data de início não pode ser anterior a hoje.',
  PLAN_NOT_FOUND: 'Plano não encontrado.',
  PLAN_INACTIVE: 'Este plano não está mais disponível para novas assinaturas.',
  SUBSCRIPTION_NOT_FOUND: 'Plano contratado não encontrado.',
  SUBSCRIPTION_ALREADY_EXISTS: 'Você já tem este plano em aberto. Veja em Meus planos.',
  INVALID_SUBSCRIPTION_STATUS: 'Esta ação não está disponível para o estado atual do plano.',
  CLASS_GROUP_FULL: 'Esta turma está lotada. Escolha outra turma.',
  CLASS_GROUP_COUNT_MISMATCH: 'Escolha a quantidade de turmas que o plano pede.',
  CLASS_GROUP_NOT_ELIGIBLE: 'Esta turma não faz parte do esporte do plano.',
  CLASS_GROUPS_OVERLAP: 'As turmas escolhidas têm horários que se sobrepõem.',
  CLASS_GROUP_NOT_FOUND: 'Turma não encontrada.',
  ALREADY_ENROLLED: 'Você já está matriculado nesta turma.',
  PLAN_FREQUENCY_REACHED: 'Seu plano já está com todas as turmas.',
  CLASS_SCHEDULE_OVERLAP: 'Esta turma tem o mesmo horário de outra turma sua. Escolha outra turma.',
  CLASS_SESSION_OVERLAP: 'Você já está na lista de outra aula neste mesmo horário.',
  CLASS_SESSION_NOT_FOUND: 'Aula não encontrada.',
  CLASS_SESSIONS_RANGE_TOO_LONG: 'O período escolhido é longo demais.',
  NOT_ENROLLED_IN_CLASS: 'Você só pode confirmar presença nas aulas das suas turmas.',
  SUBSCRIPTION_ACCESS_ENDED: 'Esta aula é depois do último dia do seu plano.',
  SUBSCRIPTION_CANCEL_REQUESTED:
    'O cancelamento deste plano já foi pedido. Desista dele para trocar de turma.',
  SUBSCRIPTION_PAST_DUE:
    'Há mensalidade em atraso. Regularize com o espaço para voltar a confirmar presença.',
  ALREADY_IN_SESSION: 'Você já está na lista desta aula.',
  NOT_IN_SESSION: 'Você não está na lista desta aula.',
  ATTENDANCE_LIST_NOT_OPEN: 'A lista de presença não está aberta para esta aula.',
  CANCEL_DEADLINE_PASSED: 'O prazo para desistir desta aula acabou. Fale com o espaço.',
  USER_BLOCKED: AUTH_ERROR_MESSAGES.USER_BLOCKED as string,
  ACCOUNT_INACTIVE: AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE as string,
  INVALID_CURSOR: 'Não foi possível continuar a lista. Puxe para atualizar.',
  // Pagamento online (RF-ONPAY-03 a 06, RN-ONPAY-02/03; docs/13 §13).
  BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT:
    'Este horário começa logo e não dá tempo de pagar pelo app. Escolha outro horário.',
  ONLINE_PAYMENT_REQUIRED: 'Este espaço pede o pagamento na reserva. Escolha Pix ou cartão.',
  ONLINE_PAYMENT_UNAVAILABLE:
    'Este espaço não aceita mais pagamento pelo app. Escolha outra forma.',
  ONLINE_PAYMENTS_DISABLED: 'O pagamento pelo app está indisponível agora. Pague no espaço.',
  PAYMENT_HOLD_EXPIRED: 'O prazo para pagar acabou e o horário foi liberado.',
  ALREADY_PAID: 'Este pagamento já foi feito.',
  NOT_PAYABLE_ONLINE: 'Este item não pode mais ser pago pelo app.',
  PAYMENT_IN_PROGRESS:
    'Já existe um pagamento em andamento para este item. Aguarde alguns segundos e confira.',
  PAYMENT_GATEWAY_UNAVAILABLE: 'Não conseguimos falar com o banco. Tente de novo.',
  ONLINE_CHARGE_NOT_FOUND: 'Pagamento não encontrado.',
  INVALID_IDEMPOTENCY_KEY: 'Não deu para enviar o pagamento. Tente de novo.',
  IDEMPOTENCY_KEY_REUSED:
    'Este pedido mudou depois de uma tentativa sem resposta. Confira em Minhas reservas antes de tentar de novo.',
};

/** O horário escolhido foi ocupado por outra pessoa (409 `SLOT_UNAVAILABLE`, RN-BOOK-03). */
export function isSlotUnavailable(error: unknown): boolean {
  return isApiError(error) && error.code === 'SLOT_UNAVAILABLE';
}

/** O convite/reserva/espaço não existe mais (404). */
export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

function detailsRecord(error: { details: unknown }): Record<string, unknown> | null {
  const details = error.details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
}

function detailNumber(error: { details: unknown }, key: string): number | null {
  const value = detailsRecord(error)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function detailString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : null;
}

/** `details.conflict` do 409 (decisão 37): só nome, espaço e horário da outra turma ou aula. */
function detailConflict(error: { details: unknown }): Record<string, unknown> | null {
  const conflict = detailsRecord(error)?.conflict;
  return conflict && typeof conflict === 'object' ? (conflict as Record<string, unknown>) : null;
}

/** "Futevôlei iniciante (Arena Sol)", ou só o que vier. */
function conflictTitle(conflict: Record<string, unknown> | null): string | null {
  const name = detailString(conflict, 'classGroupName');
  const space = detailString(conflict, 'spaceName');
  if (name && space) return `${name} (${space})`;
  return name ?? space;
}

/** "Sábado, 07:00 às 08:00" da turma que conflita (horário semanal, no fuso do espaço dela). */
function conflictWeekly(conflict: Record<string, unknown> | null): string | null {
  const weekday = conflict?.weekday;
  const start = detailString(conflict, 'startTime');
  const duration = conflict?.durationMin;
  if (typeof weekday !== 'number' || !WEEKDAY_NAMES[weekday] || !start) return null;
  const from = start.slice(0, 5);
  if (typeof duration !== 'number') return `${WEEKDAY_NAMES[weekday]}, ${from}`;
  const minutes = Number(from.slice(0, 2)) * 60 + Number(from.slice(3, 5)) + duration;
  return `${WEEKDAY_NAMES[weekday]}, ${from} às ${formatMinutes(minutes)}`;
}

/** Choque de horário na matrícula (decisão 37): diz qual turma conflita, de qualquer espaço. */
export function scheduleOverlapMessage(error: { details: unknown }): string {
  const conflict = detailConflict(error);
  const title = conflictTitle(conflict);
  if (!title) return DOMAIN_ERROR_MESSAGES.CLASS_SCHEDULE_OVERLAP as string;
  const when = conflictWeekly(conflict);
  return `Esta turma tem o mesmo horário de outra turma sua: ${title}${when ? `, ${when}` : ''}. Escolha outra turma.`;
}

/** Choque de horário na confirmação (decisão 37): diz em qual aula ele já está na lista. */
export function sessionOverlapMessage(error: { details: unknown }): string {
  const conflict = detailConflict(error);
  const title = conflictTitle(conflict);
  if (!title) return DOMAIN_ERROR_MESSAGES.CLASS_SESSION_OVERLAP as string;
  const startsAt = detailString(conflict, 'startsAt');
  const endsAt = detailString(conflict, 'endsAt');
  const when = startsAt && endsAt ? formatBookingWhen(startsAt, endsAt) : null;
  return `Você já está na lista de ${title}${when ? `, ${when}` : ''}, que sobrepõe esta aula.`;
}

/**
 * Mensagem em PT-BR para qualquer erro das telas de espaço e reserva: primeiro pelo `code`
 * estável da API, depois pelo status/rede (mesmas regras do auth). Nunca o texto cru da API.
 */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code.toUpperCase()) {
      case 'CLASS_SCHEDULE_OVERLAP':
        return scheduleOverlapMessage(error);
      case 'CLASS_SESSION_OVERLAP':
        return sessionOverlapMessage(error);
      case 'BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT': {
        const minutes = detailNumber(error, 'minLeadMin');
        if (minutes !== null) {
          return `Este horário começa em menos de ${minutes} minutos e não dá tempo de pagar pelo app. Escolha outro horário.`;
        }
        break;
      }
      case 'PEOPLE_BELOW_PARTICIPANTS': {
        const minPeople = detailNumber(error, 'minPeople');
        if (minPeople !== null) {
          return `A reserva precisa de pelo menos ${minPeople} ${minPeople === 1 ? 'pessoa' : 'pessoas'}: você e os convidados que não recusaram.`;
        }
        break;
      }
    }
    const byCode = DOMAIN_ERROR_MESSAGES[error.code.toUpperCase()];
    if (byCode) return byCode;
  }
  return authErrorMessage(error);
}
