import { REVIEW_SUMMARY_MIN_COUNT, reviewAverage } from '@space-sports/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../auth/helpers.js';
import { BH, type Catalog, createSpace, seedCatalog } from './fixtures.js';

// QA da decisão 109 (AV2.4), invariantes da ordem `rating`: a lista paginada inteira é igual à lista
// ordenada em memória pelas regras da decisão (nota pública pela média exibida desc, total desc,
// depois os "Novo"; desempate pela distância ou pelo nome, e pelo id), com dados aleatórios (PRNG
// com semente fixa: a falha é reproduzível). Cobre RF-REVIEW-03 (nota pública a partir de 5),
// RN-SPACE-01 (vitrine) e RF-SPACE-05 (busca).

type Card = { id: string; rating: { count: number; average: number | null } };
type Page = { items: Card[]; nextCursor: string | null };
type Query = Record<string, string | number>;

/** mulberry32: PRNG pequeno e determinístico. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261106;
const TOTAL = 56;
/** Nomes repetidos de propósito: o empate de nome cai no id. */
const NAMES = ['Arena A', 'Arena B', 'Arena C', 'Arena D', 'Arena E', 'Arena F'];
/** Pontos repetidos: o empate de distância cai no id. `null` = sem localização. */
const POINTS = [BH.center, BH.center, BH.savassi, BH.pampulha, BH.contagem, null] as const;
/** Médias e totais "de empate": muitas notas iguais na casa do décimo. */
const TIE_AVERAGES = [3.9, 4, 4.5, 5];
/** Médias que só saem exatas com 20 avaliações: logo abaixo de 3, 4 e 5 (e 4,5), arredondam para cima. */
const BOUNDARY_AVERAGES = [2.95, 3.95, 4.45, 4.95];
const TIE_COUNTS = [5, 5, 6, 10, 20];

type Hidden = 'SUSPENDED' | 'CLOSED' | 'NO_PRICE' | 'NO_COURT' | 'MAINTENANCE_COURT';
const HIDDEN_KINDS: Hidden[] = ['SUSPENDED', 'CLOSED', 'NO_PRICE', 'NO_COURT', 'MAINTENANCE_COURT'];
type Fake = {
  id: string;
  name: string;
  count: number;
  sum: number;
  point: (typeof POINTS)[number];
  /** Fora da vitrine (nunca pode aparecer). */
  hidden: Hidden | null;
};

