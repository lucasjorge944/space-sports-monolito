import { DEFAULT_FILTERS } from '@/features/discovery/filters-store';
import { exploreSections, hasContentFilters } from './sections';

const base = { query: '', filters: DEFAULT_FILTERS, hasLocation: true };

describe('exploreSections (RF-SPACE-12, RF-SPACE-13, RF-ADS-04)', () => {
  it('sem busca e sem filtro: tudo aparece, com "Espaços perto de você"', () => {
    expect(exploreSections(base)).toEqual({
      shortcuts: true,
      hero: true,
      recents: true,
      listTitle: 'Espaços perto de você',
    });
  });

  it('sem localização, o título é "Espaços"', () => {
    expect(exploreSections({ ...base, hasLocation: false }).listTitle).toBe('Espaços');
  });

  it.each([
    ['esporte', { sport: 'futevolei' }],
    ['serviço', { service: 'CLASSES' as const }],
    ['infraestrutura', { amenities: ['vestiario'] }],
    ['"4+ estrelas"', { minRating: 4 }],
    ['ordem "Melhor avaliados"', { sort: 'rating' as const }],
  ])('filtro de %s: atalhos ficam; carrossel e recentes somem; "Resultados"', (_, patch) => {
    expect(exploreSections({ ...base, filters: { ...DEFAULT_FILTERS, ...patch } })).toEqual({
      shortcuts: true,
      hero: false,
      recents: false,
      listTitle: 'Resultados',
    });
  });

  it('busca por nome esconde atalhos, carrossel e recentes (com ou sem filtro)', () => {
    const expected = { shortcuts: false, hero: false, recents: false, listTitle: 'Resultados' };
    expect(exploreSections({ ...base, query: 'arena' })).toEqual(expected);
    expect(
      exploreSections({
        ...base,
        query: 'arena',
        filters: { ...DEFAULT_FILTERS, sport: 'futevolei' },
      }),
    ).toEqual(expected);
  });

  it('busca só com espaços em branco não conta', () => {
    expect(exploreSections({ ...base, query: '   ' }).shortcuts).toBe(true);
  });

  it('o raio sozinho não esconde nada nem troca o título', () => {
    for (const radiusKm of [2, 5, 25, 50]) {
      const filters = { ...DEFAULT_FILTERS, radiusKm };
      expect(exploreSections({ ...base, filters })).toEqual(exploreSections(base));
    }
  });
});

describe('hasContentFilters', () => {
  it('conta "4+ estrelas" e "Melhor avaliados"; "Mais perto" não', () => {
    expect(hasContentFilters({ ...DEFAULT_FILTERS, minRating: 4 })).toBe(true);
    expect(hasContentFilters({ ...DEFAULT_FILTERS, sort: 'rating' })).toBe(true);
    expect(hasContentFilters({ ...DEFAULT_FILTERS, sort: 'distance' })).toBe(false);
  });

  it('conta esporte, serviço e infraestrutura, mas não o raio', () => {
    expect(hasContentFilters(DEFAULT_FILTERS)).toBe(false);
    const radiusOnly = { ...DEFAULT_FILTERS, radiusKm: 50 };
    expect(hasContentFilters(radiusOnly)).toBe(false);
    expect(hasContentFilters({ ...DEFAULT_FILTERS, sport: 'futevolei' })).toBe(true);
    expect(hasContentFilters({ ...DEFAULT_FILTERS, service: 'RENTAL' })).toBe(true);
    expect(hasContentFilters({ ...DEFAULT_FILTERS, amenities: ['bar'] })).toBe(true);
  });
});
