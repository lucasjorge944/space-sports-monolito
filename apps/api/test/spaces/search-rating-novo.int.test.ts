import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../auth/helpers.js';
import { BH, type Catalog, createSpace, seedCatalog } from './fixtures.js';

// QA da decisão 109 (AV2.4), privacidade do "Novo": a média de um espaço com menos de 5 avaliações
// (RF-REVIEW-03, decisão 102) não aparece em nenhum campo da resposta, do cursor nem na ordem.
// Prova por metamorfose: trocar a média escondida dos "Novo" não pode mudar nada que a busca devolve.

type Card = Record<string, unknown> & {
  id: string;
  slug: string;
  name: string;
  rating: { count: number; average: number | null };
};
type Page = { items: Card[]; nextCursor: string | null };
type Query = Record<string, string | number>;

describe('busca por nota: a média do "Novo" não vaza (decisão 109, decisão 102)', () => {
  let t: TestApp;
  let catalog: Catalog;
  const ids: Record<string, string> = {};

  /** Contagem e soma escondidas de cada "Novo" (antes de embaralhar). */
  const novos: Record<string, { count: number; sum: number }> = {
    'novo-a': { count: 4, sum: 4 }, // média escondida 1,0
    'novo-b': { count: 4, sum: 20 }, // 5,0
    'novo-c': { count: 3, sum: 15 }, // 5,0
    'novo-d': { count: 1, sum: 1 }, // 1,0
    'novo-e': { count: 2, sum: 10 }, // 5,0
  };

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    const make = async (
      slug: string,
      name: string,
      location: (typeof BH)[keyof typeof BH] | null,
      rating?: { count: number; sum: number },
    ) => {
      ids[slug] = (
        await createSpace(t.db, catalog, { slug, name, location, ...(rating ? { rating } : {}) })
      ).id;
    };
    // Nota pública.
    await make('zeta', 'Arena Zeta', BH.savassi, { count: 5, sum: 20 }); // 4,0
    await make('alfa', 'Arena Alfa', BH.center, { count: 5, sum: 15 }); // 3,0
    // "Novo": em ordem de nome, a média escondida vai 1,0 → 5,0 → 5,0 → 1,0 → 5,0; em ordem de
    // distância (do centro), a mais escondida alta fica longe e a baixa, perto.
    await make('novo-a', 'Arena Novo A', BH.center, novos['novo-a']);
    await make('novo-b', 'Arena Novo B', BH.contagem, novos['novo-b']);
    await make('novo-c', 'Arena Novo C', BH.pampulha, novos['novo-c']);
    await make('novo-d', 'Arena Novo D', BH.savassi, novos['novo-d']);
    await make('novo-e', 'Arena Novo E', BH.contagem, novos['novo-e']);
    // Sem nenhuma avaliação, para comparar as chaves da resposta.
    await make('zero', 'Arena Zero', BH.center);
    // Gêmeos "Novo": tudo igual (nome, lugar, quadras, preço, contagem), só a média escondida muda.
    await make('gemeo-baixo', 'Arena Gêmea', BH.pampulha, { count: 4, sum: 4 });
    await make('gemeo-alto', 'Arena Gêmea', BH.pampulha, { count: 4, sum: 20 });
  });
  afterAll(() => t.close());

  const center = { lat: BH.center.lat, lng: BH.center.lng };
  const search = async (query: Query = {}): Promise<Page> =>
    (await t.http().get('/v1/spaces').query(query).expect(200)).body;
  const slugs = (items: Card[]) => items.map((item) => item.slug);
  const isNovo = (slug: string) => slug.startsWith('novo-') || slug.startsWith('gemeo-');
  const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

  async function walk(query: Query) {
    const pages: Page[] = [];
    let cursor: string | null = null;
    do {
      const page: Page = await search({ ...query, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor && pages.length < 30);
    return pages;
  }

  /** Todos os formatos de busca que a tela pode pedir. */
  const variants: Query[] = [
    {},
    { sort: 'rating' },
    { sort: 'distance' },
    { ...center },
    { ...center, sort: 'rating' },
    { minRating: 1 },
    { sort: 'rating', minRating: 1 },
    { ...center, sort: 'rating', minRating: 3 },
  ];

  it('o "Novo" nunca entra no minRating, seja qual for a média escondida (de 1 a 5)', async () => {
    for (const minRating of [1, 2, 3, 4, 5]) {
      for (const geo of [{}, center]) {
        for (const sort of ['distance', 'rating']) {
          const got = slugs((await search({ minRating, sort, ...geo })).items);
          expect(got.filter(isNovo), `minRating ${minRating} ${sort}`).toEqual([]);
        }
      }
    }
  });

  it('o card do "Novo" tem `average` nulo e as mesmas chaves de um espaço sem avaliação', async () => {
    const { items } = await search({ limit: 50 });
    const zero = items.find((item) => item.slug === 'zero') as Card;
    expect(zero.rating).toEqual({ count: 0, average: null });
    for (const card of items.filter((item) => isNovo(item.slug))) {
      expect(card.rating, card.slug).toEqual({
        count: novos[card.slug]?.count ?? 4,
        average: null,
      });
      // Nenhuma chave a mais, em nenhum nível, em relação ao espaço sem avaliação.
      expect(keysOf(card)).toEqual(keysOf(zero));
    }
  });

  it('gêmeos "Novo" com médias escondidas diferentes têm cards iguais (menos id e slug)', async () => {
    for (const query of variants) {
      const { items } = await search({ ...query, limit: 50 });
      const low = items.find((item) => item.slug === 'gemeo-baixo');
      const high = items.find((item) => item.slug === 'gemeo-alto');
      // `minRating` os tira da lista; nas outras buscas os dois estão lá.
      if (query.minRating) {
        expect(low).toBeUndefined();
        expect(high).toBeUndefined();
        continue;
      }
      const strip = ({ id: _id, slug: _slug, ...rest }: Card) => rest;
      expect(strip(low as Card)).toEqual(strip(high as Card));
    }
  });

  it('nenhuma chave dos "Novo" é de soma/média interna e `average` nunca é número', async () => {
    for (const query of variants) {
      for (const card of (await search({ ...query, limit: 50 })).items.filter((item) =>
        isNovo(item.slug),
      )) {
        // Só nomes de chave (um regex sobre o texto inteiro dá falso positivo em "resumo", "Sumaré").
        // Os testes de chaves iguais ao espaço sem avaliação e de metamorfose provam o resto.
        const leaking = keysOf(card).filter((path) =>
          /(^|\.)(sum|tenths|avg|mean|score)\w*$/i.test(path),
        );
        expect(leaking, card.slug).toEqual([]);
        expect(JSON.stringify(card), card.slug).not.toMatch(/"average":[0-9]/);
      }
    }
  });

  it('a ordem dos "Novo" não usa a média escondida: nome sem localização, distância com ela', async () => {
    // Sem localização: a nota pública primeiro, depois os "Novo" pelo nome (e pelo id nos gêmeos),
    // embora as médias escondidas (1,0 / 5,0 / 5,0 / 1,0 / 5,0) pedissem outra ordem.
    const byName = slugs((await search({ sort: 'rating', limit: 50 })).items);
    expect(byName.slice(0, 2)).toEqual(['zeta', 'alfa']);
    expect(new Set(byName.slice(2, 4))).toEqual(new Set(['gemeo-baixo', 'gemeo-alto']));
    expect(byName.slice(4)).toEqual(['novo-a', 'novo-b', 'novo-c', 'novo-d', 'novo-e', 'zero']);
    // Com localização (do centro): do mais perto ao mais longe, empates de ponto pelo id.
    const near = slugs((await search({ ...center, sort: 'rating', limit: 50 })).items);
    expect(near.slice(0, 2)).toEqual(['zeta', 'alfa']);
    const group = (from: number, to: number) => new Set(near.slice(from, to));
    expect(group(2, 4)).toEqual(new Set(['novo-a', 'zero'])); // centro
    expect(near[4]).toBe('novo-d'); // Savassi
    expect(group(5, 8)).toEqual(new Set(['novo-c', 'gemeo-baixo', 'gemeo-alto'])); // Pampulha
    expect(group(8, 10)).toEqual(new Set(['novo-b', 'novo-e'])); // Contagem
  });

  it('metamorfose: trocar a média escondida dos "Novo" não muda lista, páginas nem cursores', async () => {
    const snapshot = async () => {
      const out: unknown[] = [];
      for (const query of variants) {
        for (const limit of [1, 3, 50]) {
          const pages = await walk({ ...query, limit });
          // Os cursores trazem o id, o nome e a nota pública dos itens: tudo que não é média escondida.
          out.push(pages.map((page) => ({ ids: slugs(page.items), next: page.nextCursor })));
        }
      }
      return out;
    };
    const before = await snapshot();
    // Troca as médias escondidas (soma) mantendo a contagem: quem tinha 1,0 passa a ter 5,0 e vice-versa.
    await t.db.execute(sql`
      UPDATE spaces SET rating_sum = CASE
        WHEN rating_count BETWEEN 1 AND 4 AND rating_sum <= rating_count * 2 THEN rating_count * 5
        WHEN rating_count BETWEEN 1 AND 4 THEN rating_count
        ELSE rating_sum END
    `);
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it('o cursor do "Novo" não leva a média: igual para os gêmeos, menos o id', async () => {
    const cursors: Record<string, unknown>[] = [];
    for (const query of [{ sort: 'rating' }, { ...center, sort: 'rating' }]) {
      const pages = await walk({ ...query, limit: 1 });
      for (const [index, page] of pages.entries()) {
        const slug = page.items[0]?.slug as string;
        if (!page.nextCursor || !isNovo(slug)) continue;
        const cursor = decode(page.nextCursor);
        expect(cursor.rating, `${slug} (página ${index})`).toBeNull();
        // Olhar as chaves do cursor amarra o teste ao formato interno de um valor que deveria ser
        // opaco. É de propósito: a privacidade do "Novo" depende de o cursor não ter campo de média.
        expect(Object.keys(cursor).sort()).toEqual(['f', 'id', 'mode', 'rating', 'value']);
        if (slug.startsWith('gemeo-')) cursors.push(cursor);
      }
    }
    // Um cursor de cada gêmeo por busca (2 gêmeos x 2 buscas); sem o id, o do baixo e o do alto são
    // o mesmo, então só sobra um por busca.
    expect(cursors.length).toBe(4);
    const bare = ({ id: _id, ...rest }: Record<string, unknown>) => JSON.stringify(rest);
    expect(new Set(cursors.map(bare)).size).toBe(2);
  });
});

/** Caminho de todas as chaves do objeto, em qualquer nível (arrays entram pelo índice 0). */
function keysOf(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return keysOf(value[0], `${prefix}[]`);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, inner]) => [`${prefix}.${key}`, ...keysOf(inner, `${prefix}.${key}`)])
      .sort();
  }
  return [];
}
