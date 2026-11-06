import { describe, expect, it } from 'vitest';
import { reviewLayout, starFills } from './rating';

describe('starFills', () => {
  it('nota inteira: cheias e vazias', () => {
    expect(starFills(4)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(starFills(1)).toEqual(['full', 'empty', 'empty', 'empty', 'empty']);
  });

  it('média: arredonda para a meia estrela mais próxima', () => {
    expect(starFills(4.2)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(starFills(4.3)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starFills(4.7)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starFills(4.8)).toEqual(['full', 'full', 'full', 'full', 'full']);
    expect(starFills(2.5)).toEqual(['full', 'full', 'half', 'empty', 'empty']);
  });

  it('limita fora de 0–5', () => {
    expect(starFills(-1)).toEqual(Array(5).fill('empty'));
    expect(starFills(7)).toEqual(Array(5).fill('full'));
  });
});

describe('reviewLayout', () => {
  it('estrelas tocáveis com alvo ≥ 44 e as cinco cabem na tela de 320 (288 úteis)', () => {
    for (const star of [reviewLayout.star.prompt, reviewLayout.star.input]) {
      expect(star.hitSize).toBeGreaterThanOrEqual(44);
      expect(5 * star.hitSize + 4 * star.gap).toBeLessThanOrEqual(320 - 2 * 16);
    }
  });
});
