import { describe, expect, it } from 'vitest';
import { idTokenProfile } from './social-link.js';

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (payload: object) => `${base64url({ alg: 'RS256' })}.${base64url(payload)}.x`;

describe('idTokenProfile (nome e foto do provedor, decisão 71)', () => {
  it('lê o nome e a foto (só HTTPS) do id_token', () => {
    expect(
      idTokenProfile(token({ name: ' Maria ', picture: 'https://lh3.googleusercontent.com/a/x' })),
    ).toEqual({ name: 'Maria', picture: 'https://lh3.googleusercontent.com/a/x' });
    expect(idTokenProfile(token({ name: '', picture: 'http://inseguro/x.png' }))).toEqual({
      name: null,
      picture: null,
    });
  });

  it('token ausente ou inválido não tem nome nem foto', () => {
    for (const value of [null, undefined, 'nao-e-jwt', 'a.!!!.c']) {
      expect(idTokenProfile(value)).toEqual({ name: null, picture: null });
    }
  });
});
