import { ApiError } from '@space-sports/api-client';
import { DOMAIN_ERROR_MESSAGES, errorMessage, isSlotUnavailable } from './api-errors';

const apiError = (code: string, status = 409) => new ApiError({ status, code, message: 'English' });

describe('errorMessage', () => {
  it('traduz SLOT_UNAVAILABLE e orienta a escolher outro horário', () => {
    expect(errorMessage(apiError('SLOT_UNAVAILABLE'))).toBe(
      'Este horário acabou de ser ocupado. Escolha outro horário.',
    );
    expect(isSlotUnavailable(apiError('SLOT_UNAVAILABLE'))).toBe(true);
    expect(isSlotUnavailable(apiError('OUTRO'))).toBe(false);
  });

  it('traduz o prazo de cancelamento (RN-BOOK-05)', () => {
    expect(errorMessage(apiError('CANCELLATION_DEADLINE_PASSED', 422))).toMatch(
      /Fale com o espaço/,
    );
  });

  const withDetails = (code: string, details: unknown, status = 422) =>
    new ApiError({ status, code, message: 'English', details });

  it('edição da reserva: mostra o mínimo vindo de details (RN-BOOK-11)', () => {
    expect(errorMessage(withDetails('PEOPLE_BELOW_PARTICIPANTS', { minPeople: 3 }))).toBe(
      'A reserva precisa de pelo menos 3 pessoas: você e os convidados que não recusaram.',
    );
    expect(errorMessage(withDetails('PEOPLE_BELOW_PARTICIPANTS', undefined))).toMatch(
      /não pode ser menor/,
    );
  });

  it.each([
    ['BOOKING_HAS_PAYMENT', /fale com o espaço/],
    ['BOOKING_EDIT_DEADLINE_PASSED', /Fale com o espaço/],
    ['BOOKING_STARTED', /já começou/],
    ['BOOKING_TOO_SOON', /antecedência mínima/],
    ['SUBSCRIPTION_CANCEL_REQUESTED', /Desista dele/],
    ['SUBSCRIPTION_ACCESS_ENDED', /último dia do seu plano/],
  ])('traduz %s', (code, text) => {
    expect(errorMessage(apiError(code, 422))).toMatch(text);
  });

  it('o texto de COURT_UNAVAILABLE segue geral: ele também aparece ao criar reserva', () => {
    expect(errorMessage(apiError('COURT_UNAVAILABLE', 422))).toBe(
      'Esta quadra não está disponível no momento.',
    );
  });

  it('códigos de pausa de plano não existem mais: caem na mensagem genérica', () => {
    expect(errorMessage(apiError('PAUSE_NOT_ALLOWED', 422))).toBe(
      'Algo deu errado. Tente novamente.',
    );
  });

  it('CLASS_SCHEDULE_OVERLAP mostra a turma que conflita, de qualquer espaço (decisão 37)', () => {
    const conflict = {
      classGroupName: 'Futevôlei iniciante',
      spaceName: 'Arena Sol',
      weekday: 6,
      startTime: '07:00',
      durationMin: 90,
      timeZone: 'America/Sao_Paulo',
    };
    expect(
      errorMessage(withDetails('CLASS_SCHEDULE_OVERLAP', { classGroupId: 'g2', conflict }, 409)),
    ).toBe(
      'Esta turma tem o mesmo horário de outra turma sua: Futevôlei iniciante (Arena Sol), Sábado, 07:00 às 08:30. Escolha outra turma.',
    );
    expect(errorMessage(withDetails('CLASS_SCHEDULE_OVERLAP', undefined, 409))).toBe(
      'Esta turma tem o mesmo horário de outra turma sua. Escolha outra turma.',
    );
  });

  it('CLASS_SESSION_OVERLAP mostra nome, espaço e horário da aula, sem o status', () => {
    const conflict = {
      classGroupName: 'Vôlei adulto',
      spaceName: 'Arena Sol',
      startsAt: '2026-11-07T10:00:00.000Z',
      endsAt: '2026-11-07T11:00:00.000Z',
      status: 'WAITLIST',
    };
    const message = errorMessage(withDetails('CLASS_SESSION_OVERLAP', { conflict }, 409));
    expect(message).toBe(
      'Você já está na lista de Vôlei adulto (Arena Sol), Sáb, 07/11/2026 · 07:00 – 08:00, que sobrepõe esta aula.',
    );
    expect(message).not.toMatch(/WAITLIST|espera/);
    expect(errorMessage(withDetails('CLASS_SESSION_OVERLAP', undefined, 409))).toBe(
      'Você já está na lista de outra aula neste mesmo horário.',
    );
  });

  it('traduz o bloqueio de presença por fim do acesso, atraso e prazo (RN-CLASS-05/06/08)', () => {
    expect(errorMessage(apiError('SUBSCRIPTION_ACCESS_ENDED', 403))).toMatch(/último dia/);
    expect(errorMessage(apiError('SUBSCRIPTION_PAST_DUE', 403))).toMatch(/atraso/);
    expect(errorMessage(apiError('CANCEL_DEADLINE_PASSED'))).toMatch(/prazo para desistir/);
    expect(errorMessage(apiError('ATTENDANCE_LIST_NOT_OPEN'))).toMatch(/não está aberta/);
    expect(errorMessage(apiError('ALREADY_IN_SESSION', 409))).toBe(
      'Você já está na lista desta aula.',
    );
    expect(errorMessage(apiError('NOT_IN_SESSION', 409))).toBe(
      'Você não está na lista desta aula.',
    );
  });

  it('cai nas mensagens de auth/status quando o code é desconhecido', () => {
    expect(errorMessage(apiError('NOVO', 503))).toMatch(/servidor/);
    expect(errorMessage(new TypeError('Network request failed'))).toMatch(/Sem conexão/);
    expect(errorMessage(apiError('NOVO', 400))).toBe('Algo deu errado. Tente novamente.');
  });

  it('todas as mensagens estão em português e terminam com ponto', () => {
    for (const message of Object.values(DOMAIN_ERROR_MESSAGES)) expect(message).toMatch(/\.$/);
  });
});
