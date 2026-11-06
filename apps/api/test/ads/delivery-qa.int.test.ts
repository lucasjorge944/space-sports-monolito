import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdCandidatesCache } from '../../src/ads/ad-candidates.cache.js';
import { runAdsJob } from '../../src/ads/ads.jobs.js';
import { AdDeliveryService } from '../../src/ads/delivery.service.js';
import { DeliveryTokens } from '../../src/ads/delivery-token.js';
import { AdEventsService } from '../../src/ads/events.service.js';
import { adCampaigns, adDailyStats, adEventReceipts, cities } from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import {
  BH,
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  seedCatalog,
} from '../spaces/fixtures.js';
import { bearer, type Row, superUser } from '../super/fixtures.js';
import { advertiser, campaign, creative, DAY_MS, type SuperAds, superAds } from './fixtures.js';

// QA (AD.5): RF-ADS-07 (entrega pública, filtros e sorteio), RF-ADS-08 e RN-ADS-03/04 (eventos,
// tokens, concorrência, fuso) e RF-ADS-09 (relatório e CSV batendo com os eventos). Complementa
// delivery.int.test.ts com o que a AD.2 não cobriu.

/** PRNG com semente (mulberry32): sorteios reproduzíveis. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linhas do CSV (sem o BOM) em colunas. */
function parseCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split('\r\n')
    .filter(Boolean)
    .map((line) =>
      line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/"/g, '')),
    );
}

