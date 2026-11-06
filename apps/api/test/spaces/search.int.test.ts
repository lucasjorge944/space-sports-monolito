import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { BH, type Catalog, createSpace, seedCatalog, setSpaceStatus } from './fixtures.js';

type Card = { slug: string; distanceMeters: number | null };

describe('vitrine, busca e página pública (RF-SPACE-05..09, RN-SPACE-01)', () => {
  let t: TestApp;
  let catalog: Catalog;
  let player: SignedUp;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    const make = async (slug: string, options: Parameters<typeof createSpace>[2]) => {
      ids[slug] = (await createSpace(t.db, catalog, { slug, ...options })).id;
    };
    // Visíveis.
    await make('centro', {
      name: 'Arena Centro',
      location: BH.center,
      neighborhood: 'Centro',
      courts: [{ sports: ['futevolei', 'volei-praia'] }],
      amenities: ['wi-fi', 'banheiro'],
      photos: 2,
    });
    await make('savassi', {
      name: 'Beach Savassi',
      location: BH.savassi,
      courts: [{ sports: ['beach-tennis'] }],
      amenities: ['wi-fi'],
    });
    await make('pampulha', {
      name: 'Arena Pampulha',
      location: BH.pampulha,
      amenities: ['banheiro'],
    });
    await make('contagem', { name: 'Arena Contagem', location: BH.contagem });
    await make('sem-local', { name: 'Arena Sem Local', location: null });
    // Fora da vitrine.
    await make('sem-preco', { name: 'Arena Sem Preço', price: null });
    await make('sem-quadra', { name: 'Arena Sem Quadra', courts: [] });
    await make('manutencao', {
      name: 'Arena Manutenção',
      courts: [{ status: 'MAINTENANCE', sports: ['futevolei'] }],
    });
    await make('suspensa', { name: 'Arena Suspensa', status: 'SUSPENDED' });
    // Esporte só numa quadra em manutenção não conta para o filtro.
    await make('bt-manutencao', {
      name: 'Arena BT Parada',
      location: BH.center,
      courts: [{ sports: ['futevolei'] }, { status: 'MAINTENANCE', sports: ['beach-tennis'] }],
    });
    player = await signUp(t, 'jogador@exemplo.com');
  });
  afterAll(() => t.close());

  const search = async (query: Record<string, string | number> = {}) => {
    const res = await t.http().get('/v1/spaces').query(query).expect(200);
    return res.body as { items: Card[]; nextCursor: string | null };
  };
  const slugs = (items: Card[]) => items.map((item) => item.slug);

  it('só espaços ACTIVE com quadra ativa e preço/hora; sem lat/lng, por nome', async () => {
    const { items, nextCursor } = await search();
    expect(slugs(items)).toEqual([
      'bt-manutencao',
      'centro',
      'contagem',
      'pampulha',
      'sem-local',
      'savassi',
    ]);
    expect(nextCursor).toBeNull();
    expect(items.every((item) => item.distanceMeters === null)).toBe(true);
  });

  it('card com capa, esportes das quadras ativas, preço e serviços', async () => {
    const { items } = await search({ q: 'centro' });
    expect(items).toEqual([
      {
        id: ids.centro,
        slug: 'centro',
        name: 'Arena Centro',
        logoUrl: null,
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        location: BH.center,
        distanceMeters: null,
        cover: { url: 'https://fotos.test/centro/0.jpg', blurhash: null },
        sports: [
          { slug: 'futevolei', name: 'Futevôlei' },
          { slug: 'volei-praia', name: 'Vôlei de Praia' },
        ],
        pricePerHourCents: 10_000,
        services: ['RENTAL'],
        // RF-REVIEW-03: sem avaliações, selo "Novo" (média nula).
        rating: { count: 0, average: null },
      },
    ]);
  });

  describe('raio (PostGIS)', () => {
    it('ordena pela distância e respeita o raio', async () => {
      const near = await search({ lat: BH.center.lat, lng: BH.center.lng, radiusKm: 5 });
      expect(slugs(near.items).sort()).toEqual(['bt-manutencao', 'centro', 'savassi']);
      expect(near.items.at(-1)?.slug).toBe('savassi');
      const savassi = near.items.at(-1)?.distanceMeters ?? 0;
      expect(savassi).toBeGreaterThan(1_500);
      expect(savassi).toBeLessThan(2_200);

      const ten = await search({ lat: BH.center.lat, lng: BH.center.lng, radiusKm: 10 });
      expect(slugs(ten.items).slice(-2)).toEqual(['savassi', 'pampulha']);
    });

    it('raio padrão de 20 km; espaço sem localização fica fora da busca geográfica', async () => {
      const all = await search({ lat: BH.center.lat, lng: BH.center.lng });
      expect(slugs(all.items)).not.toContain('sem-local');
      expect(slugs(all.items).at(-1)).toBe('contagem');
      const distances = all.items.map((item) => item.distanceMeters ?? -1);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    it('valida os parâmetros', async () => {
      await t.http().get('/v1/spaces').query({ lat: -19.9 }).expect(400);
      await t.http().get('/v1/spaces').query({ radiusKm: 5 }).expect(400);
      await t.http().get('/v1/spaces').query({ lat: 100, lng: 0 }).expect(400);
      await t.http().get('/v1/spaces').query({ limit: 0 }).expect(400);
    });
  });

  describe('filtros', () => {
    it('esporte: só conta quadra ativa', async () => {
      expect(slugs((await search({ sport: 'beach-tennis' })).items)).toEqual(['savassi']);
      expect(slugs((await search({ sport: 'volei-praia' })).items)).toEqual(['centro']);
      expect((await search({ sport: 'xadrez' })).items).toEqual([]);
    });

    it('infraestrutura: precisa ter todas', async () => {
      expect(slugs((await search({ amenities: 'wi-fi' })).items)).toEqual(['centro', 'savassi']);
      expect(slugs((await search({ amenities: 'wi-fi,banheiro' })).items)).toEqual(['centro']);
      expect(slugs((await search({ amenities: 'banheiro, banheiro' })).items)).toEqual([
        'centro',
        'pampulha',
      ]);
    });

    it('serviço: só o aluguel existe por enquanto', async () => {
      expect((await search({ service: 'RENTAL' })).items).toHaveLength(6);
      expect((await search({ service: 'CLASSES' })).items).toEqual([]);
      await t.http().get('/v1/spaces').query({ service: 'OUTRO' }).expect(400);
    });

    it('nome, sem diferenciar maiúsculas e sem curinga do LIKE', async () => {
      expect(slugs((await search({ q: 'ARENA P' })).items)).toEqual(['pampulha']);
      expect((await search({ q: '%' })).items).toEqual([]);
      expect((await search({ q: '_' })).items).toEqual([]);
    });

    it('filtros combinados com o raio', async () => {
      const res = await search({
        lat: BH.center.lat,
        lng: BH.center.lng,
        radiusKm: 10,
        sport: 'futevolei',
        amenities: 'banheiro',
      });
      expect(slugs(res.items)).toEqual(['centro', 'pampulha']);
    });
  });

  describe('paginação por cursor', () => {
    async function walk(query: Record<string, string | number>) {
      const pages: string[][] = [];
      let cursor: string | null = null;
      do {
        const page = await search({ ...query, ...(cursor ? { cursor } : {}) });
        pages.push(slugs(page.items));
        cursor = page.nextCursor;
      } while (cursor && pages.length < 10);
      return pages;
    }

    it('por nome: percorre tudo sem repetir nem pular', async () => {
      const pages = await walk({ limit: 2 });
      expect(pages).toEqual([
        ['bt-manutencao', 'centro'],
        ['contagem', 'pampulha'],
        ['sem-local', 'savassi'],
      ]);
    });

    it('por distância: mesma ordem da consulta sem paginação', async () => {
      const geo = { lat: BH.center.lat, lng: BH.center.lng };
      const full = slugs((await search(geo)).items);
      const pages = await walk({ ...geo, limit: 2 });
      expect(pages.flat()).toEqual(full);
      expect(pages.every((page) => page.length <= 2)).toBe(true);
    });

    it('desempata pelo id quando a distância é igual', async () => {
      // centro e bt-manutencao ficam no mesmo ponto.
      const pages = await walk({ lat: BH.center.lat, lng: BH.center.lng, limit: 1 });
      expect(pages.slice(0, 2).flat().sort()).toEqual(['bt-manutencao', 'centro']);
    });

    it('cursor usado com outros filtros: 400 INVALID_CURSOR', async () => {
      const geo = { lat: BH.center.lat, lng: BH.center.lng, radiusKm: 20 };
      const byName = await search({ limit: 1, amenities: 'wi-fi' });
      const byDistance = await search({ ...geo, limit: 1 });
      const reuse = async (query: Record<string, string | number>, cursor: string | null) =>
        (
          await t
            .http()
            .get('/v1/spaces')
            .query({ ...query, cursor: cursor ?? '' })
        ).body;

      const queries: Record<string, string>[] = [
        { amenities: 'banheiro' },
        { amenities: 'wi-fi', sport: 'futevolei' },
        { amenities: 'wi-fi', q: 'arena' },
        { amenities: 'wi-fi', service: 'RENTAL' },
        {},
      ];
      for (const query of queries) {
        expect((await reuse(query, byName.nextCursor)).error?.code, JSON.stringify(query)).toBe(
          'INVALID_CURSOR',
        );
      }
      for (const query of [
        { ...geo, radiusKm: 10 },
        { ...geo, lat: BH.savassi.lat },
        { lat: geo.lat, lng: geo.lng, radiusKm: 19 },
      ]) {
        expect((await reuse(query, byDistance.nextCursor)).error?.code).toBe('INVALID_CURSOR');
      }

      // Filtros equivalentes depois de normalizados valem, e o limit pode mudar.
      expect(
        (await reuse({ amenities: ' wi-fi,wi-fi ', limit: 5 }, byName.nextCursor)).items,
      ).toBeDefined();
      const { radiusKm: _r, ...defaultRadius } = geo;
      expect((await reuse(defaultRadius, byDistance.nextCursor)).items).toBeDefined();
      const named = await search({ q: 'ARENA', limit: 1 });
      expect((await reuse({ q: 'arena' }, named.nextCursor)).items).toBeDefined();
    });

    it('cursor inválido ou de outra ordenação: 400', async () => {
      const res = await t.http().get('/v1/spaces').query({ cursor: 'lixo' }).expect(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
      const byName = await search({ limit: 1 });
      await t
        .http()
        .get('/v1/spaces')
        .query({ lat: BH.center.lat, lng: BH.center.lng, cursor: byName.nextCursor ?? '' })
        .expect(400);
    });
  });

  describe('página pública (RF-SPACE-08)', () => {
    it('devolve o espaço com quadras ativas, infraestrutura, pagamento e regras do aluguel', async () => {
      const res = await t.http().get('/v1/spaces/bt-manutencao').expect(200);
      expect(res.body).toMatchObject({
        id: ids['bt-manutencao'],
        name: 'Arena BT Parada',
        address: { city: { name: 'Belo Horizonte', state: 'MG' } },
        location: BH.center,
        acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
        sports: [{ slug: 'futevolei', name: 'Futevôlei' }],
        services: ['RENTAL'],
        rental: {
          pricePerHourCents: 10_000,
          minDurationMin: 60,
          maxDurationMin: 180,
          minAdvanceMin: 60,
          windowDays: 30,
          cancellationDeadlineMin: 60,
        },
      });
      expect(res.body.courts).toEqual([
        {
          id: expect.any(String),
          name: 'Quadra 1',
          covered: false,
          sports: [expect.objectContaining({ slug: 'futevolei', maxPlayers: 4 })],
        },
      ]);
      const centro = await t.http().get('/v1/spaces/centro').expect(200);
      expect(centro.body.photos.map((p: { position: number }) => p.position)).toEqual([0, 1]);
      expect(centro.body.amenities.map((a: { slug: string }) => a.slug)).toEqual([
        'banheiro',
        'wi-fi',
      ]);
    });

    it.each(['sem-preco', 'sem-quadra', 'manutencao', 'suspensa', 'nao-existe'])(
      '%s: 404',
      async (slug) => {
        const res = await t.http().get(`/v1/spaces/${slug}`).expect(404);
        expect(res.body.error.code).toBe('SPACE_NOT_FOUND');
      },
    );
  });

  describe('favoritos (RF-SPACE-09)', () => {
    const fav = (method: 'put' | 'delete', spaceId: string, user = player) =>
      t.http()[method](`/v1/spaces/${spaceId}/favorite`).set('cookie', user.cookie);
    const list = async (user = player) =>
      slugs(
        (await t.http().get('/v1/me/favorites').set('cookie', user.cookie).expect(200)).body.items,
      );

    it('favorita (idempotente), lista do mais recente e desfavorita', async () => {
      await fav('put', ids.pampulha as string).expect(204);
      await fav('put', ids.centro as string).expect(204);
      await fav('put', ids.centro as string).expect(204);
      expect(await list()).toEqual(['centro', 'pampulha']);

      const other = await signUp(t, 'outro@exemplo.com');
      expect(await list(other)).toEqual([]);

      await fav('delete', ids.centro as string).expect(204);
      await fav('delete', ids.centro as string).expect(204);
      expect(await list()).toEqual(['pampulha']);
    });

    it('espaço suspenso some da lista e não pode ser favoritado', async () => {
      const user = await signUp(t, 'fa@exemplo.com');
      await fav('put', ids.contagem as string, user).expect(204);
      await setSpaceStatus(t.db, ids.contagem as string, 'SUSPENDED');
      try {
        expect(await list(user)).toEqual([]);
        await fav('put', ids.suspensa as string, user).expect(404);
      } finally {
        await setSpaceStatus(t.db, ids.contagem as string, 'ACTIVE');
      }
      expect(await list(user)).toEqual(['contagem']);
    });

    it('id malformado ou inexistente: 404', async () => {
      await fav('put', 'nao-e-uuid').expect(404);
      await fav('put', '0192f3a4-5b6c-7d8e-9f01-23456789abcd').expect(404);
    });
  });
});
