import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLogs, cities, spaceMembers, spaces, users } from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { SuperSpacesService } from '../../src/super/super-spaces.service.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import { FakeGeocoder, FakeStorage } from '../spaces/fixtures.js';
import {
  bearer,
  createSpace,
  member,
  NIL_UUID,
  type Row,
  seedCatalog,
  setSpaceStatus,
  superUser,
} from './fixtures.js';

// RF-SUPER-01 a 04: listar/filtrar, criar (já ACTIVE), editar, suspender/reativar/encerrar.

describe('Super: espaços', () => {
  let t: TestApp;
  let catalog: Awaited<ReturnType<typeof seedCatalog>>;
  let admin: SignedUp;
  let santos: string;
  const geocoder = new FakeGeocoder();

  const get = (path: string, user = admin) =>
    t
      .http()
      .get(path)
      .set(...bearer(user));
  const send = (method: 'post' | 'patch' | 'put', path: string, body: object = {}, user = admin) =>
    t
      .http()
      [method](path)
      .set(...bearer(user))
      .send(body);

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: geocoder },
        { provide: PhotoStorage, useValue: new FakeStorage() },
      ],
    });
    catalog = await seedCatalog(t.db);
    admin = await superUser(t, 'super@exemplo.com');
    santos = first(
      await t.db
        .insert(cities)
        .values({ name: 'Santos', state: 'SP', timezone: 'America/Sao_Paulo' })
        .returning(),
    ).id;
  });
  afterAll(() => t.close());

  describe('listar, buscar e filtrar (RF-SUPER-01)', () => {
    let arena: string;
    let praia: string;
    let quadra: string;

    beforeAll(async () => {
      arena = (await createSpace(t.db, catalog, { name: 'Arena Centro', slug: 'arena-centro' })).id;
      praia = (
        await createSpace(t.db, catalog, {
          name: 'Praia Clube',
          slug: 'praia-clube',
          status: 'SUSPENDED',
          courts: [{ sports: ['beach-tennis'] }],
        })
      ).id;
      quadra = (
        await createSpace(t.db, catalog, {
          name: 'Quadra Santista',
          slug: 'quadra-santista',
          price: null,
          courts: [],
        })
      ).id;
      await t.db.update(spaces).set({ cityId: santos }).where(eq(spaces.id, quadra));
      await member(t, 'dono-arena@exemplo.com', arena, 'OWNER');
    });

    it('lista todos os status, com dono, esportes e progresso da implantação', async () => {
      const res = await get('/v1/super/spaces?pageSize=100').expect(200);
      const byId = new Map<string, Row>(res.body.items.map((item: Row) => [item.id, item]));
      expect(byId.get(arena)).toMatchObject({
        name: 'Arena Centro',
        status: 'ACTIVE',
        showcaseVisible: true,
        courtsCount: 1,
        sports: [{ slug: 'futevolei' }],
        owners: [{ email: 'dono-arena@exemplo.com' }],
      });
      expect(byId.get(arena)?.onboarding).toMatchObject({ total: 5 });
      expect(byId.get(praia)).toMatchObject({ status: 'SUSPENDED', showcaseVisible: false });
      expect(byId.get(quadra)).toMatchObject({ courtsCount: 0, showcaseVisible: false });
      expect(res.body).toMatchObject({ page: 1, pageSize: 100 });
    });

    it('filtra por status, cidade, esporte e busca por nome/slug', async () => {
      const ids = async (query: string) =>
        (await get(`/v1/super/spaces?${query}`).expect(200)).body.items.map((i: Row) => i.id);
      expect(await ids('status=SUSPENDED')).toEqual([praia]);
      expect(await ids(`cityId=${santos}`)).toEqual([quadra]);
      expect(await ids('sports=beach-tennis')).toEqual([praia]);
      expect(await ids('sports=beach-tennis,futevolei')).toEqual([arena, praia]);
      expect(await ids('q=santista')).toEqual([quadra]);
      expect(await ids('q=praia-c')).toEqual([praia]);
      expect(await ids('q=100%25')).toEqual([]);
    });

    it('pagina com total', async () => {
      const page1 = (await get('/v1/super/spaces?pageSize=2&page=1').expect(200)).body;
      const page2 = (await get('/v1/super/spaces?pageSize=2&page=2').expect(200)).body;
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(page2.total);
      expect(page2.items.length).toBeGreaterThan(0);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
    });

    it('valida os filtros', async () => {
      await get('/v1/super/spaces?status=XPTO').expect(400);
      await get('/v1/super/spaces?pageSize=1000').expect(400);
    });
  });

  describe('criar espaço e convidar o Dono (RF-SUPER-02, RN-SPACE-01)', () => {
    it('nasce ACTIVE com slug gerado, settings vazias e checklist incompleto', async () => {
      const res = await send('post', '/v1/super/spaces', {
        name: 'Arena São João',
        cityId: catalog.city.id,
      }).expect(201);
      expect(res.body.ownerInvite).toBeNull();
      expect(res.body.space).toMatchObject({
        name: 'Arena São João',
        slug: 'arena-sao-joao',
        status: 'ACTIVE',
        courtsCount: 0,
        owners: [],
      });
      expect(res.body.space.checklist.completed).toBe(false);
      expect(res.body.space.checklist.items.map((i: Row) => [i.key, i.done])).toEqual([
        ['DATA', false],
        ['PHOTOS', false],
        ['COURTS', false],
        ['PRICE', false],
        ['TEAM', false],
      ]);
      // Ainda não aparece na vitrine (sem quadra e sem preço).
      const search = await t.http().get('/v1/spaces?q=Arena%20S%C3%A3o').expect(200);
      expect(search.body.items).toEqual([]);

      const [row] = await t.db.select().from(spaces).where(eq(spaces.slug, 'arena-sao-joao'));
      expect(row?.status).toBe('ACTIVE');
    });

    it('gera slugs únicos para nomes iguais; slug pedido repetido é 409', async () => {
      const again = await send('post', '/v1/super/spaces', {
        name: 'Arena São João',
        cityId: catalog.city.id,
      }).expect(201);
      expect(again.body.space.slug).toBe('arena-sao-joao-2');

      const taken = await send('post', '/v1/super/spaces', {
        name: 'Outro',
        slug: 'arena-sao-joao',
        cityId: catalog.city.id,
      }).expect(409);
      expect(taken.body.error.code).toBe('SLUG_TAKEN');
    });

    it('valida cidade e dados', async () => {
      const city = await send('post', '/v1/super/spaces', {
        name: 'X Esportes',
        cityId: NIL_UUID,
      }).expect(422);
      expect(city.body.error.code).toBe('CITY_NOT_FOUND');
      await send('post', '/v1/super/spaces', { cityId: catalog.city.id }).expect(400);
      await send('post', '/v1/super/spaces', {
        name: 'Sem Strict',
        cityId: catalog.city.id,
        status: 'SUSPENDED',
      }).expect(400);
    });

    it('geocodifica o endereço informado', async () => {
      geocoder.byPostalCode.set('30112000', { lat: -19.93, lng: -43.94 });
      const res = await send('post', '/v1/super/spaces', {
        name: 'Arena Savassi',
        cityId: catalog.city.id,
        address: {
          street: 'Rua Pernambuco',
          number: '100',
          neighborhood: 'Savassi',
          postalCode: '30112-000',
        },
      }).expect(201);
      expect(res.body.space.location).toEqual({ lat: -19.93, lng: -43.94 });

      const notFound = await send('post', '/v1/super/spaces', {
        name: 'Arena Perdida',
        cityId: catalog.city.id,
        address: { street: 'Rua X', number: '1', neighborhood: 'Y', postalCode: '99999999' },
      }).expect(422);
      expect(notFound.body.error.code).toBe('ADDRESS_NOT_FOUND');
      const [lost] = await t.db.select().from(spaces).where(eq(spaces.slug, 'arena-perdida'));
      expect(lost).toBeUndefined();
    });

    const verify = (userId: string) =>
      t.db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));

    it('convida o Dono: conta existente vira Dono; sem conta, aguarda o cadastro', async () => {
      const dono = await signUp(t, 'novo-dono@exemplo.com', 'Novo Dono');
      await verify(dono.id);
      const linked = await send('post', '/v1/super/spaces', {
        name: 'Arena Nova',
        cityId: catalog.city.id,
        ownerEmail: 'Novo-Dono@Exemplo.com',
      }).expect(201);
      expect(linked.body.ownerInvite).toEqual({
        email: 'novo-dono@exemplo.com',
        status: 'LINKED',
      });
      expect(linked.body.space.owners).toEqual([
        { id: dono.id, name: 'Novo Dono', email: 'novo-dono@exemplo.com' },
      ]);
      expect(linked.body.space.checklist.items.find((i: Row) => i.key === 'TEAM').done).toBe(true);
      // O Dono já acessa o painel do espaço (RN-AUTH-01).
      await get(`/v1/manage/spaces/${linked.body.space.id}`, dono).expect(200);

      const waiting = await send('post', '/v1/super/spaces', {
        name: 'Arena Futura',
        cityId: catalog.city.id,
        ownerEmail: 'ainda-sem-conta@exemplo.com',
      }).expect(201);
      expect(waiting.body.ownerInvite.status).toBe('AWAITING_SIGNUP');
      expect(waiting.body.space.owners).toEqual([]);

      // Depois do cadastro, repetir o convite vincula (e é idempotente).
      const later = await signUp(t, 'ainda-sem-conta@exemplo.com', 'Dona Tardia');
      await verify(later.id);
      for (let i = 0; i < 2; i++) {
        const res = await send('post', `/v1/super/spaces/${waiting.body.space.id}/owner-invites`, {
          email: 'ainda-sem-conta@exemplo.com',
        }).expect(201);
        expect(res.body.status).toBe('LINKED');
      }
      const owners = await t.db
        .select()
        .from(spaceMembers)
        .where(eq(spaceMembers.userId, later.id));
      expect(owners).toHaveLength(1);

      // A auditoria do convite guarda o e-mail mascarado.
      const invites = await t.db
        .select({ diff: auditLogs.diff })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.space.invite_owner'));
      expect(invites.length).toBeGreaterThan(0);
      for (const { diff } of invites) {
        expect(diff?.email).toMatch(/^.\*\*\*@exemplo\.com$/);
      }
    });

    it('conta com e-mail não verificado não vira Dono até verificar', async () => {
      const intruso = await signUp(t, 'dono-real@exemplo.com', 'Quem se cadastrou antes');
      const created = await send('post', '/v1/super/spaces', {
        name: 'Arena Verificação',
        cityId: catalog.city.id,
        ownerEmail: 'dono-real@exemplo.com',
      }).expect(201);
      expect(created.body.ownerInvite).toEqual({
        email: 'dono-real@exemplo.com',
        status: 'AWAITING_VERIFICATION',
      });
      expect(created.body.space.owners).toEqual([]);
      const spaceId = created.body.space.id as string;
      const linksOf = () =>
        t.db.select().from(spaceMembers).where(eq(spaceMembers.userId, intruso.id));
      expect(await linksOf()).toHaveLength(0);
      await get(`/v1/manage/spaces/${spaceId}`, intruso).expect(403);

      const again = await send('post', `/v1/super/spaces/${spaceId}/owner-invites`, {
        email: 'dono-real@exemplo.com',
      }).expect(201);
      expect(again.body.status).toBe('AWAITING_VERIFICATION');
      expect(await linksOf()).toHaveLength(0);

      await verify(intruso.id);
      const linked = await send('post', `/v1/super/spaces/${spaceId}/owner-invites`, {
        email: 'dono-real@exemplo.com',
      }).expect(201);
      expect(linked.body.status).toBe('LINKED');
      expect(await linksOf()).toHaveLength(1);
      await get(`/v1/manage/spaces/${spaceId}`, intruso).expect(200);
    });

    it('registra a criação na auditoria', async () => {
      const rows = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.space.create'));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.actingAsSuper && row.actorId === admin.id)).toBe(true);
    });
  });

  describe('editar qualquer dado (RF-SUPER-04)', () => {
    let spaceId: string;
    let other: string;

    beforeAll(async () => {
      spaceId = (await createSpace(t.db, catalog, { name: 'Editável', slug: 'editavel' })).id;
      other = (await createSpace(t.db, catalog, { name: 'Outro', slug: 'outro-slug' })).id;
    });

    it('edita nome, slug e dados; conflito de slug é 409', async () => {
      const res = await send('patch', `/v1/super/spaces/${spaceId}`, {
        name: 'Editado',
        slug: 'editado',
        description: 'Descrição nova',
        phone: '+5531999998888',
      }).expect(200);
      expect(res.body).toMatchObject({
        name: 'Editado',
        slug: 'editado',
        description: 'Descrição nova',
        phone: '+5531999998888',
      });

      const taken = await send('patch', `/v1/super/spaces/${spaceId}`, {
        slug: 'outro-slug',
      }).expect(409);
      expect(taken.body.error.code).toBe('SLUG_TAKEN');
      await send('patch', `/v1/super/spaces/${spaceId}`, { slug: 'Slug Inválido' }).expect(400);
      await send('patch', `/v1/super/spaces/${NIL_UUID}`, { name: 'X' }).expect(404);
      await send('patch', '/v1/super/spaces/nao-e-uuid', { name: 'X' }).expect(404);
      expect(other).toBeDefined();
    });

    it('edita infraestrutura, horário e configurações; audita', async () => {
      await send('put', `/v1/super/spaces/${spaceId}/amenities`, {
        amenityIds: [catalog.amenity('wi-fi').id],
      }).expect(200);
      await send('put', `/v1/super/spaces/${spaceId}/opening-hours`, {
        openingHours: [{ weekday: 1, opensAt: '07:00', closesAt: '22:00' }],
      }).expect(200);
      const settings = await send('patch', `/v1/super/spaces/${spaceId}/settings`, {
        pricePerHourCents: 12_000,
      }).expect(200);
      expect(settings.body.pricePerHourCents).toBe(12_000);
      await send('patch', `/v1/super/spaces/${spaceId}/settings`, {
        bookingMinDurationMin: 45,
      }).expect(400);
      expect(
        (await get(`/v1/super/spaces/${spaceId}/settings`).expect(200)).body.pricePerHourCents,
      ).toBe(12_000);

      const actions = (
        await t.db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.spaceId, spaceId))
      ).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'super.space.update',
          'super.space.amenities',
          'super.space.opening_hours',
          'super.space.settings',
        ]),
      );
    });

    it('edição e auditoria na mesma transação: se uma falha, nada é gravado', async () => {
      const service = t.app.get(SuperSpacesService);
      const audits = async () =>
        (
          await t.db
            .select({ id: auditLogs.id })
            .from(auditLogs)
            .where(eq(auditLogs.spaceId, spaceId))
        ).length;
      const before = await audits();
      const current = (await get(`/v1/super/spaces/${spaceId}`).expect(200)).body;

      // Slug em uso: a descrição enviada junto não fica gravada, nem a auditoria.
      await send('patch', `/v1/super/spaces/${spaceId}`, {
        description: 'Não deve ficar',
        slug: 'outro-slug',
      }).expect(409);

      // Auditoria falhando: a edição é desfeita (dados, infraestrutura, horário e configurações).
      const spy = vi
        .spyOn(service as never as { auditSpace: () => Promise<void> }, 'auditSpace')
        .mockRejectedValue(new Error('Falha ao auditar.'));
      try {
        await send('patch', `/v1/super/spaces/${spaceId}`, { name: 'Sem registro' }).expect(500);
        await send('put', `/v1/super/spaces/${spaceId}/amenities`, { amenityIds: [] }).expect(500);
        await send('put', `/v1/super/spaces/${spaceId}/opening-hours`, {
          openingHours: [],
        }).expect(500);
        await send('patch', `/v1/super/spaces/${spaceId}/settings`, {
          pricePerHourCents: 1,
        }).expect(500);
      } finally {
        spy.mockRestore();
      }

      const after = (await get(`/v1/super/spaces/${spaceId}`).expect(200)).body;
      expect(after).toMatchObject({
        name: current.name,
        description: current.description,
        amenities: current.amenities,
        openingHours: current.openingHours,
      });
      expect(
        (await get(`/v1/super/spaces/${spaceId}/settings`).expect(200)).body.pricePerHourCents,
      ).toBe(12_000);
      expect(await audits()).toBe(before);
    });

    it('edita mesmo com o espaço suspenso', async () => {
      await setSpaceStatus(t.db, other, 'SUSPENDED');
      await send('patch', `/v1/super/spaces/${other}`, { description: 'Ajuste do suporte' }).expect(
        200,
      );
    });
  });

  describe('suspender, reativar e encerrar (RF-SUPER-03)', () => {
    let spaceId: string;
    let owner: SignedUp;

    beforeAll(async () => {
      const space = await createSpace(t.db, catalog, {
        name: 'Arena Suspensa',
        slug: 'arena-suspensa',
        photos: 1,
      });
      spaceId = space.id;
      owner = await member(t, 'dono-suspensa@exemplo.com', spaceId, 'OWNER');
    });

    const inShowcase = async () =>
      (await t.http().get('/v1/spaces?q=Arena%20Suspensa').expect(200)).body.items.length === 1;

    it('suspensa some da vitrine e o painel dela fica só leitura; reativar volta tudo', async () => {
      expect(await inShowcase()).toBe(true);
      await send('patch', `/v1/manage/spaces/${spaceId}`, { description: 'antes' }, owner).expect(
        200,
      );

      const suspended = await send('post', `/v1/super/spaces/${spaceId}/suspend`, {
        reason: 'Inadimplência',
      }).expect(200);
      expect(suspended.body.status).toBe('SUSPENDED');
      expect(await inShowcase()).toBe(false);

      // Leitura continua; escrita → 403 SPACE_READ_ONLY.
      await get(`/v1/manage/spaces/${spaceId}`, owner).expect(200);
      const blocked = await send(
        'patch',
        `/v1/manage/spaces/${spaceId}`,
        { description: 'depois' },
        owner,
      ).expect(403);
      expect(blocked.body.error.code).toBe('SPACE_READ_ONLY');
      await send('put', `/v1/manage/spaces/${spaceId}/amenities`, { amenityIds: [] }, owner).expect(
        403,
      );

      const reactivated = await send('post', `/v1/super/spaces/${spaceId}/reactivate`).expect(200);
      expect(reactivated.body.status).toBe('ACTIVE');
      expect(await inShowcase()).toBe(true);
      await send(
        'patch',
        `/v1/manage/spaces/${spaceId}`,
        { description: 'de volta' },
        owner,
      ).expect(200);

      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'super.space.suspend'));
      expect(log?.diff).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED', reason: 'Inadimplência' });
    });

    it('valida as transições de status', async () => {
      const again = await send('post', `/v1/super/spaces/${spaceId}/reactivate`).expect(409);
      expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      await send('post', `/v1/super/spaces/${spaceId}/close`).expect(200);
      expect(await inShowcase()).toBe(false);
      const closedWrite = await send(
        'patch',
        `/v1/manage/spaces/${spaceId}`,
        { description: 'x' },
        owner,
      ).expect(403);
      expect(closedWrite.body.error.code).toBe('SPACE_READ_ONLY');
      await send('post', `/v1/super/spaces/${spaceId}/suspend`).expect(409);
      await send('post', `/v1/super/spaces/${spaceId}/close`).expect(409);

      await send('post', `/v1/super/spaces/${spaceId}/reactivate`).expect(200);
      await send('post', `/v1/super/spaces/${NIL_UUID}/suspend`).expect(404);
    });
  });

  describe('checklist de implantação (RF-SUPER-02)', () => {
    it('cada item fica pronto com os dados do espaço', async () => {
      const space = await createSpace(t.db, catalog, {
        name: 'Arena Completa',
        slug: 'arena-completa',
        photos: 2,
      });
      const checklist = async () =>
        new Map<string, Row>(
          (await get(`/v1/super/spaces/${space.id}`).expect(200)).body.checklist.items.map(
            (i: Row) => [i.key, i],
          ),
        );

      let items = await checklist();
      // createSpace já dá quadra com esporte, preço e fotos.
      expect(items.get('COURTS')).toMatchObject({ done: true });
      expect(items.get('PRICE')).toMatchObject({ done: true });
      expect(items.get('PHOTOS')).toMatchObject({ done: true });
      expect(items.get('TEAM')).toMatchObject({ done: false, missing: ['activeOwner'] });
      expect(items.get('DATA')?.missing).toEqual(
        expect.arrayContaining(['description', 'address', 'contact', 'openingHours']),
      );

      await member(t, 'dono-completa@exemplo.com', space.id, 'OWNER');
      geocoder.byPostalCode.set('30130000', { lat: -19.92, lng: -43.94 });
      await send('patch', `/v1/super/spaces/${space.id}`, {
        description: 'Completa',
        address: {
          street: 'Av. Brasil',
          number: '10',
          neighborhood: 'Funcionários',
          postalCode: '30130000',
        },
        whatsapp: '+5531988887777',
      }).expect(200);
      await send('put', `/v1/super/spaces/${space.id}/opening-hours`, {
        openingHours: [{ weekday: 2, opensAt: '08:00', closesAt: '20:00' }],
      }).expect(200);

      items = await checklist();
      expect([...items.values()].every((item) => item.done)).toBe(true);
      const detail = (await get(`/v1/super/spaces/${space.id}`).expect(200)).body;
      expect(detail.checklist).toMatchObject({ completed: true, doneCount: 5, total: 5 });
      expect(detail.courtsCount).toBe(1);
    });

    it('quadra em manutenção ou sem esporte não conta', async () => {
      const space = await createSpace(t.db, catalog, {
        name: 'Arena Quase',
        slug: 'arena-quase',
        courts: [{ status: 'MAINTENANCE', sports: ['futevolei'] }, { sports: [] }],
      });
      const res = await get(`/v1/super/spaces/${space.id}`).expect(200);
      expect(res.body.checklist.items.find((i: Row) => i.key === 'COURTS')).toMatchObject({
        done: false,
        missing: ['activeCourtWithSport'],
      });
    });
  });
});