describe('busca por nota: invariantes com dados aleatórios (decisão 109)', () => {
  let t: TestApp;
  let catalog: Catalog;
  const fakes: Fake[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    const rand = prng(SEED);
    const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;

    for (let i = 0; i < TOTAL; i++) {
      // 1 em cada 7 fora da vitrine, de cada jeito possível.
      const hidden =
        i % 7 === 3 ? (HIDDEN_KINDS[Math.floor(i / 7) % HIDDEN_KINDS.length] ?? 'CLOSED') : null;
      const kind = rand();
      let count: number;
      let sum: number;
      if (kind < 0.15) {
        count = 0;
        sum = 0;
      } else if (kind < 0.35) {
        // "Novo" com média escondida variada (inclusive 5,0).
        count = 1 + Math.floor(rand() * (REVIEW_SUMMARY_MIN_COUNT - 1));
        sum = count + Math.floor(rand() * (4 * count + 1));
      } else if (kind < 0.7) {
        count = pick(TIE_COUNTS);
        sum = Math.round(pick(TIE_AVERAGES) * count);
      } else {
        count = REVIEW_SUMMARY_MIN_COUNT + Math.floor(rand() * 40);
        sum = count + Math.floor(rand() * (4 * count + 1));
      }
      const point = pick(POINTS);
      const name = pick(NAMES);
      const space = await createSpace(t.db, catalog, {
        name,
        slug: `prop-${i}`,
        location: point,
        rating: { count, sum },
        ...(hidden === 'SUSPENDED' || hidden === 'CLOSED' ? { status: hidden } : {}),
        ...(hidden === 'NO_PRICE' ? { price: null } : {}),
        ...(hidden === 'NO_COURT' ? { courts: [] } : {}),
        ...(hidden === 'MAINTENANCE_COURT'
          ? { courts: [{ status: 'MAINTENANCE' as const, sports: ['futevolei'] }] }
          : {}),
      });
      fakes.push({ id: space.id, name, count, sum, point, hidden });
    }

    // Fronteiras do arredondamento, fora do sorteio (a semente fixa não as gera): com 20 avaliações
    // a média real fica logo abaixo do corte (ex.: 3,95) e a exibida chega a ele (4,0). O filtro tem
    // de usar a exibida; se comparasse a real, esses espaços ficariam de fora.
    for (const [j, average] of BOUNDARY_AVERAGES.entries()) {
      const count = 20;
      const sum = Math.round(average * count);
      const name = NAMES[j % NAMES.length] as string;
      const space = await createSpace(t.db, catalog, {
        name,
        slug: `prop-edge-${j}`,
        location: BH.center,
        rating: { count, sum },
      });
      fakes.push({ id: space.id, name, count, sum, point: BH.center, hidden: null });
    }
  });
  afterAll(() => t.close());

  const search = async (query: Query): Promise<Page> =>
    (await t.http().get('/v1/spaces').query(query).expect(200)).body;

  async function walk(query: Query) {
    const pages: Card[][] = [];
    let cursor: string | null = null;
    do {
      const page: Page = await search({ ...query, ...(cursor ? { cursor } : {}) });
      pages.push(page.items);
      cursor = page.nextCursor;
    } while (cursor && pages.length < 80);
    expect(cursor, 'a paginação não terminou').toBeNull();
    return pages;
  }

  /** Distância do banco (a mesma função da busca) do ponto de consulta a cada espaço. */
  async function distances(lat: number, lng: number) {
    const { rows } = await t.db.execute<{ id: string; d: number | null }>(sql`
      SELECT id, ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography) AS d
      FROM spaces
    `);
    return new Map(rows.map((row) => [row.id, row.d]));
  }

  const hasPublic = (f: Fake) => f.count >= REVIEW_SUMMARY_MIN_COUNT;
  /** A média como o card mostra, vezes 10, a partir da média de `reviewAverage` (regra do card). */
  const tenths = (f: Fake) => Math.round((reviewAverage(f.sum, f.count) ?? 0) * 10);
  const cmp = (a: (number | string)[], b: (number | string)[]) => {
    for (let i = 0; i < a.length; i++) {
      const x = a[i] as number | string;
      const y = b[i] as number | string;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };

  /** Lista esperada, pelas regras da decisão 109, ordenada em memória. */
  async function expected(query: {
    sort: 'distance' | 'rating';
    minRating?: number;
    geo?: { lat: number; lng: number; radiusKm: number };
  }) {
    const dist = query.geo ? await distances(query.geo.lat, query.geo.lng) : null;
    const list = fakes.filter((f) => {
      if (f.hidden) return false;
      if (query.geo) {
        const d = dist?.get(f.id);
        if (f.point === null || d == null || d > query.geo.radiusKm * 1000) return false;
      }
      if (query.minRating !== undefined) return hasPublic(f) && tenths(f) >= query.minRating * 10;
      return true;
    });
    const key = (f: Fake): (number | string)[] => {
      const tie = dist ? (dist.get(f.id) as number) : f.name;
      const rating =
        query.sort === 'rating'
          ? [hasPublic(f) ? 0 : 1, hasPublic(f) ? -tenths(f) : 0, hasPublic(f) ? -f.count : 0]
          : [];
      return [...rating, tie, f.id];
    };
    return list.sort((a, b) => cmp(key(a), key(b))).map((f) => f.id);
  }

  const queries: {
    label: string;
    sort: 'distance' | 'rating';
    minRating?: number;
    geo?: boolean;
  }[] = [];
  for (const sort of ['distance', 'rating'] as const) {
    for (const geo of [false, true]) {
      for (const minRating of [undefined, 3, 4, 5]) {
        queries.push({
          label: `${sort}${geo ? ' + lat/lng' : ''}${minRating ? ` + minRating ${minRating}` : ''}`,
          sort,
          geo,
          ...(minRating ? { minRating } : {}),
        });
      }
    }
  }

  it('o conjunto de dados cobre os casos (sanidade do gerador)', () => {
    const visible = fakes.filter((f) => !f.hidden);
    expect(fakes.filter((f) => f.hidden).length).toBeGreaterThanOrEqual(6);
    expect(new Set(fakes.flatMap((f) => (f.hidden ? [f.hidden] : []))).size).toBe(5);
    expect(visible.filter((f) => f.count === 0).length).toBeGreaterThan(0);
    expect(visible.filter((f) => f.count > 0 && !hasPublic(f)).length).toBeGreaterThan(2);
    expect(visible.filter((f) => hasPublic(f) && tenths(f) >= 40).length).toBeGreaterThan(5);
    expect(visible.filter((f) => hasPublic(f) && tenths(f) < 40).length).toBeGreaterThan(2);
    // Há empates de verdade na nota exibida.
    const keys = visible.filter(hasPublic).map((f) => `${tenths(f)}/${f.count}`);
    expect(new Set(keys).size).toBeLessThan(keys.length);
    // O arredondamento é exercitado: para cada corte testado existe espaço visível com média real
    // abaixo de m e média exibida >= m (um filtro pela média real o perderia).
    for (const m of [3, 4, 5]) {
      expect(
        visible.filter((f) => hasPublic(f) && f.sum < m * f.count && tenths(f) >= m * 10).length,
        `nenhum espaço com média real < ${m} e exibida >= ${m}`,
      ).toBeGreaterThan(0);
    }
  });

  describe.each(queries)('$label', ({ sort, minRating, geo }) => {
    const center = { lat: BH.center.lat, lng: BH.center.lng };
    const params = (): Query => ({
      sort,
      ...(minRating ? { minRating } : {}),
      ...(geo ? { ...center, radiusKm: 12 } : {}),
    });

    it.each([4, 50])('a lista paginada (limit %i) é a lista ordenada em memória', async (limit) => {
      const want = await expected({
        sort,
        ...(minRating ? { minRating } : {}),
        ...(geo ? { geo: { ...center, radiusKm: 12 } } : {}),
      });
      expect(want.length).toBeGreaterThan(0);
      const pages = await walk({ ...params(), limit });
      const got = pages.flat().map((card) => card.id);
      expect(got).toEqual(want);
      expect(new Set(got).size).toBe(got.length);
      expect(pages.every((page) => page.length <= limit)).toBe(true);
      // Nenhuma página intermediária vazia nem curta.
      expect(pages.slice(0, -1).every((page) => page.length === limit)).toBe(true);
      // Espaço fora da vitrine nunca aparece (RN-SPACE-01), em nenhuma ordem nem filtro.
      const hiddenIds = new Set(fakes.filter((f) => f.hidden).map((f) => f.id));
      expect(got.filter((id) => hiddenIds.has(id))).toEqual([]);
    });
  });

  it('o card traz a nota como a regra: média só a partir de 5 avaliações, igual à de `reviewAverage`', async () => {
    const byId = new Map(fakes.map((f) => [f.id, f]));
    for (const sort of ['distance', 'rating']) {
      const cards = (await walk({ sort, limit: 50 })).flat();
      expect(cards.length).toBe(fakes.filter((f) => !f.hidden).length);
      for (const card of cards) {
        const fake = byId.get(card.id) as Fake;
        expect(card.rating).toEqual({
          count: fake.count,
          average: hasPublic(fake) ? reviewAverage(fake.sum, fake.count) : null,
        });
      }
    }
  });
});
