import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdCandidatesCache } from '../../src/ads/ad-candidates.cache.js';
import { AdCreativesService } from '../../src/ads/creatives.service.js';
import { AppException } from '../../src/common/app.exception.js';
import { adCampaigns, adCreatives, auditLogs } from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { expectPgError } from '../db/helpers.js';
import {
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  member,
  seedCatalog,
  setSpaceStatus,
} from '../spaces/fixtures.js';
import { bearer, NIL_UUID, type Row, superUser } from '../super/fixtures.js';
import {
  advertiser,
  campaign,
  creative,
  FEED_JPEG,
  HERO_JPEG,
  period,
  pngHeader,
  type SuperAds,
  superAds,
  uploadImage,
} from './fixtures.js';

// RF-ADS-01, 02, 03 e 09; RN-ADS-01, 02, 05 e 06: cadastro dos anúncios no /super.

describe('anúncios no /super', () => {
  let t: TestApp;
  let catalog: Catalog;
  let admin: SignedUp;
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
    admin = await superUser(t, 'super-ads@exemplo.com');
    api = superAds(t, admin);
  });
  afterAll(() => t.close());

  const audits = (action: string, entityId?: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, action), entityId ? eq(auditLogs.entityId, entityId) : undefined),
      );

  describe('permissões (RN-ADS-02)', () => {
    it('só o Super: jogador, Dono do espaço anunciante e anônimo não acessam nada', async () => {
      const space = await createSpace(t.db, catalog, { name: 'Arena Permissão' });
      const owner = await member(t, 'dono-ads@exemplo.com', space.id, 'OWNER');
      const player = await signUp(t, 'jogador-ads@exemplo.com');
      const spaceAdvertiser = await advertiser(api, {
        name: 'Arena Permissão',
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      const target = await campaign(api, spaceAdvertiser.id);

      const routes = [
        (r: ReturnType<TestApp['http']>) => r.get('/v1/super/ads/advertisers'),
        (r: ReturnType<TestApp['http']>) =>
          r.get(`/v1/super/ads/advertisers/${spaceAdvertiser.id}`),
        (r: ReturnType<TestApp['http']>) =>
          r.post('/v1/super/ads/advertisers').send({
            name: 'X',
            kind: 'COMPANY',
            category: 'OTHER',
          }),
        (r: ReturnType<TestApp['http']>) =>
          r.patch(`/v1/super/ads/advertisers/${spaceAdvertiser.id}`).send({ active: false }),
        (r: ReturnType<TestApp['http']>) => r.get('/v1/super/ads/campaigns'),
        (r: ReturnType<TestApp['http']>) => r.get(`/v1/super/ads/campaigns/${target.id}`),
        (r: ReturnType<TestApp['http']>) =>
          r.post(`/v1/super/ads/campaigns/${target.id}/status`).send({ status: 'PAUSED' }),
        (r: ReturnType<TestApp['http']>) =>
          r.post(`/v1/super/ads/campaigns/${target.id}/duplicate`),
        (r: ReturnType<TestApp['http']>) =>
          r
            .post('/v1/super/ads/creatives/uploads')
            .send({ placement: 'EXPLORE_HERO', contentType: 'image/jpeg' }),
        (r: ReturnType<TestApp['http']>) => r.get(`/v1/super/ads/campaigns/${target.id}/report`),
        (r: ReturnType<TestApp['http']>) =>
          r.get(`/v1/super/ads/campaigns/${target.id}/report.csv`),
      ];
      for (const route of routes) {
        for (const user of [owner, player]) {
          const res = await route(t.http()).set(...bearer(user));
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('SUPER_REQUIRED');
        }
        expect((await route(t.http())).status).toBe(401);
      }
      // Nada mudou.
      const detail = await api.getCampaign(target.id).expect(200);
      expect(detail.body.status).toBe('ACTIVE');
    });
  });

  describe('anunciantes (RF-ADS-01)', () => {
    it('cria, lista com busca e filtros, edita e audita', async () => {
      const res = await api
        .createAdvertiser({
          name: 'Pulso Teste',
          kind: 'COMPANY',
          category: 'SUPPLEMENTS',
          contactName: 'Maria',
          contactEmail: 'maria@example.com',
          contactPhone: '+5531999990000',
          notes: 'Contrato de 3 meses.',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Pulso Teste',
        kind: 'COMPANY',
        category: 'SUPPLEMENTS',
        space: null,
        active: true,
        campaignsCount: 0,
      });
      const id = res.body.id as string;

      const list = await api.listAdvertisers({ q: 'pulso', category: 'SUPPLEMENTS' }).expect(200);
      expect(list.body.items.map((row: Row) => row.id)).toEqual([id]);
      expect(list.body.total).toBe(1);
      expect(
        (await api.listAdvertisers({ kind: 'SPACE', q: 'pulso' }).expect(200)).body.items,
      ).toEqual([]);

      const updated = await api
        .updateAdvertiser(id, { name: 'Pulso Nutrição', notes: null })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'Pulso Nutrição', notes: null });
      expect(await audits('super.advertiser.create', id)).toHaveLength(1);
      const [update] = await audits('super.advertiser.update', id);
      expect(update?.diff).toMatchObject({
        before: { name: 'Pulso Teste', notes: 'Contrato de 3 meses.' },
        after: { name: 'Pulso Nutrição', notes: null },
      });
      expect(update?.actingAsSuper).toBe(true);
    });

    it('recusa bets e bebidas alcoólicas (RN-ADS-01), na criação e na edição', async () => {
      for (const category of ['BETTING', 'ALCOHOL', 'betting']) {
        const res = await api
          .createAdvertiser({ name: 'Proibida', kind: 'COMPANY', category })
          .expect(422);
        expect(res.body.error.code).toBe('AD_CATEGORY_FORBIDDEN');
      }
      const { id } = await advertiser(api, { name: 'Vai Mudar' });
      const res = await api.updateAdvertiser(id, { category: 'ALCOHOL' }).expect(422);
      expect(res.body.error.code).toBe('AD_CATEGORY_FORBIDDEN');
      // Categoria inexistente é erro de validação comum.
      const other = await api
        .createAdvertiser({ name: 'X', kind: 'COMPANY', category: 'TOBACCO' })
        .expect(400);
      expect(other.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('anunciante de espaço: espaço ativo e um anunciante ativo por espaço', async () => {
      const space = await createSpace(t.db, catalog, { name: 'Arena Anunciante' });
      const body = { name: 'Arena Anunciante', kind: 'SPACE', category: 'SPORTS_SPACE' };
      expect((await api.createAdvertiser({ ...body }).expect(400)).body.error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(
        (await api.createAdvertiser({ ...body, kind: 'COMPANY', spaceId: space.id }).expect(400))
          .body.error.code,
      ).toBe('VALIDATION_ERROR');
      expect(
        (await api.createAdvertiser({ ...body, spaceId: NIL_UUID }).expect(422)).body.error.code,
      ).toBe('AD_SPACE_NOT_FOUND');

      const first = await api.createAdvertiser({ ...body, spaceId: space.id }).expect(201);
      expect(first.body.space).toEqual({ id: space.id, name: space.name, slug: space.slug });
      expect(
        (await api.createAdvertiser({ ...body, spaceId: space.id }).expect(409)).body.error.code,
      ).toBe('ADVERTISER_SPACE_TAKEN');

      // Desativado, outro pode entrar; reativar o primeiro esbarra no segundo.
      await api.updateAdvertiser(first.body.id, { active: false }).expect(200);
      await api.createAdvertiser({ ...body, spaceId: space.id }).expect(201);
      expect(
        (await api.updateAdvertiser(first.body.id, { active: true }).expect(409)).body.error.code,
      ).toBe('ADVERTISER_SPACE_TAKEN');
      expect(await audits('super.advertiser.deactivate', first.body.id)).toHaveLength(1);

      const suspended = await createSpace(t.db, catalog, { status: 'SUSPENDED' });
      expect(
        (await api.createAdvertiser({ ...body, spaceId: suspended.id }).expect(422)).body.error
          .code,
      ).toBe('AD_SPACE_NOT_FOUND');
    });

    it('reativar anunciante de espaço exige o espaço ativo', async () => {
      const space = await createSpace(t.db, catalog, { name: 'Arena Reativa' });
      const { id } = await advertiser(api, {
        name: 'Arena Reativa',
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      await api.updateAdvertiser(id, { active: false }).expect(200);
      await setSpaceStatus(t.db, space.id, 'SUSPENDED');

      const res = await api.updateAdvertiser(id, { active: true }).expect(422);
      expect(res.body.error.code).toBe('AD_SPACE_NOT_FOUND');
      expect((await api.getAdvertiser(id).expect(200)).body.active).toBe(false);
      expect(await audits('super.advertiser.activate', id)).toHaveLength(0);
      // Editar os dados do inativo segue livre; com o espaço ativo de novo, reativa.
      await api.updateAdvertiser(id, { notes: 'Contrato renovado' }).expect(200);
      await setSpaceStatus(t.db, space.id, 'ACTIVE');
      expect((await api.updateAdvertiser(id, { active: true }).expect(200)).body.active).toBe(true);
      expect(await audits('super.advertiser.activate', id)).toHaveLength(1);
    });
  });

  describe('campanhas (RF-ADS-02)', () => {
    it('cria em DRAFT, valida segmentação e período, edita e muda status', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Campanhas Teste' });
      const base = { advertiserId, name: 'Verão', placement: 'EXPLORE_FEED', ...period() };
      const created = await api.createCampaign(base).expect(201);
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        weight: 5,
        cityIds: [],
        sportIds: [],
        creativesCount: 0,
        delivery: { onAir: false, reasons: ['NOT_ACTIVE', 'NO_CREATIVES'] },
        advertiser: { id: advertiserId, name: 'Campanhas Teste', active: true },
      });
      const id = created.body.id as string;

      expect(
        (await api.createCampaign({ ...base, advertiserId: NIL_UUID }).expect(404)).body.error.code,
      ).toBe('ADVERTISER_NOT_FOUND');
      expect(
        (await api.createCampaign({ ...base, cityIds: [NIL_UUID] }).expect(422)).body.error.code,
      ).toBe('AD_CITY_NOT_FOUND');
      expect(
        (await api.createCampaign({ ...base, sportIds: [NIL_UUID] }).expect(422)).body.error.code,
      ).toBe('AD_SPORT_NOT_FOUND');
      await api.createCampaign({ ...base, weight: 11 }).expect(400);
      await api.createCampaign({ ...base, endsAt: base.startsAt }).expect(400);

      const sport = catalog.sport('beach-tennis');
      const updated = await api
        .updateCampaign(id, { cityIds: [catalog.city.id], sportIds: [sport.id], weight: 8 })
        .expect(200);
      expect(updated.body).toMatchObject({
        cityIds: [catalog.city.id],
        sportIds: [sport.id],
        weight: 8,
      });
      // Fim antes do início guardado: recusado mesmo vindo só um dos dois.
      const res = await api
        .updateCampaign(id, { endsAt: new Date(Date.parse(base.startsAt) - 1000).toISOString() })
        .expect(422);
      expect(res.body.error.code).toBe('AD_INVALID_PERIOD');

      await api.status(id, 'ACTIVE').expect(200);
      await api.status(id, 'PAUSED').expect(200);
      await api.status(id, 'ACTIVE').expect(200);
      await api.status(id, 'ARCHIVED').expect(200);
      expect((await api.status(id, 'ACTIVE').expect(409)).body.error.code).toBe(
        'AD_INVALID_STATUS_TRANSITION',
      );
      expect((await audits('super.ad_campaign.status', id)).map((row) => row.diff)).toEqual([
        { before: 'DRAFT', after: 'ACTIVE' },
        { before: 'ACTIVE', after: 'PAUSED' },
        { before: 'PAUSED', after: 'ACTIVE' },
        { before: 'ACTIVE', after: 'ARCHIVED' },
      ]);
      expect(await audits('super.ad_campaign.create', id)).toHaveLength(1);
      expect(await audits('super.ad_campaign.update', id)).toHaveLength(1);
    });

    it('diz se está no ar e por quê não, e filtra por isso', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'No Ar Teste' });
      const live = await campaign(api, advertiserId, { name: 'No ar' });
      await creative(api, storage, live.id);
      const future = await campaign(api, advertiserId, { name: 'Futura', ...period(2, 10) });
      await creative(api, storage, future.id);
      const ended = await campaign(api, advertiserId, { name: 'Encerrada', ...period(-10, -1) });
      await creative(api, storage, ended.id);
      const empty = await campaign(api, advertiserId, { name: 'Sem peça' });
      const inactive = await campaign(api, advertiserId, { name: 'Peça inativa' });
      const off = await creative(api, storage, inactive.id);
      await api.updateCreative(inactive.id, off.id, { active: false }).expect(200);

      const reasons = async (id: string) =>
        (await api.getCampaign(id).expect(200)).body.delivery as {
          onAir: boolean;
          reasons: string[];
        };
      expect(await reasons(live.id)).toEqual({ onAir: true, reasons: [] });
      expect((await reasons(future.id)).reasons).toEqual(['NOT_STARTED']);
      expect((await reasons(ended.id)).reasons).toEqual(['ENDED']);
      expect((await reasons(empty.id)).reasons).toEqual(['NO_CREATIVES']);
      expect((await reasons(inactive.id)).reasons).toEqual(['NO_CREATIVES']);

      const onAir = await api.listCampaigns({ advertiserId, onAir: 'true' }).expect(200);
      expect(onAir.body.items.map((row: Row) => row.name)).toEqual(['No ar']);
      const offAir = await api.listCampaigns({ advertiserId, onAir: 'false' }).expect(200);
      expect(offAir.body.total).toBe(4);

      // Anunciante inativo tira do ar.
      await api.updateAdvertiser(advertiserId, { active: false }).expect(200);
      expect((await reasons(live.id)).reasons).toEqual(['ADVERTISER_INACTIVE']);
      await api.updateAdvertiser(advertiserId, { active: true }).expect(200);

      // Destino em espaço fora da vitrine não conta como peça entregável (RN-ADS-05).
      const space = await createSpace(t.db, catalog, { name: 'Arena Vitrine' });
      const toSpace = await campaign(api, advertiserId, { name: 'Destino espaço' });
      await creative(api, storage, toSpace.id, 'EXPLORE_HERO', {
        destination: { type: 'SPACE', spaceId: space.id },
      });
      expect((await reasons(toSpace.id)).onAir).toBe(true);
      await setSpaceStatus(t.db, space.id, 'SUSPENDED');
      expect((await reasons(toSpace.id)).reasons).toEqual(['NO_CREATIVES']);
      const detail = await api.getCampaign(toSpace.id).expect(200);
      expect(detail.body.creatives[0].destination.space).toMatchObject({
        id: space.id,
        showcaseVisible: false,
      });
    });

    it('peça sem imagem só conta como entregável com destino em espaço, como na entrega', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Sem Imagem Gravada' });
      const { id } = await campaign(api, advertiserId);
      // A API não grava peça assim (AD_IMAGE_REQUIRED): simula um dado inserido à mão.
      await t.db.insert(adCreatives).values({
        campaignId: id,
        imageUrl: null,
        title: 'Sem imagem',
        ctaLabel: 'Ver',
        destinationType: 'URL',
        destinationUrl: 'https://example.com/sem-imagem',
      });

      const detail = await api.getCampaign(id).expect(200);
      expect(detail.body.activeCreativesCount).toBe(1);
      expect(detail.body.delivery).toEqual({ onAir: false, reasons: ['NO_CREATIVES'] });
      const onAir = await api.listCampaigns({ advertiserId, onAir: 'true' }).expect(200);
      expect(onAir.body.total).toBe(0);
      t.app.get(AdCandidatesCache).clear();
      const delivered = await t.http().get('/v1/ads').query({ placement: 'EXPLORE_HERO' });
      expect(delivered.body.items.some((item: Row) => item.campaignId === id)).toBe(false);

      // Com imagem, a mesma campanha vai ao ar.
      await creative(api, storage, id);
      expect((await api.getCampaign(id).expect(200)).body.delivery.onAir).toBe(true);
    });

    it('filtra por anunciante, vaga, status e busca', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Filtros Teste' });
      await campaign(api, advertiserId, { name: 'Topo ativa' });
      await campaign(api, advertiserId, {
        name: 'Lista rascunho',
        placement: 'EXPLORE_FEED',
        status: 'DRAFT',
      });
      const names = async (query: Record<string, string>) =>
        (await api.listCampaigns({ advertiserId, ...query }).expect(200)).body.items
          .map((row: Row) => row.name)
          .sort();
      expect(await names({})).toEqual(['Lista rascunho', 'Topo ativa']);
      expect(await names({ placement: 'EXPLORE_FEED' })).toEqual(['Lista rascunho']);
      expect(await names({ status: 'ACTIVE' })).toEqual(['Topo ativa']);
      expect(await names({ q: 'topo' })).toEqual(['Topo ativa']);
      expect((await api.listCampaigns({ q: 'Filtros Teste' }).expect(200)).body.total).toBe(2);
    });

    it('vaga só muda sem peças', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Vaga Teste' });
      const { id } = await campaign(api, advertiserId);
      await api.updateCampaign(id, { placement: 'EXPLORE_FEED' }).expect(200);
      await creative(api, storage, id, 'EXPLORE_FEED');
      expect(
        (await api.updateCampaign(id, { placement: 'EXPLORE_HERO' }).expect(409)).body.error.code,
      ).toBe('AD_PLACEMENT_LOCKED');
    });

    it('duplica em DRAFT, com cópias das peças e das imagens', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Duplicar Teste' });
      const source = await campaign(api, advertiserId, {
        name: 'Original',
        cityIds: [catalog.city.id],
        weight: 7,
      });
      const first = await creative(api, storage, source.id, 'EXPLORE_HERO', { title: 'Primeira' });
      await creative(api, storage, source.id, 'EXPLORE_HERO', { title: 'Segunda' });
      const sourceDetail = await api.getCampaign(source.id).expect(200);

      const copy = await api.duplicate(source.id).expect(201);
      expect(copy.body).toMatchObject({
        name: 'Original (cópia)',
        status: 'DRAFT',
        weight: 7,
        cityIds: [catalog.city.id],
        creativesCount: 2,
      });
      expect(copy.body.creatives.map((row: Row) => row.title)).toEqual(['Primeira', 'Segunda']);
      for (const [index, row] of (copy.body.creatives as Row[]).entries()) {
        const original = sourceDetail.body.creatives[index];
        expect(row.imageUrl).toMatch(new RegExp(`^https://fotos\\.test/ads/${copy.body.id}/`));
        expect(row.imageUrl).not.toBe(original.imageUrl);
        expect(storage.objects.has(storage.keyFromUrl(row.imageUrl as string) ?? '')).toBe(true);
      }
      expect(await audits('super.ad_campaign.duplicate', copy.body.id)).toHaveLength(1);
      // A original segue intacta.
      expect((await api.getCampaign(source.id).expect(200)).body.creatives[0].id).toBe(first.id);
    });
  });

  describe('peças (RF-ADS-03)', () => {
    let campaignId: string;
    let feedCampaignId: string;

    beforeAll(async () => {
      const { id } = await advertiser(api, { name: 'Peças Teste' });
      campaignId = (await campaign(api, id)).id;
      feedCampaignId = (await campaign(api, id, { placement: 'EXPLORE_FEED' })).id;
    });

    it('URL pré-assinada em uploads/ads/<vaga>/ com o formato da vaga', async () => {
      const res = await api
        .presign({ placement: 'EXPLORE_FEED', contentType: 'image/webp', size: 1000 })
        .expect(201);
      expect(res.body).toMatchObject({
        method: 'PUT',
        key: expect.stringMatching(/^uploads\/ads\/explore-feed\/[0-9a-f-]{36}\.webp$/),
        format: { aspectWidth: 4, aspectHeight: 5, minWidth: 480, minHeight: 600 },
      });
      await api
        .presign({ placement: 'EXPLORE_FEED', contentType: 'image/jpeg', size: 3 * 1024 * 1024 })
        .expect(400);
    });

    it('publica a imagem em ads/<campaignId>/, apaga o upload e audita', async () => {
      const key = await uploadImage(api, storage, 'EXPLORE_HERO');
      const res = await api
        .createCreative(campaignId, {
          imageKey: key,
          title: 'Raquetes em oferta',
          body: '',
          ctaLabel: 'Ver ofertas',
          destination: { type: 'WHATSAPP', phone: '+5531900000090', message: 'Oi!' },
        })
        .expect(201);
      const uploadUuid = key
        .split('/')
        .at(-1)
        ?.replace(/\.jpg$/, '');
      expect(res.body).toMatchObject({
        campaignId,
        title: 'Raquetes em oferta',
        body: null,
        active: true,
        position: 0,
        destination: { type: 'WHATSAPP', phone: '+5531900000090', message: 'Oi!' },
        imageUrl: expect.stringMatching(
          new RegExp(`^https://fotos\\.test/ads/${campaignId}/${uploadUuid}-[0-9a-f-]{36}\\.jpg$`),
        ),
      });
      expect(storage.objects.has(key)).toBe(false);
      expect(await audits('super.ad_creative.create', res.body.id)).toHaveLength(1);
    });

    it('confere a imagem pela vaga: proporção, tamanho mínimo, peso e tipo', async () => {
      const attempt = async (
        placement: 'EXPLORE_HERO' | 'EXPLORE_FEED',
        body: Uint8Array,
        contentType = 'image/png',
      ) => {
        const key = await uploadImage(api, storage, placement, body, contentType);
        const target = placement === 'EXPLORE_HERO' ? campaignId : feedCampaignId;
        const res = await api.createCreative(target, {
          imageKey: key,
          title: 'Teste',
          ctaLabel: 'Ver',
          destination: { type: 'URL', url: 'https://example.com' },
        });
        return { status: res.status, code: res.body.error?.code, details: res.body.error?.details };
      };

      // Imagem do card no carrossel e vice-versa: proporção errada.
      expect(await attempt('EXPLORE_HERO', FEED_JPEG, 'image/jpeg')).toMatchObject({
        status: 422,
        code: 'AD_IMAGE_WRONG_ASPECT',
        details: { width: 512, height: 640 },
      });
      expect(await attempt('EXPLORE_FEED', HERO_JPEG, 'image/jpeg')).toMatchObject({
        code: 'AD_IMAGE_WRONG_ASPECT',
      });
      // 2:1 pequeno e 4:5 pequeno.
      expect(await attempt('EXPLORE_HERO', pngHeader(800, 400))).toMatchObject({
        code: 'AD_IMAGE_TOO_SMALL',
      });
      expect(await attempt('EXPLORE_FEED', pngHeader(400, 500))).toMatchObject({
        code: 'AD_IMAGE_TOO_SMALL',
      });
      // Dentro da tolerância de 2%.
      expect((await attempt('EXPLORE_HERO', pngHeader(1000, 495))).status).toBe(201);
      expect((await attempt('EXPLORE_FEED', pngHeader(511, 639))).status).toBe(201);
      // Fora da tolerância.
      expect(await attempt('EXPLORE_HERO', pngHeader(1000, 480))).toMatchObject({
        code: 'AD_IMAGE_WRONG_ASPECT',
      });
      // Bytes que não são imagem.
      expect(await attempt('EXPLORE_HERO', new Uint8Array(64).fill(7))).toMatchObject({
        code: 'AD_IMAGE_INVALID',
      });

      // Mais de 2 MB (o HEAD acusa antes de ler).
      const big = await api.presign({ placement: 'EXPLORE_HERO', contentType: 'image/jpeg' });
      storage.upload(big.body.key, 2 * 1024 * 1024 + 1);
      const tooLarge = await api.createCreative(campaignId, {
        imageKey: big.body.key,
        title: 'Grande',
        ctaLabel: 'Ver',
        destination: { type: 'URL', url: 'https://example.com' },
      });
      expect(tooLarge.body.error.code).toBe('AD_IMAGE_TOO_LARGE');

      // Upload de outra vaga ou de outro fluxo: chave inválida; sem envio: não enviado.
      const feedKey = (await api.presign({ placement: 'EXPLORE_FEED', contentType: 'image/jpeg' }))
        .body.key;
      const wrongKey = await api.createCreative(campaignId, {
        imageKey: feedKey,
        title: 'X',
        ctaLabel: 'Ver',
        destination: { type: 'URL', url: 'https://example.com' },
      });
      expect(wrongKey.body.error.code).toBe('AD_IMAGE_KEY_INVALID');
      const missing = await api.createCreative(feedCampaignId, {
        imageKey: feedKey,
        title: 'X',
        ctaLabel: 'Ver',
        destination: { type: 'URL', url: 'https://example.com' },
      });
      expect(missing.body.error.code).toBe('AD_IMAGE_NOT_UPLOADED');
      // Nenhuma cópia inválida ficou publicada.
      const published = [...storage.objects.keys()].filter((key) =>
        key.startsWith(`ads/${campaignId}/`),
      );
      const recorded = (await api.getCampaign(campaignId).expect(200)).body.creatives.map(
        (row: Row) => storage.keyFromUrl(row.imageUrl as string),
      );
      expect(published.sort()).toEqual(recorded.sort());
    });

    it('limites de texto e destino coerente (só https; WhatsApp E.164; espaço ativo)', async () => {
      const key = await uploadImage(api, storage, 'EXPLORE_HERO');
      const body = {
        imageKey: key,
        title: 'Título',
        ctaLabel: 'Ver',
        destination: { type: 'URL', url: 'https://example.com' },
      };
      await api.createCreative(campaignId, { ...body, title: 'x'.repeat(41) }).expect(400);
      await api.createCreative(campaignId, { ...body, body: 'x'.repeat(91) }).expect(400);
      await api.createCreative(campaignId, { ...body, ctaLabel: 'x'.repeat(21) }).expect(400);
      // Só `https://` minúsculo e sem espaço, como o check do banco (senão viraria 500).
      for (const url of [
        'http://example.com',
        'HTTPS://example.com',
        'Https://example.com',
        'https:/example.com',
        'https:example.com',
        'https://exa mple.com',
        'https://example.com/a b',
      ]) {
        const res = await api
          .createCreative(campaignId, { ...body, destination: { type: 'URL', url } })
          .expect(400);
        expect(res.body.error.code, url).toBe('VALIDATION_ERROR');
      }
      await api
        .createCreative(campaignId, {
          ...body,
          destination: { type: 'WHATSAPP', phone: '(31) 99999-0000', message: 'Oi' },
        })
        .expect(400);
      const suspended = await createSpace(t.db, catalog, { status: 'SUSPENDED' });
      const res = await api
        .createCreative(campaignId, {
          ...body,
          destination: { type: 'SPACE', spaceId: suspended.id },
        })
        .expect(422);
      expect(res.body.error.code).toBe('AD_DESTINATION_SPACE_NOT_FOUND');
    });

    it('sem imagem só peça de anunciante espaço com destino no espaço', async () => {
      const company = await api
        .createCreative(campaignId, {
          title: 'Sem imagem',
          ctaLabel: 'Ver',
          destination: { type: 'URL', url: 'https://example.com' },
        })
        .expect(422);
      expect(company.body.error.code).toBe('AD_IMAGE_REQUIRED');

      const space = await createSpace(t.db, catalog, { name: 'Arena Sem Imagem' });
      const spaceAdvertiser = await advertiser(api, {
        name: 'Arena Sem Imagem',
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      const own = await campaign(api, spaceAdvertiser.id);
      await api
        .createCreative(own.id, {
          title: 'Sem imagem',
          ctaLabel: 'Ver',
          destination: { type: 'URL', url: 'https://example.com' },
        })
        .expect(422);
      const res = await api
        .createCreative(own.id, {
          title: 'Arena Sem Imagem',
          ctaLabel: 'Ver espaço',
          destination: { type: 'SPACE', spaceId: space.id },
        })
        .expect(201);
      expect(res.body).toMatchObject({
        imageUrl: null,
        destination: {
          type: 'SPACE',
          space: { id: space.id, slug: space.slug, showcaseVisible: true },
        },
      });
      // Trocar o destino para URL sem imagem: recusado.
      expect(
        (
          await api
            .updateCreative(own.id, res.body.id, {
              destination: { type: 'URL', url: 'https://example.com' },
            })
            .expect(422)
        ).body.error.code,
      ).toBe('AD_IMAGE_REQUIRED');

      // Sem imagem, só o próprio espaço: a peça de um espaço não vira o card de outro.
      const other = await createSpace(t.db, catalog, { name: 'Arena Vizinha' });
      expect(
        (
          await api
            .createCreative(own.id, {
              title: 'Arena Vizinha',
              ctaLabel: 'Ver espaço',
              destination: { type: 'SPACE', spaceId: other.id },
            })
            .expect(422)
        ).body.error.code,
      ).toBe('AD_IMAGE_REQUIRED');
      expect(
        (
          await api
            .updateCreative(own.id, res.body.id, {
              destination: { type: 'SPACE', spaceId: other.id },
            })
            .expect(422)
        ).body.error.code,
      ).toBe('AD_IMAGE_REQUIRED');
      // Com imagem, o destino pode ser outro espaço.
      await api
        .createCreative(own.id, {
          imageKey: await uploadImage(api, storage, 'EXPLORE_HERO'),
          title: 'Arena Vizinha',
          ctaLabel: 'Ver espaço',
          destination: { type: 'SPACE', spaceId: other.id },
        })
        .expect(201);
    });

    it('a vaga mudou entre a conferência da imagem e a gravação: 409, sem peça nem arquivo', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Corrida Vaga' });
      const { id } = await campaign(api, advertiserId);
      const published = () =>
        [...storage.objects.keys()].filter((key) => key.startsWith(`ads/${id}/`));

      // Criação: outra edição troca a vaga (a campanha ainda não tem peça) logo depois da cópia.
      const key = await uploadImage(api, storage, 'EXPLORE_HERO');
      storage.afterCopy = async () => {
        await api.updateCampaign(id, { placement: 'EXPLORE_FEED' }).expect(200);
      };
      const res = await api
        .createCreative(id, {
          imageKey: key,
          title: 'Banner',
          ctaLabel: 'Ver',
          destination: { type: 'URL', url: 'https://example.com' },
        })
        .expect(409);
      expect(res.body.error.code).toBe('AD_PLACEMENT_CHANGED');
      expect((await api.getCampaign(id).expect(200)).body.creativesCount).toBe(0);
      expect(published()).toEqual([]);

      // Edição: com a vaga trocada por fora (dado inconsistente), a imagem nova também é recusada.
      const { id: creativeId } = await creative(api, storage, id, 'EXPLORE_FEED');
      const [before] = published();
      const next = await uploadImage(api, storage, 'EXPLORE_FEED');
      storage.afterCopy = async () => {
        await t.db
          .update(adCampaigns)
          .set({ placement: 'EXPLORE_HERO' })
          .where(eq(adCampaigns.id, id));
      };
      const edit = await api.updateCreative(id, creativeId, { imageKey: next }).expect(409);
      expect(edit.body.error.code).toBe('AD_PLACEMENT_CHANGED');
      expect(published()).toEqual([before]);
    });

    it('check do banco que escapar da validação vira 422, sem arquivo sobrando', async () => {
      const service = t.app.get(AdCreativesService);
      const { id: advertiserId } = await advertiser(api, { name: 'Check Escapou' });
      const { id } = await campaign(api, advertiserId);
      // Chamada direta ao serviço, sem o Zod: a URL só é barrada pelo check do banco.
      const err = await service
        .create(admin.id, id, {
          imageKey: await uploadImage(api, storage, 'EXPLORE_HERO'),
          title: 'Banner',
          ctaLabel: 'Ver',
          destination: { type: 'URL', url: 'HTTPS://example.com' },
          active: true,
        })
        .catch((error: unknown) => error);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('AD_CREATIVE_INVALID');
      expect((err as AppException).getStatus()).toBe(422);
      expect([...storage.objects.keys()].some((key) => key.startsWith(`ads/${id}/`))).toBe(false);
    });

    it('trocar a imagem apaga a anterior; repetir a chave não muda; tirar só se pode', async () => {
      const { id } = await creative(api, storage, campaignId);
      const before = (await api.getCampaign(campaignId).expect(200)).body.creatives.find(
        (row: Row) => row.id === id,
      ).imageUrl as string;
      const previousKey = storage.keyFromUrl(before) as string;
      expect(storage.objects.has(previousKey)).toBe(true);

      const key = await uploadImage(api, storage, 'EXPLORE_HERO');
      const replaced = await api.updateCreative(campaignId, id, { imageKey: key }).expect(200);
      expect(replaced.body.imageUrl).not.toBe(before);
      expect(storage.objects.has(previousKey)).toBe(false);
      expect(storage.deleted).toContain(previousKey);

      // Mesma chave de novo (ex.: reenvio do formulário): nada muda.
      const again = await api.updateCreative(campaignId, id, { imageKey: key }).expect(200);
      expect(again.body.imageUrl).toBe(replaced.body.imageUrl);

      expect(
        (await api.updateCreative(campaignId, id, { imageKey: null }).expect(422)).body.error.code,
      ).toBe('AD_IMAGE_REQUIRED');

      const [update] = await audits('super.ad_creative.update', id);
      expect(update?.diff).toMatchObject({
        before: { imageUrl: before },
        after: { imageUrl: replaced.body.imageUrl },
      });
    });

    it('desativa, reativa e ordena as peças (auditado)', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Ordem Teste' });
      const { id } = await campaign(api, advertiserId);
      const a = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'A' });
      const b = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'B' });
      const c = await creative(api, storage, id, 'EXPLORE_HERO', { title: 'C' });

      const order = await api.reorder(id, [c.id, a.id, b.id]).expect(200);
      expect(order.body.items.map((row: Row) => [row.title, row.position])).toEqual([
        ['C', 0],
        ['A', 1],
        ['B', 2],
      ]);
      expect((await api.reorder(id, [a.id, b.id]).expect(422)).body.error.code).toBe(
        'AD_INVALID_CREATIVE_ORDER',
      );
      expect((await api.reorder(id, [a.id, a.id, b.id]).expect(422)).body.error.code).toBe(
        'AD_INVALID_CREATIVE_ORDER',
      );
      expect(await audits('super.ad_creative.reorder', id)).toHaveLength(1);

      const off = await api.updateCreative(id, b.id, { active: false }).expect(200);
      expect(off.body.active).toBe(false);
      expect(await audits('super.ad_creative.deactivate', b.id)).toHaveLength(1);
      await api.updateCreative(id, b.id, { active: true }).expect(200);
      expect(await audits('super.ad_creative.activate', b.id)).toHaveLength(1);

      // Peça de outra campanha: não encontrada.
      expect(
        (await api.updateCreative(campaignId, a.id, { title: 'X' }).expect(404)).body.error.code,
      ).toBe('AD_CREATIVE_NOT_FOUND');
    });

    it('sem storage: URL de upload e imagem respondem 503', async () => {
      storage.enabled = false;
      try {
        expect(
          (await api.presign({ placement: 'EXPLORE_HERO', contentType: 'image/jpeg' }).expect(503))
            .body.error.code,
        ).toBe('STORAGE_UNAVAILABLE');
        await api
          .createCreative(campaignId, {
            imageKey: 'uploads/ads/explore-hero/0190d1a4-0000-7000-8000-000000000001.jpg',
            title: 'X',
            ctaLabel: 'Ver',
            destination: { type: 'URL', url: 'https://example.com' },
          })
          .expect(503);
      } finally {
        storage.enabled = true;
      }
    });
  });

  describe('restrições do banco', () => {
    it('checks de período, peso, anunciante de espaço e destino', async () => {
      const { id: advertiserId } = await advertiser(api, { name: 'Checks Teste' });
      const { id: campaignId } = await campaign(api, advertiserId);
      const insertCampaign = (values: Record<string, unknown>) =>
        t.db.execute(
          sql.raw(`INSERT INTO ad_campaigns (advertiser_id, name, placement, starts_at, ends_at, weight)
           VALUES ('${advertiserId}', 'x', 'EXPLORE_HERO', ${values.startsAt ?? 'now()'}, ${values.endsAt ?? "now() + interval '1 day'"}, ${values.weight ?? 5})`),
        );
      expect(
        (await expectPgError(insertCampaign({ endsAt: 'now()', startsAt: 'now()' }))).constraint,
      ).toBe('ad_campaigns_period_valid');
      expect((await expectPgError(insertCampaign({ weight: 0 }))).constraint).toBe(
        'ad_campaigns_weight_range',
      );
      expect(
        (
          await expectPgError(
            t.db.execute(
              sql.raw(
                `INSERT INTO advertisers (name, kind, category) VALUES ('x', 'SPACE', 'OTHER')`,
              ),
            ),
          )
        ).constraint,
      ).toBe('advertisers_space_kind');
      expect(
        (
          await expectPgError(
            t.db.execute(
              sql.raw(
                `INSERT INTO advertisers (name, kind, category) VALUES ('x', 'COMPANY', 'BETTING')`,
              ),
            ),
          )
        ).code,
      ).toBe('22P02');
      const insertCreative = (destination: string) =>
        t.db.execute(
          sql.raw(`INSERT INTO ad_creatives (campaign_id, title, cta_label, destination_type, destination_url, whatsapp_phone, whatsapp_message, destination_space_id)
           VALUES ('${campaignId}', 't', 'c', ${destination})`),
        );
      for (const destination of [
        `'URL', 'http://example.com', NULL, NULL, NULL`,
        `'URL', 'https://example.com', '+5531999990000', NULL, NULL`,
        `'WHATSAPP', NULL, '31999990000', 'Oi', NULL`,
        `'WHATSAPP', NULL, '+5531999990000', NULL, NULL`,
        `'SPACE', NULL, NULL, NULL, NULL`,
      ]) {
        expect((await expectPgError(insertCreative(destination))).constraint).toBe(
          'ad_creatives_destination_valid',
        );
      }
      await insertCreative(`'URL', 'https://example.com/ok', NULL, NULL, NULL`);
    });
  });
});
