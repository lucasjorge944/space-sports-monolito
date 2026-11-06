import { createHash } from 'node:crypto';
import { reviewAverage } from '@space-sports/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { displayedAverageTenths } from '../../src/reviews/review-views.js';
import { createTestApp, type TestApp } from '../auth/helpers.js';
import { BH, type Catalog, createSpace, seedCatalog } from './fixtures.js';

// Decisão 109 (AV2.1): `minRating` e `sort=rating` em GET /v1/spaces, só com a nota pública
// (RF-REVIEW-03: a partir de 5 avaliações; abaixo disso, "Novo"), pela média como o card mostra
// (uma casa, arredondada).

type Card = {
  id: string;
  slug: string;
  distanceMeters: number | null;
  rating: { count: number; average: number | null };
};
type Page = { items: Card[]; nextCursor: string | null };
type Query = Record<string, string | number>;

describe('busca por nota (decisão 109)', () => {
  let t: TestApp;
  let catalog: Catalog;
  const ids: Record<string, string> = {};
  /** Os dois "Arena Gêmea" (mesmo nome, lugar e nota), na ordem do id. */
  let twins: string[];

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    const make = async (slug: string, options: Parameters<typeof createSpace>[2]) => {
      ids[slug] = (await createSpace(t.db, catalog, { slug, ...options })).id;
    };
    const bt = [{ sports: ['beach-tennis'] }];
    // Nota pública (5 ou mais avaliações).
    await make('cinco', { name: 'Arena Cinco', rating: { count: 5, sum: 25 } }); // 5,0 exata
    // 4,95: o card mostra 5,0; empata com o de cima e passa na frente pelo total.
    await make('quase-cinco', {
      name: 'Arena Quase Cinco',
      location: BH.pampulha,
      rating: { count: 20, sum: 99 },
    });
    await make('topo', {
      name: 'Arena Topo',
      location: BH.savassi,
      rating: { count: 10, sum: 49 },
    }); // 4,9
    await make('gemeo-1', { name: 'Arena Gêmea', rating: { count: 5, sum: 23 } }); // 4,6
    await make('gemeo-2', { name: 'Arena Gêmea', rating: { count: 5, sum: 23 } }); // 4,6
    await make('meio-mais', {
      name: 'Arena Meio Mais',
      location: BH.pampulha,
      rating: { count: 20, sum: 90 }, // 4,5 com mais avaliações
    });
    await make('empate-a', {
      name: 'Arena Alfa',
      location: BH.contagem,
      rating: { count: 10, sum: 45 }, // 4,5: primeiro pelo nome, último pela distância
    });
    await make('empate-b', {
      name: 'Arena Beta',
      location: BH.center,
      courts: bt,
      rating: { count: 10, sum: 45 },
    });
    await make('quatro-mais', { name: 'Arena Quatro Mais', rating: { count: 10, sum: 40 } }); // 4,0
    await make('quatro', {
      name: 'Arena Quatro',
      location: BH.savassi,
      courts: bt,
      rating: { count: 5, sum: 20 }, // 4,0
    });
    // 3,95: o card mostra 4,0 (meio para cima) e o espaço entra no minRating=4.
    await make('quase', { name: 'Arena Quase', rating: { count: 20, sum: 79 } });
    // 3,94: o card mostra 3,9 e o espaço fica fora.
    await make('tres-nove', {
      name: 'Arena Três Nove',
      location: BH.savassi,
      rating: { count: 50, sum: 197 },
    });
    // "Novo": média 5 escondida e sem avaliação.
    await make('novo-cinco', { name: 'Arena Novo Cinco', rating: { count: 4, sum: 20 } });
    await make('novo-zero', { name: 'Arena Novo Zero', location: BH.pampulha });
    // Fora da vitrine, com nota alta.
    await make('suspensa', {
      name: 'Arena Suspensa',
      status: 'SUSPENDED',
      rating: { count: 10, sum: 50 },
    });
    twins = ['gemeo-1', 'gemeo-2'].sort((a, b) =>
      (ids[a] as string).localeCompare(ids[b] as string),
    );
  });
  afterAll(() => t.close());

  const search = async (query: Query = {}): Promise<Page> =>
    (await t.http().get('/v1/spaces').query(query).expect(200)).body;
  const slugs = (items: Card[]) => items.map((item) => item.slug);
  const center = { lat: BH.center.lat, lng: BH.center.lng };

  /** Percorre todas as páginas da busca. */
  async function walk(query: Query) {
    const pages: Card[][] = [];
    const cursors: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await search({ ...query, ...(cursor ? { cursor } : {}) });
      pages.push(page.items);
      cursor = page.nextCursor;
      if (cursor) cursors.push(cursor);
    } while (cursor && pages.length < 30);
    return { pages, cursors, all: slugs(pages.flat()) };
  }

  const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const card = async (slug: string) =>
    (await search({ limit: 50 })).items.find((item) => item.slug === slug);

  describe('média exibida', () => {
    it('a do banco (filtro, ordem e cursor) é a do card (`reviewAverage`), meio para cima', async () => {
      const { rows } = await t.db.execute<{ c: number; s: number; tenths: number }>(sql`
        SELECT c, s, ${displayedAverageTenths(sql`s`, sql`c`)} AS tenths
        FROM (SELECT generate_series(5, 60) AS c UNION ALL SELECT unnest(ARRAY[999, 1000, 4096])) counts,
          generate_series(c, 5 * c) AS s
      `);
      expect(rows.length).toBeGreaterThan(30_000);
      const wrong = rows.filter((row) => row.tenths / 10 !== reviewAverage(row.s, row.c));
      expect(wrong).toEqual([]);
      const { rows: zero } = await t.db.execute<{ tenths: number | null }>(
        sql`SELECT ${displayedAverageTenths(sql`0`, sql`0`)} AS tenths`,
      );
      expect(zero[0]?.tenths).toBeNull();
    });
  });

  describe('minRating', () => {
    it('só nota pública com a média exibida ≥ minRating: 4,9, 4,0 e 3,95 ("★ 4,0") entram; 3,94, 3,9 e "Novo" de média 5 não', async () => {
      const { items } = await search({ minRating: 4 });
      expect(slugs(items)).toEqual([
        'empate-a',
        'empate-b',
        'cinco',
        ...twins,
        'meio-mais',
        'quase',
        'quase-cinco',
        'quatro',
        'quatro-mais',
        'topo',
      ]);
      // O que o filtro compara é o que o card mostra.
      expect((await card('quase'))?.rating).toEqual({ count: 20, average: 4 });
      expect((await card('tres-nove'))?.rating).toEqual({ count: 50, average: 3.9 });
    });

    it('minRating 1 já deixa os "Novo" de fora; 5 aceita a média exata 5 e a exibida 5,0', async () => {
      const one = slugs((await search({ minRating: 1 })).items);
      expect(one).toHaveLength(12);
      expect(one).not.toContain('novo-cinco');
      expect(one).not.toContain('novo-zero');
      expect(slugs((await search({ minRating: 5 })).items)).toEqual(['cinco', 'quase-cinco']);
      expect(slugs((await search({ minRating: 5, sort: 'rating' })).items)).toEqual([
        'quase-cinco',
        'cinco',
      ]);
      expect((await card('quase-cinco'))?.rating).toEqual({ count: 20, average: 5 });
    });

    it('espaço fora da vitrine nunca entra, mesmo com nota alta', async () => {
      for (const sort of ['distance', 'rating']) {
        expect(slugs((await search({ minRating: 4, sort })).items)).not.toContain('suspensa');
      }
    });
  });

  describe('sort=rating', () => {
    it('sem lat/lng: média exibida desc, total desc, nome, id; depois os "Novo" pelo nome', async () => {
      const { items, nextCursor } = await search({ sort: 'rating' });
      expect(slugs(items)).toEqual([
        'quase-cinco', // 5,0 (4,95) com 20
        'cinco', // 5,0 com 5
        'topo',
        ...twins,
        'meio-mais',
        'empate-a',
        'empate-b',
        'quase', // 4,0 (3,95) com 20
        'quatro-mais', // 4,0 com 10
        'quatro', // 4,0 com 5
        'tres-nove',
        'novo-cinco',
        'novo-zero',
      ]);
      expect(nextCursor).toBeNull();
    });

    it('com lat/lng: o desempate é a distância (e o id no mesmo ponto)', async () => {
      const { items } = await search({ ...center, sort: 'rating' });
      expect(slugs(items)).toEqual([
        'quase-cinco',
        'cinco',
        'topo',
        ...twins,
        'meio-mais',
        'empate-b',
        'empate-a',
        'quase',
        'quatro-mais',
        'quatro',
        'tres-nove',
        'novo-cinco',
        'novo-zero',
      ]);
    });

    it('com minRating: só os de nota pública ≥ 4, na ordem da nota', async () => {
      const { items } = await search({ sort: 'rating', minRating: 4 });
      expect(slugs(items)).toEqual([
        'quase-cinco',
        'cinco',
        'topo',
        ...twins,
        'meio-mais',
        'empate-a',
        'empate-b',
        'quase',
        'quatro-mais',
        'quatro',
      ]);
    });

    it('combina com raio e esporte', async () => {
      const query = { ...center, radiusKm: 5, sport: 'futevolei', sort: 'rating' };
      expect(slugs((await search(query)).items)).toEqual([
        'cinco',
        'topo',
        ...twins,
        'quase',
        'quatro-mais',
        'tres-nove',
        'novo-cinco',
      ]);
      expect(slugs((await search({ ...query, minRating: 4 })).items)).toEqual([
        'cinco',
        'topo',
        ...twins,
        'quase',
        'quatro-mais',
      ]);
    });

    it('não muda o card: "Novo" segue com a média nula', async () => {
      const { items } = await search({ sort: 'rating', q: 'novo' });
      expect(items.map((item) => item.rating)).toEqual([
        { count: 4, average: null },
        { count: 0, average: null },
      ]);
    });

    it('sort padrão continua por nome (sem lat/lng) e por distância (com eles)', async () => {
      const byName = slugs((await search()).items);
      expect(byName).toEqual(slugs((await search({ sort: 'distance' })).items));
      expect(byName[0]).toBe('empate-a');
      const near = (await search({ ...center, sort: 'distance' })).items;
      const distances = near.map((item) => item.distanceMeters ?? -1);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });
  });

  describe('paginação por cursor nas duas ordens', () => {
    const cases: [string, Query][] = [
      ['rating, sem lat/lng', { sort: 'rating' }],
      ['rating, com lat/lng', { ...center, sort: 'rating' }],
      ['rating, com minRating', { sort: 'rating', minRating: 4 }],
      ['rating, raio e esporte', { ...center, radiusKm: 5, sport: 'futevolei', sort: 'rating' }],
      ['distance, sem lat/lng', { sort: 'distance' }],
      ['distance, com lat/lng e minRating', { ...center, minRating: 4 }],
    ];

    it.each(cases)(
      '%s: mesma lista da consulta inteira, sem repetir nem pular',
      async (_, query) => {
        const full = slugs((await search(query)).items);
        for (const limit of [1, 2, 3]) {
          const { pages, all } = await walk({ ...query, limit });
          expect(all, `limit ${limit}`).toEqual(full);
          expect(new Set(all).size).toBe(all.length);
          expect(pages.every((page) => page.length <= limit)).toBe(true);
        }
      },
    );

    it('o cursor do "Novo" não leva a média escondida', async () => {
      const { cursors } = await walk({ sort: 'rating', limit: 1 });
      const decoded = cursors.map(decode);
      // O cursor leva as chaves da ordem: a média exibida × 10 e o total.
      expect(decoded[0]).toMatchObject({ mode: 'rating-name', rating: { tenths: 50, count: 20 } });
      // O 12º item é o tres-nove (último com nota pública); depois dele, só "Novo".
      expect(decoded[11]).toMatchObject({ mode: 'rating-name', rating: { tenths: 39, count: 50 } });
      expect(Object.keys(decoded[11].rating).sort()).toEqual(['count', 'tenths']);
      expect(decoded[12]).toMatchObject({ mode: 'rating-name', rating: null });
      expect(decoded[12].id).toBe(ids['novo-cinco']);
      expect(Object.keys(decoded[12]).sort()).toEqual(['f', 'id', 'mode', 'rating', 'value']);
      expect(decoded[12].value).toBe('Arena Novo Cinco');
    });

    it('sem minRating, a assinatura é a de antes da decisão 109: cursores antigos continuam valendo', async () => {
      // A assinatura como o deploy anterior a calculava (sem a nota mínima).
      const legacySignature = (normalized: unknown[]) =>
        createHash('sha256').update(JSON.stringify(normalized)).digest('base64url').slice(0, 22);
      const byName = decode((await search({ limit: 2 })).nextCursor as string);
      expect(byName.f).toBe(legacySignature([null, null, null, null, null, [], null]));
      const near = decode((await search({ ...center, limit: 2 })).nextCursor as string);
      expect(near.f).toBe(legacySignature([center.lat, center.lng, 20, null, null, [], null]));

      // Cursor gerado antes do deploy (mesmo formato): a página seguinte sai sem erro.
      const full = slugs((await search()).items);
      const old = encode({ mode: 'name', value: 'Arena Beta', id: ids['empate-b'], f: byName.f });
      const next = await search({ cursor: old });
      expect(slugs(next.items)).toEqual(full.slice(full.indexOf('empate-b') + 1));

      // Com a nota mínima, ela entra na assinatura.
      const filtered = decode((await search({ minRating: 4, limit: 2 })).nextCursor as string);
      expect(filtered.f).not.toBe(byName.f);
    });

    it('cursor da outra ordem: 400 CURSOR_SORT_MISMATCH', async () => {
      const byRating = await search({ sort: 'rating', limit: 1 });
      const byDistance = await search({ limit: 1 });
      const reuse = async (query: Query, cursor: string | null) =>
        (
          await t
            .http()
            .get('/v1/spaces')
            .query({ ...query, cursor: cursor ?? '' })
            .expect(400)
        ).body.error.code;

      expect(await reuse({}, byRating.nextCursor)).toBe('CURSOR_SORT_MISMATCH');
      expect(await reuse({ sort: 'distance' }, byRating.nextCursor)).toBe('CURSOR_SORT_MISMATCH');
      expect(await reuse({ sort: 'rating' }, byDistance.nextCursor)).toBe('CURSOR_SORT_MISMATCH');
      const geoRating = await search({ ...center, sort: 'rating', limit: 1 });
      expect(await reuse(center, geoRating.nextCursor)).toBe('CURSOR_SORT_MISMATCH');
    });

    it('mesma ordem com outros filtros (minRating, lat/lng): 400 INVALID_CURSOR', async () => {
      const byRating = await search({ sort: 'rating', limit: 1 });
      const filtered = await search({ sort: 'rating', minRating: 4, limit: 1 });
      const geoRating = await search({ ...center, sort: 'rating', limit: 1 });
      const reuse = async (query: Query, cursor: string | null) =>
        (
          await t
            .http()
            .get('/v1/spaces')
            .query({ ...query, cursor: cursor ?? '' })
            .expect(400)
        ).body.error.code;

      expect(await reuse({ sort: 'rating', minRating: 4 }, byRating.nextCursor)).toBe(
        'INVALID_CURSOR',
      );
      expect(await reuse({ sort: 'rating', minRating: 3 }, filtered.nextCursor)).toBe(
        'INVALID_CURSOR',
      );
      expect(await reuse({ sort: 'rating' }, geoRating.nextCursor)).toBe('INVALID_CURSOR');
      const byName = await search({ limit: 1 });
      expect(await reuse({ minRating: 4 }, byName.nextCursor)).toBe('INVALID_CURSOR');
    });

    it('cursor adulterado: 400 INVALID_CURSOR, nunca 500', async () => {
      const { nextCursor } = await search({ sort: 'rating', limit: 1 });
      const valid = decode(nextCursor as string);
      for (const rating of [
        { tenths: 0, count: 0 },
        { tenths: 50, count: 4 },
        { tenths: 9, count: 10 },
        { tenths: 51, count: 10 },
        { tenths: 45.5, count: 10 },
        { sum: 49, count: 10 },
        'x',
      ]) {
        const res = await t
          .http()
          .get('/v1/spaces')
          .query({ sort: 'rating', cursor: encode({ ...valid, rating }) })
          .expect(400);
        expect(res.body.error.code, JSON.stringify(rating)).toBe('INVALID_CURSOR');
      }
      const { rating: _r, ...withoutRating } = valid;
      const res = await t
        .http()
        .get('/v1/spaces')
        .query({ sort: 'rating', cursor: encode(withoutRating) })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });
  });

  describe('validação', () => {
    it.each([
      { minRating: 0 },
      { minRating: 6 },
      { minRating: 4.5 },
      { minRating: 'quatro' },
      { sort: 'price' },
      { sort: 'RATING' },
    ])('%j: 400 VALIDATION_ERROR', async (query) => {
      const res = await t.http().get('/v1/spaces').query(query).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
