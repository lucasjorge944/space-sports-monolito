import { describe, expect, it } from 'vitest';
import {
  collectErrors,
  normalizeEmail,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validateRequiredPassword,
} from './validation';

describe('validateEmail', () => {
  it('exige preenchimento e formato', () => {
    expect(validateEmail('  ')).toBe('Informe seu e-mail');
    expect(validateEmail('ana@')).toBe('Informe um e-mail válido');
    expect(validateEmail('ana@exemplo.com')).toBeUndefined();
  });
});

describe('normalizeEmail', () => {
  it('apara e põe em minúsculas', () => {
    expect(normalizeEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com');
  });
});

describe('validateNewPassword', () => {
  it('respeita 8 a 128 caracteres', () => {
    expect(validateNewPassword('1234567')).toContain('pelo menos 8');
    expect(validateNewPassword('12345678')).toBeUndefined();
    expect(validateNewPassword('a'.repeat(128))).toBeUndefined();
    expect(validateNewPassword('a'.repeat(129))).toContain('no máximo 128');
  });
});

describe('demais validações', () => {
  it('nome e senha de login obrigatórios', () => {
    expect(validateName('  ')).toBe('Informe seu nome');
    expect(validateName('Ana')).toBeUndefined();
    expect(validateRequiredPassword('')).toBe('Informe sua senha');
    expect(validateRequiredPassword('x')).toBeUndefined();
  });
  it('confirmação precisa bater', () => {
    expect(validatePasswordConfirmation('abc', 'abd')).toBe('As senhas não conferem');
    expect(validatePasswordConfirmation('abc', 'abc')).toBeUndefined();
  });
});

describe('collectErrors', () => {
  it('devolve só os campos com erro, ou undefined se tudo válido', () => {
    expect(collectErrors({ a: 'erro', b: undefined })).toEqual({ a: 'erro' });
    expect(collectErrors({ a: undefined })).toBeUndefined();
  });
});
