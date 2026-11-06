import { ApiError } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import { isStaleSessionError, sessionErrorMessage } from './sessions-errors';

const err = (status: number, code: string) => new ApiError({ status, code, message: 'x' });

describe('sessionErrorMessage', () => {
  it('traduz o 409 de remover quem já tem presença marcada', () => {
    expect(sessionErrorMessage(err(409, 'PRESENCE_ALREADY_MARKED'))).toContain(
      'já tem presença marcada',
    );
  });

  it('traduz os códigos de sessão e cai no genérico para os demais', () => {
    expect(sessionErrorMessage(err(409, 'PRESENCE_TOO_EARLY'))).toContain('início da aula');
    expect(sessionErrorMessage(err(409, 'CAPACITY_BELOW_CONFIRMED'))).toContain('vagas');
    expect(sessionErrorMessage(err(403, 'SPACE_READ_ONLY'))).toContain('suspenso');
    expect(sessionErrorMessage(err(400, 'ALGO_NOVO'))).toBe(
      'Não foi possível concluir. Tente novamente.',
    );
  });
});

describe('sessionErrorMessage: choque de horário', () => {
  it('mostra a aula que conflita ao adicionar o aluno (decisão 37)', () => {
    const error = new ApiError({
      status: 409,
      code: 'CLASS_SESSION_OVERLAP',
      message: 'x',
      details: {
        conflict: {
          classGroupName: 'Futevôlei Avançado',
          spaceName: 'Arena A',
          startsAt: '2026-11-05T22:00:00.000Z',
          endsAt: '2026-11-05T23:00:00.000Z',
        },
      },
    });
    expect(sessionErrorMessage(error)).toContain('Futevôlei Avançado (Arena A)');
  });
});

describe('isStaleSessionError', () => {
  it('marca os conflitos que pedem recarregar', () => {
    expect(isStaleSessionError(err(409, 'CLASS_SESSION_STATUS_CONFLICT'))).toBe(true);
    expect(isStaleSessionError(err(409, 'NOT_IN_SESSION'))).toBe(true);
    expect(isStaleSessionError(err(422, 'USER_NOT_FOUND'))).toBe(false);
    expect(isStaleSessionError(new TypeError('x'))).toBe(false);
  });
});
