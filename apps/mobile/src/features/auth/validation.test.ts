import { normalizeApiUrl, parseSocialProviders } from './config';
import {
  formatPhone,
  phoneToE164,
  validateEmail,
  validateNewPassword,
  validatePhone,
} from './validation';

describe('telefone (decisão 64)', () => {
  it.each([
    ['(31) 99999-8888', '+5531999998888'],
    ['31999998888', '+5531999998888'],
    ['+55 31 99999-8888', '+5531999998888'],
    ['5531999998888', '+5531999998888'],
    ['(31) 3222-1234', '+553132221234'],
  ])('phoneToE164(%s) envia em E.164', (input, expected) => {
    expect(phoneToE164(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '123',
    '(31) 9999',
    '(31) 9999-88',
    '+55 31 999',
    // Só telefone brasileiro, como a API exige.
    '+1 415 555 0132',
    // Nove dígitos sem o 9 na frente e fixo começando com 1.
    '(31) 89999-8888',
    '(31) 1222-1234',
    // DDD com zero.
    '(01) 99999-8888',
  ])('phoneToE164(%j) é inválido', (input) => {
    expect(phoneToE164(input)).toBeNull();
  });

  it('a mensagem diz o que fazer', () => {
    expect(validatePhone('(31) 9999')).toBe('Informe o telefone com DDD');
    expect(validatePhone('')).toBe('Informe o telefone com DDD');
    expect(validatePhone('(31) 99999-8888')).toBeNull();
  });

  it('formata números brasileiros', () => {
    expect(formatPhone('+5531999998888')).toBe('+55 (31) 99999-8888');
    expect(formatPhone('+14155550132')).toBe('+14155550132');
  });
});

describe('formulário', () => {
  it('e-mail', () => {
    expect(validateEmail('ana@example.com')).toBeNull();
    expect(validateEmail('ana')).toBe('Confira o e-mail: falta o @');
    expect(validateEmail('ana@')).toBe('Confira o e-mail');
    expect(validateEmail('  ')).toMatch(/Informe/);
  });

  it('senha nova: 8 a 128 caracteres', () => {
    expect(validateNewPassword('1234567')).toMatch(/8 caracteres/);
    expect(validateNewPassword('12345678')).toBeNull();
    expect(validateNewPassword('a'.repeat(129))).toMatch(/128 caracteres/);
  });
});

describe('config', () => {
  it('lê os provedores sociais habilitados', () => {
    expect(parseSocialProviders('google, Apple ,facebook,google')).toEqual(['google', 'apple']);
    expect(parseSocialProviders('')).toEqual([]);
    expect(parseSocialProviders(undefined)).toEqual([]);
  });

  it('normaliza a URL da API (sem barra final nem /v1)', () => {
    expect(normalizeApiUrl('https://api.test/v1/')).toBe('https://api.test');
    expect(normalizeApiUrl(undefined)).toBe('http://localhost:3333');
  });
});
