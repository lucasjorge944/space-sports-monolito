import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DataCipher } from './data-cipher.js';

// Decisão 97: documento completo cifrado com AES-256-GCM na aplicação.

const key = () => randomBytes(32).toString('base64');

describe('DataCipher', () => {
  it('cifra e decifra com o mesmo contexto; o texto não aparece cifrado', () => {
    const cipher = new DataCipher(key());
    const token = cipher.encrypt('52998224725', 'space-1');
    expect(token).toMatch(/^v1\./);
    expect(token).not.toContain('52998224725');
    expect(cipher.encrypt('52998224725', 'space-1')).not.toBe(token);
    expect(cipher.decrypt(token, 'space-1')).toBe('52998224725');
  });

  it('não decifra com outra chave, outro contexto ou texto adulterado', () => {
    const cipher = new DataCipher(key());
    const token = cipher.encrypt('11222333000181', 'space-1');
    expect(new DataCipher(key()).decrypt(token, 'space-1')).toBeNull();
    expect(cipher.decrypt(token, 'space-2')).toBeNull();
    const parts = token.split('.');
    parts[3] = Buffer.from('outro').toString('base64url');
    expect(cipher.decrypt(parts.join('.'), 'space-1')).toBeNull();
    expect(cipher.decrypt('texto-qualquer', 'space-1')).toBeNull();
  });

  it('exige chave de 32 bytes', () => {
    expect(() => new DataCipher(randomBytes(16).toString('base64'))).toThrow();
  });
});
