import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdCandidatesCache } from '../../src/ads/ad-candidates.cache.js';
import { adCampaigns } from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { advertiser, campaign, creative, type SuperAds, superAds } from '../ads/fixtures.js';
import { createTestApp, type TestApp } from '../auth/helpers.js';
import {
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  seedCatalog,
} from '../spaces/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertReviewRow } from './qa-fixtures.js';

// AV.5 · RF-REVIEW-03: o destino `SPACE` dos anúncios entrega o card do espaço com `rating`
// ({ count, average }), lido das colunas do espaço (src/ads/delivery.service.ts), igual ao card
// da vitrine: "Novo" (média nula) abaixo de 5 avaliações e fora da média o autor bloqueado.

describe('anúncio com destino em espaço: rating do card (RF-REVIEW-03)', () => {
  let t: TestApp;
  let catalog: Catalog;
  let api: SuperAds;
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: new FakeGeocoder() },
        { provide: PhotoStorage, useValue: storage },
      ],
    });
    catalog = await seedCatalog(t.db);
    api = superAds(t, await superUser(t, 'super-ads-rating@exemplo.com'));
    // Os testes mudam o banco direto: sem o cache de 60 s.
    t.app.get(AdCandidatesCache).ttlMs = 0;
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.db.update(adCampaigns).set({ status: 'ARCHIVED' });
  });

  const delivered = async (placement: 'EXPLORE_HERO' | 'EXPLORE_FEED') => {
    const res = await t.http().get('/v1/ads').query({ placement }).expect(200);
    return res.body.items as Array<{ destination: { type: string; space: { rating: unknown } } }>;
  };

  it.each(['EXPLORE_HERO', 'EXPLORE_FEED'] as const)(
    '%s: { count, average } acompanha as avaliações que contam',
    async (placement) => {
      const space = await createSpace(t.db, catalog, {
        name: `Arena Ads Rating ${placement}`,
        photos: 1,
      });
      const owner = await advertiser(api, {
        name: `Arena Ads Rating ${placement}`,
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      const { id } = await campaign(api, owner.id, { placement });
      await creative(api, storage, id, placement, {
        imageKey: null,
        title: 'Arena em destaque',
        destination: { type: 'SPACE', spaceId: space.id },
      });
      const rating = async () => {
        const [item] = await delivered(placement);
        expect(item?.destination.type).toBe('SPACE');
        const value = item?.destination.space.rating;
        expect(Object.keys(value as object).sort()).toEqual(['average', 'count']);
        return value;
      };

      // Sem avaliações: "Novo".
      expect(await rating()).toEqual({ count: 0, average: null });

      // Até 4 avaliações: a contagem sobe, a média continua nula ("Novo").
      for (const stars of [5, 4, 5, 5]) await insertReviewRow(t.db, space.id, { rating: stars });
      expect(await rating()).toEqual({ count: 4, average: null });

      // Avaliação de autor bloqueado (fora da média) não conta.
      await insertReviewRow(t.db, space.id, { rating: 1, counted: false });
      expect(await rating()).toEqual({ count: 4, average: null });

      // A 5ª que conta mostra a média com uma casa: (5+4+5+5+2)/5 = 4,2.
      await insertReviewRow(t.db, space.id, { rating: 2 });
      expect(await rating()).toEqual({ count: 5, average: 4.2 });
    },
  );
});
