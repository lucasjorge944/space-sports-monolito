import { describe, expect, it } from 'vitest';
import { normalizeCep } from './address';

describe('normalizeCep', () => {
  it('devolve os 8 dígitos, com ou sem pontuação', () => {
    expect(normalizeCep('30130010')).toBe('30130010');
    expect(normalizeCep('30130-010')).toBe('30130010');
    expect(normalizeCep('30.130-010')).toBe('30130010');
    expect(normalizeCep(' 30130 010 ')).toBe('30130010');
  });

  it('recusa o que não tem 8 dígitos', () => {
    for (const value of ['', '3013001', '301300100', '3013001a', 'abc30130010']) {
      expect(normalizeCep(value)).toBeNull();
    }
  });
});
