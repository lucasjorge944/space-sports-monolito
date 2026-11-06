import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  FALLBACK_ERROR_MESSAGE,
  getAuthErrorCode,
  messageForCode,
  NETWORK_ERROR_MESSAGE,
  normalizeAuthErrorCode,
} from './errors';

describe('normalizeAuthErrorCode', () => {
  it('aceita minúsculas e hífens (parâmetro ?error= dos redirects)', () => {
    expect(normalizeAuthErrorCode('invalid_token')).toBe('INVALID_TOKEN');
    expect(normalizeAuthErrorCode('access-denied')).toBe('ACCESS_DENIED');
  });
});

describe('messageForCode', () => {
  it('traduz códigos conhecidos', () => {
    expect(messageForCode('INVALID_EMAIL_OR_PASSWORD')).toBe('E-mail ou senha incorretos.');
    expect(messageForCode('token_expired')).toBe('O link expirou. Peça um novo.');
  });
  it('devolve undefined para código desconhecido ou ausente', () => {
    expect(messageForCode('ALGO_NOVO')).toBeUndefined();
    expect(messageForCode(undefined)).toBeUndefined();
  });
});

describe('getAuthErrorCode', () => {
  it('lê o formato padrão da API ({ error: { code } }) repassado pelo client', () => {
    expect(getAuthErrorCode({ error: { code: 'USER_ALREADY_EXISTS' }, status: 422 })).toBe(
      'USER_ALREADY_EXISTS',
    );
  });
  it('lê o formato nativo do Better Auth ({ code })', () => {
    expect(getAuthErrorCode({ code: 'INVALID_TOKEN', status: 400 })).toBe('INVALID_TOKEN');
  });
  it('ignora valores sem código', () => {
    expect(getAuthErrorCode(null)).toBeUndefined();
    expect(getAuthErrorCode({ status: 500 })).toBeUndefined();
  });
});

describe('authErrorMessage', () => {
  it('traduz pelo código', () => {
    expect(authErrorMessage({ error: { code: 'USER_BLOCKED' }, status: 403 })).toBe(
      'Sua conta está bloqueada. Fale com o suporte.',
    );
  });
  it('traduz conta inativa, diferente de bloqueada', () => {
    const message = authErrorMessage({ error: { code: 'ACCOUNT_INACTIVE' }, status: 403 });
    expect(message).toContain('Conta inativa');
    expect(message).not.toBe(authErrorMessage({ error: { code: 'USER_BLOCKED' }, status: 403 }));
  });
  it('cai no status quando o código não é conhecido', () => {
    expect(authErrorMessage({ status: 429 })).toContain('Muitas tentativas');
    expect(authErrorMessage({ status: 503 })).toContain('Erro no servidor');
    expect(authErrorMessage({ status: 0 })).toBe(NETWORK_ERROR_MESSAGE);
  });
  it('usa a mensagem genérica no resto', () => {
    expect(authErrorMessage({ status: 400, error: { code: 'XYZ' } })).toBe(FALLBACK_ERROR_MESSAGE);
    expect(authErrorMessage(undefined)).toBe(FALLBACK_ERROR_MESSAGE);
  });
});
