import {
  clearAllLabel,
  MIN_RATING_EMPTY,
  MIN_RATING_LABEL,
  MIN_RATING_WITH_OTHERS_EMPTY_DESCRIPTION,
  mapEmptyMessage,
  sortOptions,
} from './labels';

describe('textos da nota no Explorar (decisão 109)', () => {
  it('"Ordenar por": "Mais perto" com localização, "Por nome" sem; depois "Melhor avaliados"', () => {
    expect(sortOptions(true).map((option) => [option.value, option.label])).toEqual([
      ['distance', 'Mais perto'],
      ['rating', 'Melhor avaliados'],
    ]);
    expect(sortOptions(false)[0]?.label).toBe('Por nome');
  });

  it('vazio com "4+ estrelas" explica a regra das 5 avaliações e oferece tirar o filtro', () => {
    expect(MIN_RATING_LABEL).toBe('4+ estrelas');
    expect(MIN_RATING_EMPTY.title).toBe('Nenhum espaço com 4+ estrelas');
    expect(MIN_RATING_EMPTY.description).toMatch(/a nota aparece a partir de 5 avaliações/);
    expect(MIN_RATING_EMPTY.action).toBe('Tirar “4+ estrelas”');
  });

  it('mapa sem pins: com o "4+ estrelas", lembra que só entram espaços com nota', () => {
    expect(mapEmptyMessage(false)).toBe('Nenhum espaço com localização para estes filtros.');
    expect(mapEmptyMessage(true)).toMatch(
      /só mostra espaços com nota \(a partir de 5 avaliações\)/,
    );
  });

  it('vazio com o "4+ estrelas" e mais filtro: lembra a regra; "Limpar" diz se a busca sai', () => {
    expect(MIN_RATING_WITH_OTHERS_EMPTY_DESCRIPTION).toMatch(
      /^Tente outro nome ou afrouxe os filtros\./,
    );
    expect(MIN_RATING_WITH_OTHERS_EMPTY_DESCRIPTION).toMatch(/a partir de 5 avaliações/);
    expect(clearAllLabel(false)).toBe('Limpar filtros');
    expect(clearAllLabel(true)).toBe('Limpar busca e filtros');
  });
});
