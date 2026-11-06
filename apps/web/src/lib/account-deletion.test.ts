import { ApiError } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import { deletionRequestErrorMessage, deletionRequestFromForm } from './account-deletion';

const valid = { email: ' Maria@Exemplo.com ', password: 'segredo123', reason: '' };

describe('deletionRequestFromForm', () => {
  it('normaliza o e-mail e omite o motivo vazio', () => {
    expect(deletionRequestFromForm(valid)).toEqual({
      ok: true,
      data: { email: 'maria@exemplo.com', password: 'segredo123' },
    });
  });

  it('envia o motivo sem espaços nas pontas e a senha como foi digitada', () => {
    const result = deletionRequestFromForm({
      ...valid,
      password: ' com espaço ',
      reason: '  Não uso mais  ',
    });
    expect(result).toEqual({
      ok: true,
      data: { email: 'maria@exemplo.com', password: ' com espaço ', reason: 'Não uso mais' },
    });
  });

  it('exige e-mail válido e senha', () => {
    const empty = deletionRequestFromForm({ email: '', password: '', reason: '' });
    expect(empty.ok === false && empty.errors).toEqual({
      email: 'Informe seu e-mail',
      password: 'Informe sua senha',
    });
    const invalid = deletionRequestFromForm({ ...valid, email: 'maria' });
    expect(invalid.ok === false && invalid.errors.email).toBe('Informe um e-mail válido');
  });

  it('limita o motivo a 500 caracteres', () => {
    const result = deletionRequestFromForm({ ...valid, reason: 'x'.repeat(501) });
    expect(result.ok === false && result.errors.reason).toContain('500');
    expect(deletionRequestFromForm({ ...valid, reason: 'x'.repeat(500) }).ok).toBe(true);
  });
});

describe('deletionRequestErrorMessage', () => {
  const err = (status: number, code: string) => new ApiError({ status, code, message: 'x' });

  it('explica o limite de tentativas', () => {
    expect(deletionRequestErrorMessage(err(429, 'TOO_MANY_REQUESTS'))).toContain(
      'Muitas tentativas',
    );
  });

  it('trata falha de servidor, de rede e erros desconhecidos', () => {
    expect(deletionRequestErrorMessage(err(502, 'HTTP_ERROR'))).toContain('indisponível');
    expect(deletionRequestErrorMessage(new TypeError('fetch failed'))).toContain('Sem conexão');
    expect(deletionRequestErrorMessage(err(400, 'ALGO_NOVO'))).toBe(
      'Não foi possível enviar o pedido. Tente novamente.',
    );
  });
});
