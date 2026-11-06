import { ApiError } from '@space-sports/api-client';
import { AUTH_ERROR_MESSAGES, authErrorField, authErrorMessage } from './errors';

const apiError = (code: string, status = 400) => new ApiError({ status, code, message: 'English' });

describe('authErrorMessage', () => {
  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'E-mail ou senha incorretos.'],
    ['USER_ALREADY_EXISTS', 'Já existe uma conta com este e-mail'],
    ['INVALID_PHONE_NUMBER', 'Informe o telefone com DDD'],
    ['IMAGE_NOT_SQUARE', 'A foto precisa ser quadrada. Recorte e tente de novo.'],
    ['STORAGE_UNAVAILABLE', 'O envio de fotos está indisponível no momento. Tente mais tarde.'],
    ['INVALID_TOKEN', 'O link é inválido ou já foi usado. Peça um novo.'],
    ['USER_BLOCKED', 'Sua conta está bloqueada. Fale com o suporte.'],
    [
      'ACCOUNT_INACTIVE',
      'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.',
    ],
  ])('traduz %s pelo code', (code, message) => {
    expect(authErrorMessage(apiError(code))).toBe(message);
  });

  it('liga ao campo só o que pertence a ele', () => {
    expect(authErrorField(apiError('USER_ALREADY_EXISTS'))).toBe('email');
    expect(authErrorField(apiError('invalid_phone_number'))).toBe('phone');
    expect(authErrorField({ code: 'INVALID_PHONE_NUMBER', status: 400 })).toBe('phone');
    expect(authErrorField(apiError('IMAGE_TOO_LARGE'))).toBeNull();
    expect(authErrorField(new Error('rede'))).toBeNull();
  });

  it('não diferencia maiúsculas do code', () => {
    expect(authErrorMessage(apiError('invalid_phone_number'))).toBe(
      AUTH_ERROR_MESSAGES.INVALID_PHONE_NUMBER,
    );
  });

  it('nunca devolve o texto cru em inglês da API', () => {
    expect(authErrorMessage(apiError('ALGO_NOVO'))).toBe('Algo deu errado. Tente novamente.');
  });

  it('usa o status quando o code é desconhecido', () => {
    expect(authErrorMessage(apiError('X', 429))).toBe(AUTH_ERROR_MESSAGES.TOO_MANY_REQUESTS);
    expect(authErrorMessage(apiError('X', 503))).toBe(AUTH_ERROR_MESSAGES.INTERNAL_SERVER_ERROR);
    expect(authErrorMessage(apiError('X', 404))).toBe(
      'Este recurso não está disponível no momento.',
    );
  });

  it('entende o erro do cliente do Better Auth ({ code, status })', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(
      'E-mail ou senha incorretos.',
    );
  });

  it('erro de rede vira aviso de conexão', () => {
    expect(authErrorMessage(new TypeError('Network request failed'))).toMatch(/Sem conexão/);
  });

  it('erro de rede do expo/fetch ("fetch failed") também vira aviso de conexão', () => {
    class FetchError extends Error {}
    expect(authErrorMessage(new FetchError('fetch failed'))).toMatch(/Sem conexão/);
  });

  it('erro qualquer vira mensagem genérica', () => {
    expect(authErrorMessage(new Error('boom'))).toBe('Algo deu errado. Tente novamente.');
    expect(authErrorMessage(undefined)).toBe('Algo deu errado. Tente novamente.');
  });

  it('todas as mensagens estão em português (sem texto da API em inglês)', () => {
    for (const [code, message] of Object.entries(AUTH_ERROR_MESSAGES)) {
      // A mensagem que entra no campo não tem ponto final (doc 05).
      expect(message).toMatch(authErrorField(apiError(code)) ? /[^.!]$/ : /[.!]$/);
      expect(message).not.toMatch(/\b(invalid|failed|not found|password too)\b/i);
    }
  });
});
