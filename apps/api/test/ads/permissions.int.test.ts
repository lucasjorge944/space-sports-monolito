import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adCampaigns, adCreatives, advertisers, auditLogs } from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  member,
  seedCatalog,
} from '../spaces/fixtures.js';
import { bearer, NIL_UUID, superUser } from '../super/fixtures.js';
import { advertiser, campaign, creative, type SuperAds, superAds } from './fixtures.js';

// QA (AD.5): RN-ADS-02 (só o Super lê e escreve anúncios, nem o espaço anunciante) e RN-ADS-01
// (bets e bebidas alcoólicas não existem no cadastro). Complementa super-ads.int.test.ts: aqui a
// matriz cobre TODAS as rotas de /v1/super/ads (inclusive as das peças e o PATCH da campanha) e
// todos os papéis (Dono, Admin, Professor, jogador, anônimo), e confere que nada mudou no banco.

type Req = ReturnType<TestApp['http']>;
type Route = { name: string; call: (r: Req) => ReturnType<Req['get']> };

describe('anúncios: matriz de permissões e categorias proibidas (QA)', () => {
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
    admin = await superUser(t, 'super-qa-perm@exemplo.com');
    api = superAds(t, admin);
  });
  afterAll(() => t.close());

  const counts = async () => ({
    advertisers: await t.db.$count(advertisers),
    campaigns: await t.db.$count(adCampaigns),
    creatives: await t.db.$count(adCreatives),
    audits: await t.db.$count(auditLogs),
    activeCreatives: await t.db.$count(adCreatives, eq(adCreatives.active, true)),
  });

  describe('RN-ADS-02', () => {
    it('as 18 rotas de /v1/super/ads só respondem ao Super (Dono, Admin, Professor, jogador e anônimo não)', async () => {
      const space = await createSpace(t.db, catalog, { name: 'Arena Matriz' });
      const otherSpace = await createSpace(t.db, catalog, { name: 'Arena Outra Matriz' });
      const players = {
        owner: await member(t, 'qa-dono@exemplo.com', space.id, 'OWNER'),
        admin: await member(t, 'qa-admin@exemplo.com', space.id, 'ADMIN'),
        teacher: await member(t, 'qa-prof@exemplo.com', space.id, 'TEACHER'),
        // Dono de OUTRO espaço: nem o anunciante de outro espaço, nem o próprio, enxerga.
        otherOwner: await member(t, 'qa-dono-outro@exemplo.com', otherSpace.id, 'OWNER'),
        player: await signUp(t, 'qa-jogador@exemplo.com'),
      };
      const spaceAdvertiser = await advertiser(api, {
        name: 'Arena Matriz',
        kind: 'SPACE',
        spaceId: space.id,
        category: 'SPORTS_SPACE',
      });
      const target = await campaign(api, spaceAdvertiser.id);
      const piece = await creative(api, storage, target.id, 'EXPLORE_HERO');
      const second = await creative(api, storage, target.id, 'EXPLORE_HERO', { title: 'Segunda' });
      const key = 'uploads/ads/EXPLORE_HERO/qualquer.jpg';

      const routes: Route[] = [
        { name: 'GET advertisers', call: (r) => r.get('/v1/super/ads/advertisers') },
        {
          name: 'GET advertisers/:id',
          call: (r) => r.get(`/v1/super/ads/advertisers/${spaceAdvertiser.id}`),
        },
        {
          name: 'POST advertisers',
          call: (r) =>
            r
              .post('/v1/super/ads/advertisers')
              .send({ name: 'Intruso', kind: 'COMPANY', category: 'OTHER' }),
        },
        {
          name: 'PATCH advertisers/:id',
          call: (r) =>
            r.patch(`/v1/super/ads/advertisers/${spaceAdvertiser.id}`).send({ active: false }),
        },
        { name: 'GET campaigns', call: (r) => r.get('/v1/super/ads/campaigns') },
        { name: 'GET campaigns/:id', call: (r) => r.get(`/v1/super/ads/campaigns/${target.id}`) },
        {
          name: 'POST campaigns',
          call: (r) =>
            r.post('/v1/super/ads/campaigns').send({
              advertiserId: spaceAdvertiser.id,
              name: 'Intrusa',
              placement: 'EXPLORE_HERO',
              startsAt: new Date().toISOString(),
              endsAt: new Date(Date.now() + 86_400_000).toISOString(),
            }),
        },
        {
          name: 'PATCH campaigns/:id',
          call: (r) => r.patch(`/v1/super/ads/campaigns/${target.id}`).send({ weight: 10 }),
        },
        {
          name: 'POST campaigns/:id/status',
          call: (r) =>
            r.post(`/v1/super/ads/campaigns/${target.id}/status`).send({ status: 'PAUSED' }),
        },
        {
          name: 'POST campaigns/:id/duplicate',
          call: (r) => r.post(`/v1/super/ads/campaigns/${target.id}/duplicate`),
        },
        {
          name: 'POST creatives/uploads',
          call: (r) =>
            r
              .post('/v1/super/ads/creatives/uploads')
              .send({ placement: 'EXPLORE_HERO', contentType: 'image/jpeg' }),
        },
        {
          name: 'POST campaigns/:id/creatives',
          call: (r) =>
            r.post(`/v1/super/ads/campaigns/${target.id}/creatives`).send({
              imageKey: key,
              title: 'Intrusa',
              body: 'Texto',
              ctaLabel: 'Ver',
              destination: { type: 'URL', url: 'https://example.com/x' },
            }),
        },
        {
          name: 'PATCH campaigns/:id/creatives/:id',
          call: (r) =>
            r
              .patch(`/v1/super/ads/campaigns/${target.id}/creatives/${piece.id}`)
              .send({ active: false, title: 'Trocada' }),
        },
        {
          name: 'PUT campaigns/:id/creatives/order',
          call: (r) =>
            r
              .put(`/v1/super/ads/campaigns/${target.id}/creatives/order`)
              .send({ creativeIds: [second.id, piece.id] }),
        },
        { name: 'GET report', call: (r) => r.get(`/v1/super/ads/campaigns/${target.id}/report`) },
        {
          name: 'GET report.csv',
          call: (r) => r.get(`/v1/super/ads/campaigns/${target.id}/report.csv`),
        },
        // Ids que não existem: o papel errado leva 403/401 antes do 404 (não vaza existência).
        {
          name: 'GET advertisers/:id (inexistente)',
          call: (r) => r.get(`/v1/super/ads/advertisers/${NIL_UUID}`),
        },
        {
          name: 'GET report (inexistente)',
          call: (r) => r.get(`/v1/super/ads/campaigns/${NIL_UUID}/report`),
        },
      ];
      expect(routes.length).toBe(18);

      const before = await counts();
      const detailBefore = (await api.getCampaign(target.id).expect(200)).body;

      for (const route of routes) {
        for (const [role, user] of Object.entries(players)) {
          const res = await route.call(t.http()).set(...bearer(user));
          expect(res.status, `${route.name} como ${role}`).toBe(403);
          expect(res.body.error.code, `${route.name} como ${role}`).toBe('SUPER_REQUIRED');
        }
        const anon = await route.call(t.http());
        expect(anon.status, `${route.name} anônimo`).toBe(401);
        // Cookie/Bearer inválido também é 401.
        const bogus = await route.call(t.http()).set('authorization', 'Bearer token-invalido');
        expect(bogus.status, `${route.name} token inválido`).toBe(401);
      }

      // Nada mudou, nem na auditoria.
      expect(await counts()).toEqual(before);
      expect((await api.getCampaign(target.id).expect(200)).body).toEqual(detailBefore);

      // Controle positivo: o Super passa pela guarda em todas as rotas (nenhuma responde 401/403).
      const asSuper = [...routes].filter((route) => !route.name.includes('inexistente'));
      for (const route of asSuper) {
        const res = await route.call(t.http()).set(...bearer(admin));
        expect([401, 403], `${route.name} como Super`).not.toContain(res.status);
      }
    });
  });

  describe('RN-ADS-01 (categorias proibidas)', () => {
    it('BETTING e ALCOHOL não existem no enum do banco', async () => {
      const labels = await t.db.execute<{ label: string }>(
        sql`SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid WHERE ty.typname = 'ad_category'`,
      );
      const set = labels.rows.map((row) => row.label);
      expect(set).not.toContain('BETTING');
      expect(set).not.toContain('ALCOHOL');
      expect(set).toContain('SUPPLEMENTS');
      // Direto no banco também não entra.
      await expect(
        t.db.execute(
          sql`INSERT INTO advertisers (name, kind, category) VALUES ('X', 'COMPANY', 'BETTING')`,
        ),
      ).rejects.toThrow();
    });

    it('recusa variações de grafia na criação e na edição, sem gravar nada', async () => {
      const { id } = await advertiser(api, { name: 'Edição Proibida' });
      const before = await counts();
      for (const category of ['BETTING', 'ALCOHOL', 'betting', 'Alcohol', 'bEtTiNg']) {
        const created = await api
          .createAdvertiser({ name: `Proibida ${category}`, kind: 'COMPANY', category })
          .expect(422);
        expect(created.body.error.code, category).toBe('AD_CATEGORY_FORBIDDEN');
        const updated = await api.updateAdvertiser(id, { category }).expect(422);
        expect(updated.body.error.code, category).toBe('AD_CATEGORY_FORBIDDEN');
      }
      // Outros valores fora do catálogo: 400 de validação; nenhum vira categoria válida.
      for (const category of ['TOBACCO', '', ' BETTING', 'BETTING ', 'SUPPLEMENTS,BETTING']) {
        const res = await api.createAdvertiser({ name: 'Fora', kind: 'COMPANY', category });
        expect([400, 422], `categoria "${category}"`).toContain(res.status);
      }
      expect(await counts()).toEqual(before);
      const [row] = await t.db.select().from(advertisers).where(eq(advertisers.id, id));
      expect(row?.category).toBe('SPORTING_GOODS');
    });

    it('anunciante de espaço também não pode ser de categoria proibida', async () => {
      const space = await createSpace(t.db, catalog, { name: 'Arena Categoria' });
      const res = await api
        .createAdvertiser({
          name: 'Arena Categoria',
          kind: 'SPACE',
          spaceId: space.id,
          category: 'ALCOHOL',
        })
        .expect(422);
      expect(res.body.error.code).toBe('AD_CATEGORY_FORBIDDEN');
    });

    it('o filtro da lista por categoria proibida não devolve anunciante algum', async () => {
      await advertiser(api, { name: 'Suplemento Permitido', category: 'SUPPLEMENTS' });
      const permitted = await api.listAdvertisers({ category: 'SUPPLEMENTS' }).expect(200);
      expect(permitted.body.items.length).toBeGreaterThan(0);
      for (const category of ['BETTING', 'ALCOHOL']) {
        const res = await api.listAdvertisers({ category });
        if (res.status === 200) expect(res.body.items).toEqual([]);
        else expect([400, 422]).toContain(res.status);
      }
    });
  });
});
