import type { SpaceRole } from '@space-sports/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, makeSuper, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  member,
  seedCatalog,
  setSpaceStatus,
} from './fixtures.js';

// Matriz de permissões de docs/02 aplicada a cada rota do painel (RN-AUTH-01, RN-AUTH-03) e o
// modo somente leitura do espaço suspenso (RF-SUPER-03).

type Route = {
  name: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: (spaceId: string, courtId: string) => string;
  body?: (catalog: Catalog) => object;
  allowed: SpaceRole[];
};

const ALL: SpaceRole[] = ['OWNER', 'ADMIN', 'TEACHER'];
const MANAGERS: SpaceRole[] = ['OWNER', 'ADMIN'];

const ROUTES: Route[] = [
  {
    name: 'ver dados do espaço',
    method: 'get',
    path: (s) => `/v1/manage/spaces/${s}`,
    allowed: ALL,
  },
  {
    name: 'editar dados do espaço',
    method: 'patch',
    path: (s) => `/v1/manage/spaces/${s}`,
    body: () => ({ description: 'Nova descrição' }),
    allowed: MANAGERS,
  },
  {
    name: 'editar infraestrutura',
    method: 'put',
    path: (s) => `/v1/manage/spaces/${s}/amenities`,
    body: (c) => ({ amenityIds: [c.amenity('wi-fi').id] }),
    allowed: MANAGERS,
  },
  {
    name: 'editar horário',
    method: 'put',
    path: (s) => `/v1/manage/spaces/${s}/opening-hours`,
    body: () => ({ openingHours: [{ weekday: 1, opensAt: '07:00', closesAt: '22:00' }] }),
    allowed: MANAGERS,
  },
  {
    name: 'pedir upload de foto',
    method: 'post',
    path: (s) => `/v1/manage/spaces/${s}/photos/uploads`,
    body: () => ({ contentType: 'image/jpeg', size: 1000 }),
    allowed: MANAGERS,
  },
  {
    name: 'pedir upload da logo',
    method: 'post',
    path: (s) => `/v1/manage/spaces/${s}/logo/uploads`,
    body: () => ({ contentType: 'image/png', size: 1000 }),
    allowed: MANAGERS,
  },
  {
    name: 'remover a logo',
    method: 'delete',
    path: (s) => `/v1/manage/spaces/${s}/logo`,
    allowed: MANAGERS,
  },
  {
    name: 'ver configurações',
    method: 'get',
    path: (s) => `/v1/manage/spaces/${s}/settings`,
    allowed: ALL,
  },
  {
    name: 'editar configurações',
    method: 'patch',
    path: (s) => `/v1/manage/spaces/${s}/settings`,
    body: () => ({ pricePerHourCents: 12_000 }),
    allowed: MANAGERS,
  },
  {
    name: 'listar quadras',
    method: 'get',
    path: (s) => `/v1/manage/spaces/${s}/courts`,
    allowed: ALL,
  },
  {
    name: 'ver quadra',
    method: 'get',
    path: (s, c) => `/v1/manage/spaces/${s}/courts/${c}`,
    allowed: ALL,
  },
  {
    name: 'criar quadra',
    method: 'post',
    path: (s) => `/v1/manage/spaces/${s}/courts`,
    body: (c) => ({
      name: `Nova ${Math.random()}`,
      sportIds: [c.sport('futevolei').id],
    }),
    allowed: MANAGERS,
  },
  {
    name: 'editar quadra',
    method: 'patch',
    path: (s, c) => `/v1/manage/spaces/${s}/courts/${c}`,
    body: () => ({ covered: true }),
    allowed: MANAGERS,
  },
];