describe('anúncios: entrega, eventos e relatório (QA)', () => {
  let t: TestApp;
  let catalog: Catalog;
  let api: SuperAds;
  let tokens: DeliveryTokens;
  let events: AdEventsService;
  let delivery: AdDeliveryService;
  let cache: AdCandidatesCache;
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: new FakeGeocoder() },
        { provide: PhotoStorage, useValue: storage },
      ],
    });
    catalog = await seedCatalog(t.db);
    api = superAds(t, await superUser(t, 'super-qa-entrega@exemplo.com'));
    cache = t.app.get(AdCandidatesCache);
    cache.ttlMs = 0;
    tokens = t.app.get(DeliveryTokens);
    events = t.app.get(AdEventsService);
    delivery = t.app.get(AdDeliveryService);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    cache.ttlMs = 0;
    cache.clear();
    await t.db.update(adCampaigns).set({ status: 'ARCHIVED' });
  });

  const deliver = (query: Record<string, string | number>) => t.http().get('/v1/ads').query(query);
  const titles = async (query: Record<string, string | number>) =>
    ((await deliver(query).expect(200)).body.items as Row[]).map((row) => row.title).sort();
  const sendEvents = (list: { token: string; type: string }[]) =>
    t.http().post('/v1/ads/events').send({ events: list });
  const statsOf = (creativeId: string) =>
    t.db.select().from(adDailyStats).where(eq(adDailyStats.creativeId, creativeId));

  async function liveCreative(name: string, overrides: Record<string, unknown> = {}) {
    const { id: advertiserId } = await advertiser(api, { name });
    const { id: campaignId } = await campaign(api, advertiserId);
    const piece = await creative(api, storage, campaignId, 'EXPLORE_HERO', overrides);
    return { advertiserId, campaignId, creativeId: piece.id };
  }
  async function tokenFor(creativeId: string, campaignId: string, now?: Date) {
    return tokens.sign({ creativeId, campaignId, placement: 'EXPLORE_HERO' }, now);
  }

  describe('RF-ADS-07: acesso público e dados que não vazam', () => {
    it('sem login, com Bearer inválido ou logado: mesma resposta, e só os campos públicos', async () => {
      const { id: advertiserId } = await advertiser(api, {
        name: 'Anunciante Privado',
        contactName: 'Fulana Comercial',
        contactEmail: 'comercial-secreto@exemplo.com',
        contactPhone: '+5531911112222',
        notes: 'nota interna que ninguém pode ver',
      });
      const { id } = await campaign(api, advertiserId, { weight: 7, name: 'Nome interno' });
      await creative(api, storage, id, 'EXPLORE_HERO', { title: 'Pública' });
      const player = await signUp(t, 'jogador-qa-entrega@exemplo.com');

      const anon = await deliver({ placement: 'EXPLORE_HERO' }).expect(200);
      const bogus = await deliver({ placement: 'EXPLORE_HERO' })
        .set('authorization', 'Bearer token-invalido')
        .expect(200);
      const logged = await deliver({ placement: 'EXPLORE_HERO' })
        .set(...bearer(player))
        .expect(200);
      for (const res of [anon, bogus, logged]) {
        expect(res.body.items).toHaveLength(1);
        expect(Object.keys(res.body.items[0]).sort()).toEqual(
          [
            'advertiser',
            'body',
            'campaignId',
            'creativeId',
            'ctaLabel',
            'deliveryToken',
            'destination',
            'imageUrl',
            'placement',
            'title',
            'tokenExpiresAt',
          ].sort(),
        );
        expect(Object.keys(res.body.items[0].advertiser).sort()).toEqual(['kind', 'name']);
        const dump = JSON.stringify(res.body);
        for (const secret of [
          'comercial-secreto',
          '+5531911112222',
          'Fulana Comercial',
          'nota interna',
          'Nome interno',
          'cityIds',
          'sportIds',
          '"weight"',
          '"status"',
          'createdBy',
        ]) {
          expect(dump, secret).not.toContain(secret);
        }
      }
      // Cada entrega tem token próprio (não reaproveita o id da entrega).
      expect(anon.body.items[0].deliveryToken).not.toBe(bogus.body.items[0].deliveryToken);
    });

    it('parâmetros inválidos: 400 com VALIDATION_ERROR, sem 500', async () => {
      const bad: Record<string, string | number>[] = [
        { placement: 'OUTRA_VAGA' },
        { placement: 'EXPLORE_HERO', cityId: 'nao-e-uuid' },
        { placement: 'EXPLORE_HERO', sportId: 'nao-e-uuid' },
        { placement: 'EXPLORE_HERO', lat: 91, lng: 0 },
        { placement: 'EXPLORE_HERO', lat: 0, lng: 181 },
        { placement: 'EXPLORE_HERO', lat: 'abc', lng: 0 },
        { placement: 'EXPLORE_HERO', lng: -43.9 },
        { placement: 'EXPLORE_HERO', sport: '' },
      ];
      for (const query of bad) {
        const res = await deliver(query);
        expect(res.status, JSON.stringify(query)).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('RF-ADS-07: filtros', () => {
    it('cidade e esporte juntos: a campanha precisa casar com os dois', async () => {
      const other = first(
        await t.db
          .insert(cities)
          .values({ name: 'Nova Lima', state: 'MG', timezone: 'America/Sao_Paulo' })
          .returning(),
      );
      const { id: advertiserId } = await advertiser(api, { name: 'Cidade e Esporte' });
      const both = await campaign(api, advertiserId, {
        cityIds: [catalog.city.id],
        sportIds: [catalog.sport('futevolei').id],
      });
      await creative(api, storage, both.id, 'EXPLORE_HERO', { title: 'BH + futevôlei' });
      const twoCities = await campaign(api, advertiserId, {
        cityIds: [catalog.city.id, other.id],
      });
      await creative(api, storage, twoCities.id, 'EXPLORE_HERO', { title: 'Duas cidades' });
      const twoSports = await campaign(api, advertiserId, {
        sportIds: [catalog.sport('futevolei').id, catalog.sport('beach-tennis').id],
      });
      await creative(api, storage, twoSports.id, 'EXPLORE_HERO', { title: 'Dois esportes' });

      const hero = { placement: 'EXPLORE_HERO' };
      const bh = catalog.city.id;
      // Cidade certa + esporte certo.
      expect(await titles({ ...hero, cityId: bh, sport: 'futevolei' })).toEqual([
        'BH + futevôlei',
        'Dois esportes',
        'Duas cidades',
      ]);
      // Cidade certa, esporte errado ou ausente: some a campanha com esporte.
      expect(await titles({ ...hero, cityId: bh, sport: 'beach-tennis' })).toEqual([
        'Dois esportes',
        'Duas cidades',
      ]);
      expect(await titles({ ...hero, cityId: bh })).toEqual(['Duas cidades']);
      // Esporte certo, cidade errada ou ausente.
      expect(await titles({ ...hero, cityId: other.id, sport: 'futevolei' })).toEqual([
        'Dois esportes',
        'Duas cidades',
      ]);
      expect(await titles({ ...hero, sport: 'futevolei' })).toEqual(['Dois esportes']);
      // sportId tem precedência sobre o slug.
      expect(
        await titles({
          ...hero,
          cityId: bh,
          sportId: catalog.sport('beach-tennis').id,
          sport: 'futevolei',
        }),
      ).toEqual(['Dois esportes', 'Duas cidades']);
    });

    it('fronteira do período: começa no início (inclusive) e deixa de valer no fim (exclusive)', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Fronteira' });
      const mk = async (title: string, startsAtMs: number, endsAtMs: number) => {
        const { id } = await campaign(api, advertiserId);
        await creative(api, storage, id, 'EXPLORE_HERO', { title });
        await t.db
          .update(adCampaigns)
          .set({ startsAt: new Date(startsAtMs), endsAt: new Date(endsAtMs) })
          .where(eq(adCampaigns.id, id));
      };
      const now = Date.now();
      await mk('Começou há 1 s', now - 1000, now + DAY_MS);
      await mk('Começa em 1 min', now + 60_000, now + DAY_MS);
      await mk('Acabou há 1 s', now - DAY_MS, now - 1000);
      await mk('Acaba em 1 min', now - DAY_MS, now + 60_000);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([
        'Acaba em 1 min',
        'Começou há 1 s',
      ]);
    });

    it('campanha de espaço com filtro de cidade usa o filtro da campanha, não a cidade do espaço', async () => {
      const space = await createSpace(t.db, catalog, {
        name: 'Arena Filtro',
        location: BH.center,
        photos: 1,
      });
      const other = first(
        await t.db
          .insert(cities)
          .values({ name: 'Sabará', state: 'MG', timezone: 'America/Sao_Paulo' })
          .returning(),
      );
      const spaceAdvertiser = await advertiser(api, {
        name: 'Arena Filtro',
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      const { id } = await campaign(api, spaceAdvertiser.id, { cityIds: [other.id] });
      await creative(api, storage, id, 'EXPLORE_HERO', {
        imageKey: null,
        title: 'Só em Sabará',
        destination: { type: 'SPACE', spaceId: space.id },
      });
      expect(await titles({ placement: 'EXPLORE_HERO', cityId: catalog.city.id })).toEqual([]);
      expect(await titles({ placement: 'EXPLORE_HERO', ...BH.savassi })).toEqual([]);
      expect(await titles({ placement: 'EXPLORE_HERO', cityId: other.id })).toEqual([
        'Só em Sabará',
      ]);
    });
  });

  describe('RF-ADS-07: sorteio por peso (semente fixa, estatístico)', () => {
    async function campaigns(placement: 'EXPLORE_HERO' | 'EXPLORE_FEED', weights: number[]) {
      const { id: advertiserId } = await advertiser(api, { name: `Pesos ${placement}` });
      const out: { id: string; weight: number; creativeIds: string[] }[] = [];
      for (const [i, weight] of weights.entries()) {
        const { id } = await campaign(api, advertiserId, { placement, weight });
        const piece = await creative(api, storage, id, placement, { title: `C${i}` });
        out.push({ id, weight, creativeIds: [piece.id] });
      }
      return out;
    }

    it('a 1ª posição segue weight/Σweight com 3 campanhas (1, 2 e 7)', async () => {
      const list = await campaigns('EXPLORE_HERO', [1, 2, 7]);
      cache.ttlMs = 60_000; // 1 consulta ao banco; o resto vem do cache
      const random = seeded(20260311);
      const rounds = 4000;
      const firstCounts = new Map<string, number>();
      for (let i = 0; i < rounds; i++) {
        const { items } = await delivery.deliver({ placement: 'EXPLORE_HERO' }, new Date(), random);
        expect(items).toHaveLength(3);
        const head = items[0]?.campaignId as string;
        firstCounts.set(head, (firstCounts.get(head) ?? 0) + 1);
      }
      for (const c of list) {
        const rate = (firstCounts.get(c.id) ?? 0) / rounds;
        const expected = c.weight / 10;
        // 4000 rodadas: desvio-padrão ≤ 0,8 p.p.; 4 p.p. é folga de ~5 desvios.
        expect(Math.abs(rate - expected), `peso ${c.weight}`).toBeLessThan(0.04);
      }
    });

    it('com mais campanhas que vagas, o peso decide quem entra, e peso 1 nunca é esquecido', async () => {
      // 8 campanhas para 5 vagas no carrossel: 3 pesadas (10) e 5 leves (1).
      const list = await campaigns('EXPLORE_HERO', [10, 10, 10, 1, 1, 1, 1, 1]);
      cache.ttlMs = 60_000;
      const random = seeded(7);
      const rounds = 2000;
      const included = new Map<string, number>();
      for (let i = 0; i < rounds; i++) {
        const { items } = await delivery.deliver({ placement: 'EXPLORE_HERO' }, new Date(), random);
        expect(items).toHaveLength(5);
        expect(new Set(items.map((item) => item.campaignId)).size).toBe(5);
        for (const item of items)
          included.set(item.campaignId, (included.get(item.campaignId) ?? 0) + 1);
      }
      const rate = (id: string) => (included.get(id) ?? 0) / rounds;
      const heavy = list.filter((c) => c.weight === 10).map((c) => rate(c.id));
      const light = list.filter((c) => c.weight === 1).map((c) => rate(c.id));
      // Pesadas quase sempre entram; leves entram só nas vagas que sobram, mas entram.
      for (const r of heavy) expect(r).toBeGreaterThan(0.9);
      for (const r of light) {
        expect(r).toBeGreaterThan(0.05);
        expect(r).toBeLessThan(0.7);
      }
      expect(Math.min(...heavy)).toBeGreaterThan(Math.max(...light));
    });

    it('mesma semente, mesmo resultado; campanhas com 2+ peças alternam as peças', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Alterna' });
      const { id } = await campaign(api, advertiserId, { placement: 'EXPLORE_FEED' });
      const pieces: string[] = [];
      for (const n of [1, 2, 3]) {
        pieces.push((await creative(api, storage, id, 'EXPLORE_FEED', { title: `P${n}` })).id);
      }
      cache.ttlMs = 60_000;
      const run = async (seed: number) => {
        const random = seeded(seed);
        const out: string[] = [];
        for (let i = 0; i < 600; i++) {
          const { items } = await delivery.deliver(
            { placement: 'EXPLORE_FEED' },
            new Date(),
            random,
          );
          expect(items).toHaveLength(1);
          out.push(items[0]?.creativeId as string);
        }
        return out;
      };
      const a = await run(99);
      expect(await run(99)).toEqual(a);
      for (const piece of pieces) {
        const share = a.filter((x) => x === piece).length / a.length;
        expect(share, piece).toBeGreaterThan(0.25);
        expect(share, piece).toBeLessThan(0.42);
      }
    });
  });

  describe('RF-ADS-07: cache de 1 minuto', () => {
    it('com o TTL de 60 s, o banco só aparece depois do TTL; escrita do Super limpa na hora', async () => {
      const { campaignId } = await liveCreative('Cache');
      cache.ttlMs = 60_000;
      cache.clear();
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual(['Oferta da semana']);

      // Mudança direta no banco (outra instância): a cache ainda entrega até o TTL vencer.
      await t.db
        .update(adCampaigns)
        .set({ status: 'PAUSED' })
        .where(eq(adCampaigns.id, campaignId));
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual(['Oferta da semana']);
      cache.clear();
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);

      // Escrita pelo /super nesta instância: some na hora, sem esperar o TTL.
      await t.db
        .update(adCampaigns)
        .set({ status: 'ACTIVE' })
        .where(eq(adCampaigns.id, campaignId));
      cache.clear();
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual(['Oferta da semana']);
      await api.status(campaignId, 'PAUSED').expect(200);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);
      await api.status(campaignId, 'ACTIVE').expect(200);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual(['Oferta da semana']);
    });

    it('desativar o anunciante ou a peça pelo /super tira do ar na hora, mesmo com o cache', async () => {
      const { advertiserId, campaignId, creativeId } = await liveCreative('Cache 2');
      cache.ttlMs = 60_000;
      cache.clear();
      expect(await titles({ placement: 'EXPLORE_HERO' })).toHaveLength(1);
      await api.updateCreative(campaignId, creativeId, { active: false }).expect(200);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);
      await api.updateCreative(campaignId, creativeId, { active: true }).expect(200);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toHaveLength(1);
      await api.updateAdvertiser(advertiserId, { active: false }).expect(200);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);
    });
  });

  describe('RF-ADS-08 / RN-ADS-04: tokens', () => {
    it('payload trocado (outra peça) com a assinatura original é descartado, e nada é contado', async () => {
      const a = await liveCreative('Token A');
      const b = await liveCreative('Token B');
      const [item] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      const real = await tokenFor(a.creativeId, a.campaignId);
      const other = await tokenFor(b.creativeId, b.campaignId);
      const [realPayload, realSignature] = real.token.split('.') as [string, string];
      const [otherPayload, otherSignature] = other.token.split('.') as [string, string];

      const swapCreative = JSON.parse(Buffer.from(realPayload, 'base64url').toString());
      swapCreative.c = b.creativeId;
      const swapPlacement = JSON.parse(Buffer.from(realPayload, 'base64url').toString());
      swapPlacement.p = 'EXPLORE_FEED';
      const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

      const res = await sendEvents([
        // peça trocada no payload, assinatura da outra
        { token: `${enc(swapCreative)}.${realSignature}`, type: 'IMPRESSION' },
        { token: `${enc(swapCreative)}.${otherSignature}`, type: 'IMPRESSION' },
        // vaga trocada
        { token: `${enc(swapPlacement)}.${realSignature}`, type: 'CLICK' },
        // payload de B com assinatura de A (e o inverso)
        { token: `${otherPayload}.${realSignature}`, type: 'IMPRESSION' },
        { token: `${realPayload}.${otherSignature}`, type: 'IMPRESSION' },
        // assinatura vazia, truncada, com partes sobrando, em branco ou só o ponto
        { token: `${realPayload}.`, type: 'IMPRESSION' },
        { token: `${realPayload}.${realSignature.slice(0, -4)}`, type: 'IMPRESSION' },
        { token: `${real.token}.extra`, type: 'IMPRESSION' },
        { token: realPayload, type: 'IMPRESSION' },
        { token: '.', type: 'IMPRESSION' },
        { token: '   ', type: 'IMPRESSION' },
        { token: '{"v":1}', type: 'IMPRESSION' },
        // token da entrega real com o último caractere trocado: em 1 de 16 entregas a troca é só
        // outra grafia base64url da mesma assinatura, e mesmo assim tem que cair
        {
          token: item.deliveryToken.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A')),
          type: 'CLICK',
        },
      ]).expect(202);
      expect(res.body).toEqual({ accepted: 0 });
      expect(await statsOf(a.creativeId)).toEqual([]);
      expect(await statsOf(b.creativeId)).toEqual([]);
      expect(
        await t.db.$count(adEventReceipts, eq(adEventReceipts.deliveryId, real.claims.deliveryId)),
      ).toBe(0);
    });

    it('o token só conta para a peça que o assinou (A não soma em B)', async () => {
      const a = await liveCreative('Peça A');
      const b = await liveCreative('Peça B');
      const token = await tokenFor(a.creativeId, a.campaignId);
      expect(
        (await sendEvents([{ token: token.token, type: 'IMPRESSION' }]).expect(202)).body,
      ).toEqual({
        accepted: 1,
      });
      expect(await statsOf(a.creativeId)).toHaveLength(1);
      expect(await statsOf(b.creativeId)).toEqual([]);
    });

    // BUG (AD.5, ver relatório): RN-ADS-04 manda descartar em silêncio o evento que não bate com
    // uma peça. Um token com assinatura válida de peça que já não existe (ex.: banco recriado ou
    // seed reaplicado dentro das 2 h de validade; ambientes com o mesmo ADS_DELIVERY_SECRET) faz o
    // upsert em `ad_daily_stats` violar a FK `ad_daily_stats_creative_id_ad_creatives_id_fk`
    // (23503) e a API responde 500 INTERNAL_ERROR, e o lote inteiro se perde.
    it('token assinado de peça que não existe: 202 sem contar e sem erro 500', async () => {
      const ghost = '11111111-1111-4111-8111-111111111111';
      const signed = tokens.sign({
        creativeId: ghost,
        campaignId: ghost,
        placement: 'EXPLORE_HERO',
      });
      const res = await sendEvents([{ token: signed.token, type: 'IMPRESSION' }]);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: 0 });
      // O lote com uma peça fantasma não impede que as válidas contem.
      const live = await liveCreative('Ao lado do fantasma');
      const good = await tokenFor(live.creativeId, live.campaignId);
      const mixed = await sendEvents([
        { token: signed.token, type: 'CLICK' },
        { token: good.token, type: 'IMPRESSION' },
      ]);
      expect(mixed.status).toBe(202);
      expect(mixed.body).toEqual({ accepted: 1 });
    });

    it('token vencido continua descartado depois da limpeza dos recibos (não dá para reusar)', async () => {
      const live = await liveCreative('Vencido');
      const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const expired = await tokenFor(live.creativeId, live.campaignId, old);
      // Contou quando valia...
      await events.record({ events: [{ token: expired.token, type: 'IMPRESSION' }] }, old);
      expect((await statsOf(live.creativeId))[0]?.impressions).toBe(1);
      // ...o job apaga o recibo...
      await runAdsJob('purge-event-receipts', { events });
      expect(
        await t.db.$count(
          adEventReceipts,
          eq(adEventReceipts.deliveryId, expired.claims.deliveryId),
        ),
      ).toBe(0);
      // ...e o mesmo token, agora vencido e sem recibo, não conta de novo.
      const res = await sendEvents([
        { token: expired.token, type: 'IMPRESSION' },
        { token: expired.token, type: 'CLICK' },
      ]).expect(202);
      expect(res.body).toEqual({ accepted: 0 });
      expect((await statsOf(live.creativeId))[0]).toMatchObject({ impressions: 1, clicks: 0 });
    });

    it('validade: vale até 1 s antes de vencer e não vale no instante do vencimento', async () => {
      const live = await liveCreative('Borda do vencimento');
      const { token, claims } = await tokenFor(live.creativeId, live.campaignId);
      const justBefore = new Date(claims.expiresAt.getTime() - 1000);
      expect(tokens.verify(token, justBefore)).not.toBeNull();
      expect(tokens.verify(token, claims.expiresAt)).toBeNull();
      const res = await events.record(
        { events: [{ token, type: 'IMPRESSION' }] },
        new Date(claims.expiresAt.getTime() + 1000),
      );
      expect(res).toEqual({ accepted: 0 });
    });

    it('corpo inválido do POST /v1/ads/events: 400, nunca 500', async () => {
      const { token } = await tokenFor(
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      );
      const post = (body: unknown) =>
        t
          .http()
          .post('/v1/ads/events')
          .send(body as object);
      for (const body of [
        {},
        { events: [] },
        { events: 'x' },
        { events: [{ token }] },
        { events: [{ type: 'CLICK' }] },
        { events: [{ token: '', type: 'CLICK' }] },
        { events: [{ token: 'x'.repeat(1001), type: 'CLICK' }] },
        { events: [{ token, type: 'click' }] },
        { events: [{ token, type: 'CLICK', userId: 'abc' }] },
        { events: [{ token, type: 'CLICK' }], deviceId: 'abc' },
      ]) {
        const res = await post(body);
        expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      }
    });
  });

  describe('RF-ADS-08: concorrência e contadores', () => {
    it('muitos lotes simultâneos de entregas distintas somam exatamente (upsert sem perda)', async () => {
      const live = await liveCreative('Concorrência');
      const deliveries = await Promise.all(
        Array.from({ length: 40 }, () => tokenFor(live.creativeId, live.campaignId)),
      );
      // 40 impressões em lotes de 1 a 3 tokens sobrepostos entre si, 25 cliques.
      const batches = deliveries.map((d, i) => [
        { token: d.token, type: 'IMPRESSION' },
        ...(i < 25 ? [{ token: d.token, type: 'CLICK' }] : []),
        // repete o token de outra entrega no meio do lote (não pode contar duas vezes)
        { token: (deliveries[(i + 1) % 40] as { token: string }).token, type: 'IMPRESSION' },
      ]);
      const results = await Promise.all(batches.map((batch) => sendEvents(batch).expect(202)));
      const accepted = results.reduce((sum, r) => sum + (r.body.accepted as number), 0);
      expect(accepted).toBe(40 + 25);
      const rows = await statsOf(live.creativeId);
      expect(rows.reduce((s, r) => s + r.impressions, 0)).toBe(40);
      expect(rows.reduce((s, r) => s + r.clicks, 0)).toBe(25);
      expect(
        await t.db.$count(
          adEventReceipts,
          sql`${adEventReceipts.deliveryId} IN (${sql.join(
            deliveries.map((d) => sql`${d.claims.deliveryId}::uuid`),
            sql`, `,
          )})`,
        ),
      ).toBe(65);
    });

    it('o mesmo token em 15 requisições simultâneas conta uma vez só', async () => {
      const live = await liveCreative('Mesmo token');
      const { token } = await tokenFor(live.creativeId, live.campaignId);
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          sendEvents([
            { token, type: 'IMPRESSION' },
            { token, type: 'CLICK' },
          ]).expect(202),
        ),
      );
      expect(results.reduce((sum, r) => sum + (r.body.accepted as number), 0)).toBe(2);
      expect((await statsOf(live.creativeId))[0]).toMatchObject({ impressions: 1, clicks: 1 });
    });

    it('cliques nunca passam das impressões, em qualquer mistura de lotes', async () => {
      const live = await liveCreative('CTR máximo');
      const random = seeded(5);
      const list = await Promise.all(
        Array.from({ length: 30 }, () => tokenFor(live.creativeId, live.campaignId)),
      );
      const shuffled = list
        .flatMap((d) => [
          { token: d.token, type: 'IMPRESSION' },
          { token: d.token, type: 'CLICK' },
          { token: d.token, type: 'CLICK' },
        ])
        .sort(() => random() - 0.5);
      for (let i = 0; i < shuffled.length; i += 7) {
        await sendEvents(shuffled.slice(i, i + 7)).expect(202);
      }
      const [row] = await statsOf(live.creativeId);
      expect(row?.impressions).toBe(30);
      expect(row?.clicks).toBe(30);
      expect(row?.clicks).toBeLessThanOrEqual(row?.impressions ?? 0);
    });
  });

  describe('RF-ADS-09: relatório e CSV batem com os eventos', () => {
    it('3 dias de São Paulo, virada às 03:00 UTC: relatório, peças e CSV somam o mesmo', async () => {
      const { advertiserId } = await liveCreative('Base do relatório');
      const start = new Date('2026-08-10T03:00:00.000Z'); // 00:00 de 10/08 em SP
      const { id } = await campaign(api, advertiserId, {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 3 * DAY_MS).toISOString(),
        name: 'Campanha do relatório',
      });
      const a = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'Relatório A' });
      const b = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'Relatório B' });

      const send = async (creativeId: string, at: string, list: ('IMPRESSION' | 'CLICK')[]) => {
        const now = new Date(at);
        const { token } = await tokenFor(creativeId, id, now);
        await events.record({ events: list.map((type) => ({ token, type })) }, now);
      };
      // 10/08 em SP: 02:59:59Z é 09/08 23:59:59 (fora da campanha, mas contado no dia certo).
      await send(a.id, '2026-08-10T02:59:59.000Z', ['IMPRESSION']);
      await send(a.id, '2026-08-10T03:00:00.000Z', ['IMPRESSION', 'CLICK']); // 10/08 00:00
      await send(b.id, '2026-08-10T14:00:00.000Z', ['IMPRESSION']); // 10/08 11:00
      await send(a.id, '2026-08-11T02:59:59.000Z', ['IMPRESSION']); // 10/08 23:59:59
      await send(a.id, '2026-08-11T03:00:00.000Z', ['IMPRESSION', 'CLICK']); // 11/08
      await send(b.id, '2026-08-11T18:00:00.000Z', ['IMPRESSION', 'CLICK']); // 11/08
      await send(b.id, '2026-08-12T05:00:00.000Z', ['CLICK']); // 12/08 (clique sem impressão)

      const report = (await api.report(id).expect(200)).body;
      expect(report.from).toBe('2026-08-10');
      expect(report.to).toBe('2026-08-12');
      expect(report.days).toEqual([
        { day: '2026-08-10', impressions: 3, clicks: 1, ctr: 0.3333 },
        { day: '2026-08-11', impressions: 2, clicks: 2, ctr: 1 },
        { day: '2026-08-12', impressions: 1, clicks: 1, ctr: 1 },
      ]);
      expect(report.totals).toEqual({ impressions: 6, clicks: 4, ctr: 0.6667 });
      const sum = (key: 'impressions' | 'clicks') =>
        report.creatives.reduce((s: number, c: Row) => s + (c[key] as number), 0);
      expect(sum('impressions')).toBe(report.totals.impressions);
      expect(sum('clicks')).toBe(report.totals.clicks);
      const byTitle = Object.fromEntries(report.creatives.map((c: Row) => [c.title, c]));
      expect(byTitle['Relatório A']).toMatchObject({ impressions: 3, clicks: 2 });
      expect(byTitle['Relatório B']).toMatchObject({ impressions: 3, clicks: 2 });
      // Eventos do dia 09/08 (antes da campanha) ficam fora do período padrão mas existem.
      expect(
        (await api.report(id, { from: '2026-08-09', to: '2026-08-09' }).expect(200)).body.totals,
      ).toEqual({ impressions: 1, clicks: 0, ctr: 0 });

      // O CSV é o mesmo relatório: mesmas linhas, mesmo total.
      const csv = await api.reportCsv(id).expect(200);
      expect(csv.text.startsWith('﻿dia,impressoes,cliques,ctr_percentual\r\n')).toBe(true);
      const rows = parseCsv(csv.text);
      expect(rows.slice(1, -1).map((r) => [r[0], Number(r[1]), Number(r[2])])).toEqual(
        report.days.map((d: Row) => [
          `${(d.day as string).slice(8)}/${(d.day as string).slice(5, 7)}/${(d.day as string).slice(0, 4)}`,
          d.impressions,
          d.clicks,
        ]),
      );
      const total = rows.at(-1) as string[];
      expect(total[0]).toBe('total');
      expect(Number(total[1])).toBe(report.totals.impressions);
      expect(Number(total[2])).toBe(report.totals.clicks);
      expect(total[3]).toBe('66,67');
      expect(csv.headers['content-disposition']).toContain('anuncio-2026-08-10_2026-08-12.csv');

      // Filtrar o período vale para as peças e para o CSV.
      const one = await api.report(id, { from: '2026-08-11', to: '2026-08-11' }).expect(200);
      expect(one.body.totals).toEqual({ impressions: 2, clicks: 2, ctr: 1 });
      expect(one.body.creatives.map((c: Row) => [c.title, c.impressions, c.clicks])).toEqual([
        ['Relatório A', 1, 1],
        ['Relatório B', 1, 1],
      ]);
      const oneCsv = parseCsv(
        (await api.reportCsv(id, { from: '2026-08-11', to: '2026-08-11' }).expect(200)).text,
      );
      expect(oneCsv).toHaveLength(3);
    });

    it('relatório e CSV de campanha inexistente: 404; datas inválidas: 400', async () => {
      const missing = '99999999-9999-4999-8999-999999999999';
      for (const res of [await api.report(missing), await api.reportCsv(missing)]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('AD_CAMPAIGN_NOT_FOUND');
      }
      const { campaignId } = await liveCreative('Datas');
      const badQueries: Record<string, string>[] = [
        { from: '10/08/2026' },
        { from: '2026-13-40' },
        { to: 'amanhã' },
        { from: '2026-08-12', to: '2026-08-11' },
      ];
      for (const query of badQueries) {
        const res = await api.report(campaignId, query);
        expect(res.status, JSON.stringify(query)).toBe(400);
      }
      // Id que não é UUID: 404 (não existe), nunca 500.
      await api.report('nao-e-uuid').expect(404);
      // Campanha sem evento: relatório zerado, sem erro.
      const empty = await api.report(campaignId).expect(200);
      expect(empty.body.totals).toEqual({ impressions: 0, clicks: 0, ctr: 0 });
    });

    it('eventos de entregas reais pela API aparecem no relatório (ponta a ponta)', async () => {
      const live = await liveCreative('Ponta a ponta');
      const item = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items.find(
        (row: Row) => row.campaignId === live.campaignId,
      );
      expect(item).toBeDefined();
      await sendEvents([
        { token: item.deliveryToken, type: 'IMPRESSION' },
        { token: item.deliveryToken, type: 'CLICK' },
      ]).expect(202);
      const report = (await api.report(live.campaignId).expect(200)).body;
      expect(report.totals).toEqual({ impressions: 1, clicks: 1, ctr: 1 });
      const csv = parseCsv((await api.reportCsv(live.campaignId).expect(200)).text);
      expect(csv.at(-1)).toEqual(['total', '1', '1', '100,00']);
      // Nada além do dia aparece nas linhas de dado dos contadores.
      const rows = await t.db
        .select()
        .from(adDailyStats)
        .where(and(eq(adDailyStats.campaignId, live.campaignId)));
      expect(rows).toHaveLength(1);
    });
  });
});
