import { describe, expect, it } from 'vitest';
import { unsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
const ID = '018f0000-0000-7000-8000-000000000000';

describe('token de descadastro', () => {
  it('devolve o id do contato do token assinado', () => {
    expect(verifyUnsubscribeToken(SECRET, unsubscribeToken(SECRET, ID))).toBe(ID);
  });

  it('recusa assinatura alterada, de outro segredo ou de outro contato', () => {
    const token = unsubscribeToken(SECRET, ID);
    expect(verifyUnsubscribeToken(SECRET, `${token.slice(0, -1)}x`)).toBeNull();
    expect(verifyUnsubscribeToken(`${SECRET}-outro`, token)).toBeNull();
    const signature = token.split('.')[1];
    expect(
      verifyUnsubscribeToken(SECRET, `018f0000-0000-7000-8000-000000000001.${signature}`),
    ).toBeNull();
  });

  it('recusa formato inválido', () => {
    for (const token of ['', 'abc', `${ID}.`, `nao-e-uuid.assinatura`, `${ID}.a.b`]) {
      expect(verifyUnsubscribeToken(SECRET, token)).toBeNull();
    }
  });
});
