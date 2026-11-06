import { describe, expect, it } from 'vitest';
import { parseSocialProviders } from './providers';

describe('parseSocialProviders', () => {
  it('vazio ou ausente: nenhum provedor', () => {
    expect(parseSocialProviders(undefined)).toEqual([]);
    expect(parseSocialProviders('')).toEqual([]);
  });
  it('lê a lista ignorando espaços, caixa e valores desconhecidos', () => {
    expect(parseSocialProviders(' Apple , google,facebook')).toEqual(['google', 'apple']);
    expect(parseSocialProviders('google')).toEqual(['google']);
  });
});
