import {
  clearSearchAndFilters,
  countActiveFilters,
  DEFAULT_FILTERS,
  getFilters,
  isOnlyMinRatingOn,
  resetFilters,
  setFilters,
  toggleAmenity,
} from './filters-store';

describe('filters-store', () => {
  afterEach(() => {
    resetFilters();
    setFilters({ q: '' });
  });

  it('alterna infraestrutura', () => {
    expect(toggleAmenity([], 'bar')).toEqual(['bar']);
    expect(toggleAmenity(['bar', 'chuveiro'], 'bar')).toEqual(['chuveiro']);
  });

  it('conta filtros ativos, sem a busca por nome', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(
      countActiveFilters({
        ...DEFAULT_FILTERS,
        q: 'x',
        sport: 'futevolei',
        amenities: ['a', 'b'],
        radiusKm: 25,
      }),
    ).toBe(4);
  });

  it('"4+ estrelas" e "Melhor avaliados" contam no selo; no mapa, só o "4+ estrelas"', () => {
    const filters = { ...DEFAULT_FILTERS, minRating: 4, sort: 'rating' as const };
    expect(countActiveFilters(filters)).toBe(2);
    expect(countActiveFilters(filters, 'map')).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, sort: 'rating' }, 'map')).toBe(0);
  });

  it('o padrão é sem nota mínima e "Mais perto"', () => {
    expect(DEFAULT_FILTERS.minRating).toBeNull();
    expect(DEFAULT_FILTERS.sort).toBe('distance');
    expect(countActiveFilters({ ...DEFAULT_FILTERS, sort: 'distance' })).toBe(0);
  });

  it('limpar tira o "4+ estrelas" e volta a "Mais perto"', () => {
    setFilters({ minRating: 4, sort: 'rating', sport: 'futevolei' });
    resetFilters();
    expect(getFilters()).toEqual(DEFAULT_FILTERS);
  });

  it('limpar no mapa tira o "4+ estrelas", mas mantém a ordem do Explorar (que lá não aparece)', () => {
    setFilters({ minRating: 4, sort: 'rating', radiusKm: 25 });
    resetFilters('map');
    expect(getFilters()).toEqual({ ...DEFAULT_FILTERS, sort: 'rating' });
  });

  it('limpar filtros mantém o texto da busca', () => {
    setFilters({ q: 'arena', sport: 'futevolei' });
    resetFilters();
    expect(getFilters()).toEqual({ ...DEFAULT_FILTERS, q: 'arena' });
  });

  it('"Limpar filtros" do vazio do Explorar tira também a busca por nome', () => {
    setFilters({ q: 'arena', minRating: 4, sort: 'rating' });
    clearSearchAndFilters();
    expect(getFilters()).toEqual(DEFAULT_FILTERS);
  });

  it('o "4+ estrelas" é o único filtro só sem busca e sem outro filtro; a ordem não conta', () => {
    const on = { ...DEFAULT_FILTERS, minRating: 4 };
    expect(isOnlyMinRatingOn(on)).toBe(true);
    expect(isOnlyMinRatingOn({ ...on, sort: 'rating' })).toBe(true);
    expect(isOnlyMinRatingOn({ ...on, q: '  ' })).toBe(true);
    expect(isOnlyMinRatingOn({ ...on, q: 'arena' })).toBe(false);
    expect(isOnlyMinRatingOn({ ...on, sport: 'futevolei' })).toBe(false);
    expect(isOnlyMinRatingOn({ ...on, amenities: ['bar'] })).toBe(false);
    expect(isOnlyMinRatingOn({ ...on, radiusKm: 25 })).toBe(false);
    expect(isOnlyMinRatingOn(DEFAULT_FILTERS)).toBe(false);
  });
});