describe('permissões do painel de espaços', () => {
  let t: TestApp;
  let catalog: Catalog;
  let spaceId: string;
  let courtId: string;
  let otherSpaceId: string;
  const users = {} as Record<SpaceRole, SignedUp>;
  let player: SignedUp;
  let ownerOfOther: SignedUp;
  let superUser: SignedUp;

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: new FakeGeocoder() },
        { provide: PhotoStorage, useValue: new FakeStorage() },
      ],
    });
    catalog = await seedCatalog(t.db);
    const space = await createSpace(t.db, catalog);
    spaceId = space.id;
    const res = await t.db.query.courts.findFirst({ where: (c, { eq }) => eq(c.spaceId, spaceId) });
    courtId = res?.id ?? '';
    otherSpaceId = (await createSpace(t.db, catalog)).id;
    for (const role of ALL) {
      users[role] = await member(t, `${role.toLowerCase()}@exemplo.com`, spaceId, role);
    }
    player = await signUp(t, 'jogador@exemplo.com');
    ownerOfOther = await member(t, 'dono-outro@exemplo.com', otherSpaceId, 'OWNER');
    superUser = await signUp(t, 'super@exemplo.com');
    await makeSuper(t.db, superUser.id);
  });
  afterAll(() => t.close());

  const call = (route: Route, user: SignedUp | null, space = spaceId) => {
    const req = t.http()[route.method](route.path(space, courtId));
    if (user) req.set('cookie', user.cookie);
    return route.body ? req.send(route.body(catalog)) : req;
  };

  describe.each(ROUTES)('$name', (route) => {
    it.each(ALL)('%s', async (role) => {
      const res = await call(route, users[role]);
      if (route.allowed.includes(role)) {
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      } else {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
      }
    });

    it('jogador sem vínculo, dono de outro espaço e Super: 403; sem sessão: 401', async () => {
      for (const user of [player, ownerOfOther, superUser]) {
        const res = await call(route, user);
        expect(res.status).toBe(403);
      }
      expect((await call(route, null)).status).toBe(401);
    });
  });

  it('excluir quadra: só Dono/Admin', async () => {
    for (const role of ['TEACHER'] as const) {
      await t
        .http()
        .delete(`/v1/manage/spaces/${spaceId}/courts/${courtId}`)
        .set('cookie', users[role].cookie)
        .expect(403);
    }
    const created = await t
      .http()
      .post(`/v1/manage/spaces/${spaceId}/courts`)
      .set('cookie', users.ADMIN.cookie)
      .send({ name: 'Para excluir', sportIds: [catalog.sport('beach-tennis').id] })
      .expect(201);
    await t
      .http()
      .delete(`/v1/manage/spaces/${spaceId}/courts/${created.body.id}`)
      .set('cookie', users.ADMIN.cookie)
      .expect(204);
  });

  it('quadra de outro espaço não é acessível pelo espaço da rota (multi-tenant)', async () => {
    const res = await t
      .http()
      .patch(`/v1/manage/spaces/${otherSpaceId}/courts/${courtId}`)
      .set('cookie', ownerOfOther.cookie)
      .send({ covered: true })
      .expect(404);
    expect(res.body.error.code).toBe('COURT_NOT_FOUND');
  });

  describe('espaço suspenso ou encerrado: painel só leitura (RF-SUPER-03)', () => {
    it.each(['SUSPENDED', 'CLOSED'] as const)('%s', async (status) => {
      const space = await createSpace(t.db, catalog);
      const owner = await member(t, `dono-${status}@exemplo.com`, space.id, 'OWNER');
      await setSpaceStatus(t.db, space.id, status);

      const read = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(read.body.status).toBe(status);
      expect(read.body.showcase).toEqual({ visible: false, missing: ['ACTIVE_STATUS'] });
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/settings`)
        .set('cookie', owner.cookie)
        .expect(200);

      for (const route of ROUTES.filter((r) => r.method !== 'get')) {
        const res = await call(route, owner, space.id);
        expect(res.status, route.name).toBe(403);
        expect(res.body.error.code).toBe('SPACE_READ_ONLY');
      }
      // Quem não tem papel continua recebendo SPACE_FORBIDDEN (não revela o status).
      const res = await t
        .http()
        .patch(`/v1/manage/spaces/${space.id}`)
        .set('cookie', player.cookie)
        .send({ description: 'x' })
        .expect(403);
      expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
    });
  });

  it('favoritar exige sessão; busca, detalhe e catálogos são públicos', async () => {
    await t.http().put(`/v1/spaces/${spaceId}/favorite`).expect(401);
    await t.http().get('/v1/me/favorites').expect(401);
    await t.http().get('/v1/spaces').expect(200);
    await t.http().get('/v1/sports').expect(200);
    await t.http().get('/v1/amenities').expect(200);
    await t.http().get('/v1/cities').expect(200);
  });
});
