import { describe, expect, it } from 'vitest';
import {
  toCityInput,
  toSportInput,
  validateAmenity,
  validateCity,
  validateSport,
} from './catalog-forms';

describe('catálogos', () => {
  it('valida slug, nome e máximo de jogadores do esporte', () => {
    expect(validateSport({ slug: 'futevolei', name: 'Futevôlei', defaultMaxPlayers: '4' })).toEqual(
      {},
    );
    expect(validateSport({ slug: 'Fute Vôlei', name: '', defaultMaxPlayers: '21' })).toEqual({
      name: expect.any(String),
      slug: expect.any(String),
      defaultMaxPlayers: expect.any(String),
    });
    expect(validateAmenity({ slug: 'a', name: 'Churrasqueira' }).slug).toBeDefined();
  });

  it('exige a UF em maiúsculas na cidade', () => {
    expect(validateCity({ name: 'Belo Horizonte', state: 'MG' })).toEqual({});
    expect(validateCity({ name: 'BH', state: 'mg' }).state).toBeDefined();
  });

  it('omite opcionais vazios na entrada da API', () => {
    expect(
      toSportInput({ slug: ' futevolei ', name: 'Futevôlei', icon: '', defaultMaxPlayers: '' }),
    ).toEqual({
      slug: 'futevolei',
      name: 'Futevôlei',
    });
    expect(toCityInput({ name: 'Contagem', state: 'MG', timezone: '', active: true })).toEqual({
      name: 'Contagem',
      state: 'MG',
      active: true,
    });
  });
});
