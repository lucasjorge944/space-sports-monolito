import { describe, expect, it } from 'vitest';
import { sportIconKey, sportIconSvg, sportIcons } from './sport-icons';

// Slugs do catálogo do seed (apps/api/src/db/seed.ts).
const SEED_SPORTS = ['futevolei', 'beach-tennis', 'volei-praia'];

describe('ícones de esporte', () => {
  it.each(SEED_SPORTS)('o esporte %s do seed tem ícone pelo slug', (slug) => {
    expect(sportIconKey({ slug, icon: null })).toBe(slug);
  });

  it('o `icon` do catálogo vence o slug; chave desconhecida cai no slug ou em null', () => {
    expect(sportIconKey({ slug: 'outro', icon: 'futevolei' })).toBe('futevolei');
    expect(sportIconKey({ slug: 'beach-tennis', icon: 'nao-existe' })).toBe('beach-tennis');
    expect(sportIconKey({ slug: 'padel', icon: null })).toBeNull();
    expect(sportIconKey({ slug: 'toString' })).toBeNull();
  });

  it('gera SVG na grade do Lucide, com a cor pedida e sem cor fixa', () => {
    for (const key of Object.keys(sportIcons) as (keyof typeof sportIcons)[]) {
      const svg = sportIconSvg(key, { color: '#06202E' });
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="#06202E"');
      expect(svg).toContain('stroke-width="2"');
      expect(sportIcons[key].join('')).not.toMatch(/fill=|stroke=|#[0-9a-f]{3,8}/i);
    }
  });
});
