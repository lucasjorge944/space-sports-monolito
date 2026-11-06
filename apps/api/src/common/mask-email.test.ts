import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('mantém só a primeira letra do usuário e o domínio', () => {
    expect(maskEmail('ana.souza@exemplo.com')).toBe('a***@exemplo.com');
    expect(maskEmail('a@exemplo.com')).toBe('a***@exemplo.com');
  });

  it('valor sem formato de e-mail não vaza nada', () => {
    expect(maskEmail('sem-arroba')).toBe('***');
    expect(maskEmail('@exemplo.com')).toBe('***');
  });
});
