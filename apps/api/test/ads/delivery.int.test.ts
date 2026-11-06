import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdCandidatesCache } from '../../src/ads/ad-candidates.cache.js';
import { runAdsJob } from '../../src/ads/ads.jobs.js';
import { DeliveryTokens } from '../../src/ads/delivery-token.js';
import { AdEventsService } from '../../src/ads/events.service.js';
import {
  adCampaigns,
  adDailyStats,
  adEventReceipts,
  auditLogs,
  cities,
  spaceSettings,
} from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import {
  BH,
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  seedCatalog,
  setSpaceStatus,
} from '../spaces/fixtures.js';
import { type Row, superUser } from '../super/fixtures.js';
import {
  advertiser,
  campaign,
  creative,
  DAY_MS,
  period,
  type SuperAds,
  superAds,
} from './fixtures.js';

// RF-ADS-07, 08 e 09; RN-ADS-03, 04 e 05: entrega pública, eventos e relatório.

/** Lisboa fica a ~7.500 km de BH: nenhum espaço perto. */
const FAR_AWAY = { lat: 38.72, lng: -9.14 };

describe('entrega e métricas dos anúncios', () => {
  let t: TestApp;
  let catalog: Catalog;
  let api: SuperAds;
  let tokens: DeliveryTokens;
  let events: AdEventsService;
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: new FakeGeocoder() },
        { provide: PhotoStorage, useValue: storage },
      ],
    });
    catalog = await seedCatalog(t.db);
    api = superAds(t, await superUser(t, 'super-entrega@exemplo.com'));
    // Os testes mudam o banco direto: sem o cache de 60 s.
    t.app.get(AdCandidatesCache).ttlMs = 0;
    tokens = t.app.get(DeliveryTokens);
    events = t.app.get(AdEventsService);
  });
  afterAll(() => t.close());

  // Cada teste começa sem campanha no ar.
  beforeEach(async () => {
    await t.db.update(adCampaigns).set({ status: 'ARCHIVED' });
  });

  const deliver = (query: Record<string, string | number>) => t.http().get('/v1/ads').query(query);
  const titles = async (query: Record<string, string | number>) =>
    ((await deliver(query).expect(200)).body.items as Row[]).map((row) => row.title).sort();
  const sendEvents = (list: { token: string; type: string }[]) =>
    t.http().post('/v1/ads/events').send({ events: list });

  describe('GET /v1/ads (RF-ADS-07)', () => {
    it('público, sem cache no cliente, com selo, destino e token de 2 h', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Rede Teste' });
      const { id } = await campaign(api, advertiserId);
      const piece = await creative(api, storage, id, 'EXPLORE_HERO', {
        title: 'Banner',
        destination: { type: 'WHATSAPP', phone: '+5531900000090', message: 'Olá, vim pelo app!' },
      });

      const res = await deliver({ placement: 'EXPLORE_HERO' }).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.items).toHaveLength(1);
      const [item] = res.body.items;
      expect(item).toMatchObject({
        creativeId: piece.id,
        campaignId: id,
        placement: 'EXPLORE_HERO',
        advertiser: { name: 'Rede Teste', kind: 'COMPANY' },
        title: 'Banner',
        imageUrl: expect.stringMatching(/^https:\/\/fotos\.test\/ads\//),
        destination: {
          type: 'WHATSAPP',
          phone: '+5531900000090',
          message: 'Olá, vim pelo app!',
          url: 'https://wa.me/5531900000090?text=Ol%C3%A1%2C%20vim%20pelo%20app!',
        },
      });
      const claims = tokens.verify(item.deliveryToken);
      expect(claims).toMatchObject({
        creativeId: piece.id,
        campaignId: id,
        placement: 'EXPLORE_HERO',
      });
      const ttl = Date.parse(item.tokenExpiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(2 * 60 * 60 * 1000 - 60_000);
      expect(ttl).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
      // Outra vaga não vê a peça.
      expect((await deliver({ placement: 'EXPLORE_FEED' }).expect(200)).body.items).toEqual([]);
      await deliver({}).expect(400);
    });

    it('só campanhas no ar: status, período, anunciante ativo e peça ativa', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Filtro Status' });
      const live = await campaign(api, advertiserId);
      await creative(api, storage, live.id, 'EXPLORE_HERO', { title: 'No ar' });
      const paused = await campaign(api, advertiserId);
      await creative(api, storage, paused.id, 'EXPLORE_HERO', { title: 'Pausada' });
      await api.status(paused.id, 'PAUSED').expect(200);
      const draft = await campaign(api, advertiserId, { status: 'DRAFT' });
      await creative(api, storage, draft.id, 'EXPLORE_HERO', { title: 'Rascunho' });
      const future = await campaign(api, advertiserId, period(1, 10));
      await creative(api, storage, future.id, 'EXPLORE_HERO', { title: 'Futura' });
      const ended = await campaign(api, advertiserId, period(-10, -1));
      await creative(api, storage, ended.id, 'EXPLORE_HERO', { title: 'Encerrada' });
      const off = await creative(api, storage, live.id, 'EXPLORE_HERO', { title: 'Peça inativa' });
      await api.updateCreative(live.id, off.id, { active: false }).expect(200);

      // Uma peça por campanha: a ativa.
      for (let i = 0; i < 5; i++) {
        expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual(['No ar']);
      }

      // Anunciante inativo tira tudo do ar.
      await api.updateAdvertiser(advertiserId, { active: false }).expect(200);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);
    });

    it('cidade: cityId, coordenadas (espaço da vitrine mais próximo) ou só campanhas sem cidade', async () => {
      const other = first(
        await t.db
          .insert(cities)
          .values({ name: 'Contagem', state: 'MG', timezone: 'America/Sao_Paulo' })
          .returning(),
      );
      await createSpace(t.db, catalog, { name: 'Arena Centro', location: BH.center });
      const { id: advertiserId } = await advertiser(api, { name: 'Filtro Cidade' });
      const everywhere = await campaign(api, advertiserId);
      await creative(api, storage, everywhere.id, 'EXPLORE_HERO', { title: 'Todas' });
      const bh = await campaign(api, advertiserId, { cityIds: [catalog.city.id] });
      await creative(api, storage, bh.id, 'EXPLORE_HERO', { title: 'BH' });
      const contagem = await campaign(api, advertiserId, { cityIds: [other.id] });
      await creative(api, storage, contagem.id, 'EXPLORE_HERO', { title: 'Contagem' });

      expect(await titles({ placement: 'EXPLORE_HERO', cityId: catalog.city.id })).toEqual([
        'BH',
        'Todas',
      ]);
      expect(await titles({ placement: 'EXPLORE_HERO', cityId: other.id })).toEqual([
        'Contagem',
        'Todas',
      ]);
      // Pela Savassi (~1,5 km do espaço do centro): BH.
      expect(await titles({ placement: 'EXPLORE_HERO', ...BH.savassi })).toEqual(['BH', 'Todas']);
      // Longe de qualquer espaço, ou sem cidade: só as campanhas sem cidade.
      expect(await titles({ placement: 'EXPLORE_HERO', ...FAR_AWAY })).toEqual(['Todas']);
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual(['Todas']);
      await deliver({ placement: 'EXPLORE_HERO', lat: BH.center.lat }).expect(400);
    });

    it('esporte: sportId ou slug; sem esporte, só campanhas sem esporte', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Filtro Esporte' });
      const all = await campaign(api, advertiserId, { placement: 'EXPLORE_FEED' });
      await creative(api, storage, all.id, 'EXPLORE_FEED', { title: 'Todos' });
      const beach = await campaign(api, advertiserId, {
        placement: 'EXPLORE_FEED',
        sportIds: [catalog.sport('beach-tennis').id],
      });
      await creative(api, storage, beach.id, 'EXPLORE_FEED', { title: 'Beach' });

      const feed = { placement: 'EXPLORE_FEED' };
      expect(await titles({ ...feed, sportId: catalog.sport('beach-tennis').id })).toEqual([
        'Beach',
        'Todos',
      ]);
      expect(await titles({ ...feed, sport: 'beach-tennis' })).toEqual(['Beach', 'Todos']);
      expect(await titles({ ...feed, sport: 'futevolei' })).toEqual(['Todos']);
      expect(await titles({ ...feed, sport: 'nao-existe' })).toEqual(['Todos']);
      expect(await titles(feed)).toEqual(['Todos']);
    });

    it('destino em espaço: card da vitrine; fora da vitrine a peça some (RN-ADS-05)', async () => {
      const space = await createSpace(t.db, catalog, {
        name: 'Arena Patrocinada',
        neighborhood: 'Savassi',
        photos: 1,
        courts: [{ sports: ['beach-tennis', 'futevolei'] }],
      });
      const spaceAdvertiser = await advertiser(api, {
        name: 'Arena Patrocinada',
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      const { id } = await campaign(api, spaceAdvertiser.id);
      await creative(api, storage, id, 'EXPLORE_HERO', {
        imageKey: null,
        title: 'Arena Patrocinada',
        destination: { type: 'SPACE', spaceId: space.id },
      });

      const [item] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      expect(item).toMatchObject({
        advertiser: { name: 'Arena Patrocinada', kind: 'SPACE' },
        imageUrl: null,
        destination: {
          type: 'SPACE',
          space: {
            id: space.id,
            slug: space.slug,
            name: 'Arena Patrocinada',
            neighborhood: 'Savassi',
            cover: { url: `https://fotos.test/${space.slug}/0.jpg` },
            pricePerHourCents: 10_000,
            distanceMeters: null,
          },
        },
      });
      expect(item.destination.space.sports.map((s: Row) => s.slug).sort()).toEqual([
        'beach-tennis',
        'futevolei',
      ]);

      await setSpaceStatus(t.db, space.id, 'SUSPENDED');
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);
      await setSpaceStatus(t.db, space.id, 'ACTIVE');
      // Sem preço também sai da vitrine.
      await t.db
        .update(spaceSettings)
        .set({ pricePerHourCents: null })
        .where(eq(spaceSettings.spaceId, space.id));
      expect(await titles({ placement: 'EXPLORE_HERO' })).toEqual([]);
    });

    it('sorteio: até 5 no carrossel e 10 no card, sem repetir campanha', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Muitas Campanhas' });
      for (const placement of ['EXPLORE_HERO', 'EXPLORE_FEED'] as const) {
        for (let i = 0; i < 12; i++) {
          const { id } = await campaign(api, advertiserId, { placement, weight: (i % 10) + 1 });
          await creative(api, storage, id, placement, { title: `${placement} ${i} a` });
          await creative(api, storage, id, placement, { title: `${placement} ${i} b` });
        }
      }
      for (let round = 0; round < 10; round++) {
        for (const [placement, max] of [
          ['EXPLORE_HERO', 5],
          ['EXPLORE_FEED', 10],
        ] as const) {
          const items = (await deliver({ placement }).expect(200)).body.items as Row[];
          expect(items).toHaveLength(max);
          expect(new Set(items.map((row) => row.campaignId)).size).toBe(max);
        }
      }
    });

    it('sorteio ponderado: a campanha de peso 9 vem primeiro ~90% das vezes', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Pesos' });
      const heavy = await campaign(api, advertiserId, { weight: 9 });
      await creative(api, storage, heavy.id, 'EXPLORE_HERO', { title: 'Pesada' });
      const light = await campaign(api, advertiserId, { weight: 1 });
      await creative(api, storage, light.id, 'EXPLORE_HERO', { title: 'Leve' });

      let heavyFirst = 0;
      const rounds = 300;
      for (let i = 0; i < rounds; i++) {
        const items = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
        expect(items).toHaveLength(2);
        if (items[0].title === 'Pesada') heavyFirst += 1;
      }
      // Esperado 0,9; com 300 rodadas, 0,8 a 0,97 cobre bem mais que 3 desvios-padrão.
      expect(heavyFirst / rounds).toBeGreaterThan(0.8);
      expect(heavyFirst / rounds).toBeLessThan(0.97);
    });
  });

  describe('POST /v1/ads/events (RF-ADS-08, RN-ADS-04)', () => {
    async function delivered() {
      const { id: advertiserId } = await advertiser(api, { name: 'Eventos' });
      const { id } = await campaign(api, advertiserId);
      const piece = await creative(api, storage, id, 'EXPLORE_HERO');
      const [item] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      return { campaignId: id, creativeId: piece.id, token: item.deliveryToken as string };
    }
    const statsOf = (creativeId: string) =>
      t.db.select().from(adDailyStats).where(eq(adDailyStats.creativeId, creativeId));

    it('conta uma impressão e um clique por token, mesmo reenviado', async () => {
      const { creativeId, token } = await delivered();
      const res = await sendEvents([
        { token, type: 'IMPRESSION' },
        { token, type: 'IMPRESSION' },
        { token, type: 'CLICK' },
      ]).expect(202);
      expect(res.body).toEqual({ accepted: 2 });
      // Reenvio (ex.: o app tentou de novo): não soma.
      expect(
        (
          await sendEvents([
            { token, type: 'IMPRESSION' },
            { token, type: 'CLICK' },
          ]).expect(202)
        ).body,
      ).toEqual({ accepted: 0 });
      const [stats] = await statsOf(creativeId);
      expect(stats).toMatchObject({ impressions: 1, clicks: 1, placement: 'EXPLORE_HERO' });

      // Outra entrega da mesma peça conta de novo.
      const [again] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      await sendEvents([{ token: again.deliveryToken, type: 'IMPRESSION' }]).expect(202);
      expect((await statsOf(creativeId))[0]).toMatchObject({ impressions: 2, clicks: 1 });
    });

    it('clique sem impressão grava a impressão junto: cliques nunca passam das impressões', async () => {
      const { creativeId, token } = await delivered();
      // Só o clique chegou (o lote da impressão se perdeu ou ainda vem).
      expect((await sendEvents([{ token, type: 'CLICK' }]).expect(202)).body).toEqual({
        accepted: 1,
      });
      expect((await statsOf(creativeId))[0]).toMatchObject({ impressions: 1, clicks: 1 });
      // A impressão que chega depois já está contada.
      expect((await sendEvents([{ token, type: 'IMPRESSION' }]).expect(202)).body).toEqual({
        accepted: 0,
      });
      expect((await statsOf(creativeId))[0]).toMatchObject({ impressions: 1, clicks: 1 });

      // Impressão e clique no mesmo lote, em qualquer ordem: um de cada.
      const [other] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      const both = await sendEvents([
        { token: other.deliveryToken, type: 'CLICK' },
        { token: other.deliveryToken, type: 'IMPRESSION' },
      ]).expect(202);
      expect(both.body).toEqual({ accepted: 2 });
      expect((await statsOf(creativeId))[0]).toMatchObject({ impressions: 2, clicks: 2 });

      // Lotes simultâneos da mesma entrega (clique e impressão): ainda um de cada.
      const [third] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      await Promise.all([
        sendEvents([{ token: third.deliveryToken, type: 'CLICK' }]).expect(202),
        sendEvents([{ token: third.deliveryToken, type: 'IMPRESSION' }]).expect(202),
        sendEvents([{ token: third.deliveryToken, type: 'CLICK' }]).expect(202),
      ]);
      expect((await statsOf(creativeId))[0]).toMatchObject({ impressions: 3, clicks: 3 });
      const receipts = await t.db
        .select()
        .from(adEventReceipts)
        .where(
          eq(adEventReceipts.deliveryId, tokens.verify(third.deliveryToken)?.deliveryId ?? ''),
        );
      expect(receipts.map((row) => row.kind).sort()).toEqual(['CLICK', 'IMPRESSION']);
    });

    it('descarta em silêncio token adulterado, de outra chave, vencido ou malformado', async () => {
      const { creativeId, campaignId, token } = await delivered();
      const [payload, signature] = token.split('.') as [string, string];
      const forgedPayload = Buffer.from(
        Buffer.from(payload, 'base64url')
          .toString('utf8')
          .replace(/"e":\d+/, '"e":9999999999'),
      ).toString('base64url');
      const otherKey = new DeliveryTokens('outra-chave-com-mais-de-32-caracteres!!').sign({
        creativeId,
        campaignId,
        placement: 'EXPLORE_HERO',
      }).token;
      const expired = tokens.sign(
        { creativeId, campaignId, placement: 'EXPLORE_HERO' },
        new Date(Date.now() - 3 * 60 * 60 * 1000),
      ).token;
      const res = await sendEvents([
        { token: `${forgedPayload}.${signature}`, type: 'IMPRESSION' },
        { token: otherKey, type: 'IMPRESSION' },
        { token: expired, type: 'CLICK' },
        { token: 'lixo', type: 'CLICK' },
      ]).expect(202);
      expect(res.body).toEqual({ accepted: 0 });
      expect(await statsOf(creativeId)).toEqual([]);
      // Tipo inválido ou lote grande demais é erro de validação.
      await sendEvents([{ token, type: 'VIEW' }]).expect(400);
      await sendEvents(Array(51).fill({ token, type: 'IMPRESSION' })).expect(400);
    });

    it('não grava usuário, aparelho nem IP (RN-ADS-03)', async () => {
      const { token } = await delivered();
      await t
        .http()
        .post('/v1/ads/events')
        .set('x-forwarded-for', '203.0.113.7')
        .set('user-agent', 'SpaceSports/1.0 (Android)')
        .send({ events: [{ token, type: 'CLICK' }] })
        .expect(202);
      const columns = await t.db.execute<{ table_name: string; column_name: string }>(sql`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN ('ad_event_receipts', 'ad_daily_stats')
      `);
      expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`).sort()).toEqual([
        'ad_daily_stats.campaign_id',
        'ad_daily_stats.clicks',
        'ad_daily_stats.created_at',
        'ad_daily_stats.creative_id',
        'ad_daily_stats.day',
        'ad_daily_stats.impressions',
        'ad_daily_stats.placement',
        'ad_daily_stats.updated_at',
        'ad_event_receipts.created_at',
        'ad_event_receipts.delivery_id',
        'ad_event_receipts.expires_at',
        'ad_event_receipts.kind',
      ]);
      const dump = JSON.stringify(await t.db.select().from(adEventReceipts));
      expect(dump).not.toContain('203.0.113.7');
    });

    it('soma no dia de America/Sao_Paulo (upsert), virando o dia às 03:00 UTC', async () => {
      const { creativeId, campaignId } = await delivered();
      const sign = (now: Date) =>
        tokens.sign({ creativeId, campaignId, placement: 'EXPLORE_HERO' }, now).token;
      // 02:30 UTC de 10/11 = 23:30 de 09/11 em São Paulo; 03:30 UTC = 00:30 de 10/11.
      const late = new Date('2026-11-10T02:30:00.000Z');
      const early = new Date('2026-11-10T03:30:00.000Z');
      const clicked = sign(late);
      await events.record(
        {
          events: [
            { token: sign(late), type: 'IMPRESSION' },
            { token: clicked, type: 'IMPRESSION' },
          ],
        },
        late,
      );
      await events.record({ events: [{ token: clicked, type: 'CLICK' }] }, late);
      await events.record({ events: [{ token: sign(early), type: 'IMPRESSION' }] }, early);
      const rows = await t.db
        .select({
          day: adDailyStats.day,
          impressions: adDailyStats.impressions,
          clicks: adDailyStats.clicks,
        })
        .from(adDailyStats)
        .where(eq(adDailyStats.creativeId, creativeId))
        .orderBy(adDailyStats.day);
      expect(rows).toEqual([
        { day: '2026-11-09', impressions: 2, clicks: 1 },
        { day: '2026-11-10', impressions: 1, clicks: 0 },
      ]);
    });

    it('o job diário apaga só os recibos vencidos', async () => {
      const { creativeId, campaignId } = await delivered();
      const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const oldToken = tokens.sign({ creativeId, campaignId, placement: 'EXPLORE_HERO' }, old);
      await events.record({ events: [{ token: oldToken.token, type: 'IMPRESSION' }] }, old);
      const fresh = tokens.sign({ creativeId, campaignId, placement: 'EXPLORE_HERO' });
      await events.record({ events: [{ token: fresh.token, type: 'IMPRESSION' }] });

      const result = await runAdsJob('purge-event-receipts', { events });
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      const remaining = await t.db.select().from(adEventReceipts);
      expect(remaining.some((row) => row.deliveryId === oldToken.claims.deliveryId)).toBe(false);
      expect(remaining.some((row) => row.deliveryId === fresh.claims.deliveryId)).toBe(true);
      expect(remaining.every((row) => row.expiresAt.getTime() >= Date.now())).toBe(true);
      // Os contadores ficam.
      expect((await statsOf(creativeId))[0]?.impressions).toBe(2);
    });
  });

  describe('relatório (RF-ADS-09)', () => {
    it('totais, série diária com dias zerados, por peça e CSV (auditado)', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Relatório' });
      const start = new Date(Date.parse('2026-10-01T03:00:00.000Z'));
      const { id } = await campaign(api, advertiserId, {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 5 * DAY_MS).toISOString(),
      });
      const a = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'Peça A' });
      const b = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'Peça B' });
      await t.db.insert(adDailyStats).values([
        {
          creativeId: a.id,
          campaignId: id,
          placement: 'EXPLORE_HERO',
          day: '2026-10-01',
          impressions: 200,
          clicks: 5,
        },
        {
          creativeId: b.id,
          campaignId: id,
          placement: 'EXPLORE_HERO',
          day: '2026-10-01',
          impressions: 100,
          clicks: 2,
        },
        {
          creativeId: a.id,
          campaignId: id,
          placement: 'EXPLORE_HERO',
          day: '2026-10-03',
          impressions: 50,
          clicks: 0,
        },
      ]);

      // Padrão: do início ao último dia da campanha (já encerrada).
      const report = await api.report(id).expect(200);
      expect(report.body).toMatchObject({
        campaignId: id,
        from: '2026-10-01',
        to: '2026-10-05',
        totals: { impressions: 350, clicks: 7, ctr: 0.02 },
      });
      expect(report.body.days).toEqual([
        { day: '2026-10-01', impressions: 300, clicks: 7, ctr: 0.0233 },
        { day: '2026-10-02', impressions: 0, clicks: 0, ctr: 0 },
        { day: '2026-10-03', impressions: 50, clicks: 0, ctr: 0 },
        { day: '2026-10-04', impressions: 0, clicks: 0, ctr: 0 },
        { day: '2026-10-05', impressions: 0, clicks: 0, ctr: 0 },
      ]);
      expect(report.body.creatives).toEqual([
        { creativeId: a.id, title: 'Peça A', impressions: 250, clicks: 5, ctr: 0.02 },
        { creativeId: b.id, title: 'Peça B', impressions: 100, clicks: 2, ctr: 0.02 },
      ]);

      const filtered = await api.report(id, { from: '2026-10-02', to: '2026-10-03' }).expect(200);
      expect(filtered.body.totals).toEqual({ impressions: 50, clicks: 0, ctr: 0 });
      expect(filtered.body.days).toHaveLength(2);
      await api.report(id, { from: '2026-10-03', to: '2026-10-02' }).expect(400);
      expect(
        (await api.report(id, { from: '2024-01-01', to: '2026-10-02' }).expect(422)).body.error
          .code,
      ).toBe('AD_REPORT_RANGE_TOO_LARGE');

      const csv = await api.reportCsv(id).expect(200);
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(csv.headers['content-disposition']).toBe(
        'attachment; filename="anuncio-2026-10-01_2026-10-05.csv"',
      );
      expect(csv.headers['cache-control']).toBe('no-store');
      expect(csv.text).toBe(
        [
          '﻿dia,impressoes,cliques,ctr_percentual',
          '01/10/2026,300,7,"2,33"',
          '02/10/2026,0,0,"0,00"',
          '03/10/2026,50,0,"0,00"',
          '04/10/2026,0,0,"0,00"',
          '05/10/2026,0,0,"0,00"',
          'total,350,7,"2,00"',
          '',
        ].join('\r\n'),
      );
      const exported = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.ad_campaign.export_csv'));
      expect(exported).toHaveLength(1);
      expect(exported[0]?.entityId).toBe(id);
    });

    it('campanha em andamento vai até hoje; os eventos entram no relatório', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Relatório Hoje' });
      const { id } = await campaign(api, advertiserId);
      await creative(api, storage, id, 'EXPLORE_HERO');
      const [item] = (await deliver({ placement: 'EXPLORE_HERO' }).expect(200)).body.items;
      await sendEvents([
        { token: item.deliveryToken, type: 'IMPRESSION' },
        { token: item.deliveryToken, type: 'CLICK' },
      ]).expect(202);
      const report = await api.report(id).expect(200);
      expect(report.body.days).toHaveLength(2);
      expect(report.body.totals).toEqual({ impressions: 1, clicks: 1, ctr: 1 });
      expect(report.body.days.at(-1)).toMatchObject({ impressions: 1, clicks: 1 });
    });
  });
});
