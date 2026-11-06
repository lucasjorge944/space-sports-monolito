import { describe, expect, it } from 'vitest';
import { drawCreatives } from './ad-draw.js';

/** Gerador determinístico (mulberry32) para os testes estatísticos. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const campaign = (campaignId: string, weight: number, creatives = [`${campaignId}-1`]) => ({
  campaignId,
  weight,
  creatives,
});

describe('drawCreatives', () => {
  it('não repete campanha e respeita o máximo', () => {
    const random = seeded(1);
    const candidates = [
      campaign('a', 1, ['a-1', 'a-2', 'a-3']),
      campaign('b', 5, ['b-1', 'b-2']),
      campaign('c', 10),
    ];
    for (let i = 0; i < 200; i++) {
      const drawn = drawCreatives(candidates, 2, random);
      expect(drawn).toHaveLength(2);
      expect(new Set(drawn.map((item) => item[0])).size).toBe(2);
    }
    expect(drawCreatives(candidates, 10, random)).toHaveLength(3);
  });

  it('pula campanha sem peça', () => {
    expect(drawCreatives([campaign('a', 3, []), campaign('b', 1)], 5)).toEqual(['b-1']);
  });

  it('a primeira posição segue o peso (9:1 ≈ 90%)', () => {
    const random = seeded(42);
    const candidates = [campaign('pesada', 9), campaign('leve', 1)];
    let first = 0;
    const rounds = 5000;
    for (let i = 0; i < rounds; i++) {
      if (drawCreatives(candidates, 2, random)[0] === 'pesada-1') first += 1;
    }
    expect(first / rounds).toBeGreaterThan(0.87);
    expect(first / rounds).toBeLessThan(0.93);
  });

  it('com uma vaga, a chance de cada campanha é proporcional ao peso', () => {
    const random = seeded(7);
    const candidates = [campaign('a', 1), campaign('b', 2), campaign('c', 7)];
    const counts: Record<string, number> = {};
    const rounds = 10_000;
    for (let i = 0; i < rounds; i++) {
      const [drawn] = drawCreatives(candidates, 1, random);
      counts[drawn as string] = (counts[drawn as string] ?? 0) + 1;
    }
    expect((counts['a-1'] ?? 0) / rounds).toBeCloseTo(0.1, 1);
    expect((counts['b-1'] ?? 0) / rounds).toBeCloseTo(0.2, 1);
    expect((counts['c-1'] ?? 0) / rounds).toBeCloseTo(0.7, 1);
  });

  it('alterna as peças da mesma campanha', () => {
    const random = seeded(3);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      for (const item of drawCreatives([campaign('a', 1, ['a-1', 'a-2', 'a-3'])], 1, random)) {
        seen.add(item);
      }
    }
    expect([...seen].sort()).toEqual(['a-1', 'a-2', 'a-3']);
  });
});
