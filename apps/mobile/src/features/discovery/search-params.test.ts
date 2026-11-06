import { DEFAULT_FILTERS } from './filters-store';
import { buildSearchParams } from './search-params';

describe('buildSearchParams', () => {
  it('sem localização nem filtros só manda o limite (lista por nome)', () => {
    expect(buildSearchParams(DEFAULT_FILTERS, null, '')).toEqual({ limit: 20 });
  });

  it('com localização manda lat/lng e o raio', () => {
    expect(buildSearchParams(DEFAULT_FILTERS, { lat: -19.92, lng: -43.94 }, '')).toEqual({
      lat: -19.92,
      lng: -43.94,
      radiusKm: 10,
      limit: 20,
    });
  });

  it('não manda o raio sem localização, mesmo alterado', () => {
    const params = buildSearchParams({ ...DEFAULT_FILTERS, radiusKm: 50 }, null, '');
    expect(params).not.toHaveProperty('radiusKm');
  });

  it('junta esporte, serviço, infraestrutura (csv) e busca sem espaços sobrando', () => {
    const params = buildSearchParams(
      {
        ...DEFAULT_FILTERS,
        sport: 'beach-tennis',
        service: 'RENTAL',
        amenities: ['chuveiro', 'bar'],
      },
      null,
      '  arena ',
    );
    expect(params).toEqual({
      sport: 'beach-tennis',
      service: 'RENTAL',
      amenities: 'chuveiro,bar',
      q: 'arena',
      limit: 20,
    });
  });

  it('"4+ estrelas" manda minRating=4 e "Melhor avaliados" manda sort=rating (decisão 109)', () => {
    const coords = { lat: -19.92, lng: -43.94 };
    expect(
      buildSearchParams({ ...DEFAULT_FILTERS, minRating: 4, sort: 'rating' }, coords, ''),
    ).toEqual({ ...coords, radiusKm: 10, minRating: 4, sort: 'rating', limit: 20 });
  });

  it('"Mais perto" (padrão) não manda sort', () => {
    expect(buildSearchParams(DEFAULT_FILTERS, null, '')).not.toHaveProperty('sort');
  });

  it('"Melhor avaliados" sem localização também vale (a API desempata pelo nome)', () => {
    expect(buildSearchParams({ ...DEFAULT_FILTERS, sort: 'rating' }, null, '')).toEqual({
      sort: 'rating',
      limit: 20,
    });
  });

  it('no mapa, só o "4+ estrelas" vale: sem sort, com o limite do mapa', () => {
    const params = buildSearchParams(
      { ...DEFAULT_FILTERS, minRating: 4, sort: 'rating' },
      null,
      '',
      { limit: 50, context: 'map' },
    );
    expect(params).toEqual({ minRating: 4, limit: 50 });
  });
});
