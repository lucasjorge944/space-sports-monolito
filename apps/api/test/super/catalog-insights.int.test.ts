import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bookings,
  courtSports,
  courts,
  recurringBookings,
  sessions,
  spaces,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import {
  bearer,
  createSpace,
  member,
  NIL_UUID,
  type Row,
  seedCatalog,
  superUser,
} from './fixtures.js';

// RF-SUPER-06 (catálogos), RF-SUPER-09 (métricas) e RF-SUPER-10 (log de auditoria).

describe('Super: catálogos, métricas e auditoria', () => {
  let t: TestApp;
  let catalog: Awaited<ReturnType<typeof seedCatalog>>;
  let admin: SignedUp;

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => {
    const req = t
      .http()
      [method](path)
      .set(...bearer(admin));
    return body ? req.send(body) : req;
  };

  beforeAll(async () => {
    t = await createTestApp();
    catalog = await seedCatalog(t.db);
    admin = await superUser(t, 'super@exemplo.com');
  });
  afterAll(() => t.close());

  describe('catálogos (RF-SUPER-06)', () => {
    it('esportes: criar, editar, slug repetido e excluir sem uso; o catálogo público reflete', async () => {
      const created = await call('post', '/v1/super/catalog/sports', {
        slug: 'padel',
        name: 'Padel',
        defaultMaxPlayers: 4,
      }).expect(201);
      expect(created.body).toMatchObject({
        slug: 'padel',
        name: 'Padel',
        defaultMaxPlayers: 4,
        icon: null,
      });
      const dup = await call('post', '/v1/super/catalog/sports', {
        slug: 'padel',
        name: 'Outro',
      }).expect(409);
      expect(dup.body.error.code).toBe('CATALOG_SLUG_TAKEN');
      await call('post', '/v1/super/catalog/sports', { slug: 'Padel Mau', name: 'X' }).expect(400);
      await call('post', '/v1/super/catalog/sports', {
        slug: 'x-y',
        name: 'X',
        defaultMaxPlayers: 99,
      }).expect(400);

      const updated = await call('patch', `/v1/super/catalog/sports/${created.body.id}`, {
        name: 'Padel Indoor',
        icon: 'racket',
      }).expect(200);
      expect(updated.body).toMatchObject({ name: 'Padel Indoor', icon: 'racket', slug: 'padel' });
      // PATCH vazio devolve o item sem mudar nada.
      await call('patch', `/v1/super/catalog/sports/${created.body.id}`, {}).expect(200);

      // Decisão 51: a capacidade das quadras acompanha o padrão do esporte.
      const space = await createSpace(t.db, catalog, { name: 'Arena Padel', slug: 'arena-padel' });
      const [court] = await t.db
        .select({ id: courts.id })
        .from(courts)
        .where(eq(courts.spaceId, space.id));
      if (!court) throw new Error('Espaço sem quadra.');
      await t.db
        .insert(courtSports)
        .values({ courtId: court.id, sportId: created.body.id, maxPlayers: 4 });
      const capacity = async () =>
        (
          await t.db
            .select({ maxPlayers: courtSports.maxPlayers })
            .from(courtSports)
            .where(and(eq(courtSports.courtId, court.id), eq(courtSports.sportId, created.body.id)))
        )[0]?.maxPlayers;
      await call('patch', `/v1/super/catalog/sports/${created.body.id}`, {
        name: 'Padel Indoor',
      }).expect(200);
      expect(await capacity()).toBe(4);
      await call('patch', `/v1/super/catalog/sports/${created.body.id}`, {
        defaultMaxPlayers: 6,
      }).expect(200);
      expect(await capacity()).toBe(6);
      await call('patch', `/v1/super/catalog/sports/${created.body.id}`, {
        defaultMaxPlayers: null,
      }).expect(200);
      expect(await capacity()).toBe(20);
      await t.db.delete(courtSports).where(eq(courtSports.sportId, created.body.id));
      const clash = await call('patch', `/v1/super/catalog/sports/${created.body.id}`, {
        slug: 'futevolei',
      }).expect(409);
      expect(clash.body.error.code).toBe('CATALOG_SLUG_TAKEN');

      const publicList = await t.http().get('/v1/sports').expect(200);
      expect(publicList.body.items.map((s: Row) => s.slug)).toContain('padel');
      await call('delete', `/v1/super/catalog/sports/${created.body.id}`).expect(204);
      await call('delete', `/v1/super/catalog/sports/${created.body.id}`).expect(404);
      expect(
        (await t.http().get('/v1/sports').expect(200)).body.items.map((s: Row) => s.slug),
      ).not.toContain('padel');
    });

    it('esporte e infraestrutura em uso não são excluídos', async () => {
      await createSpace(t.db, catalog, { amenities: ['wi-fi'] });
      const sport = await call(
        'delete',
        `/v1/super/catalog/sports/${catalog.sport('futevolei').id}`,
      ).expect(409);
      expect(sport.body.error.code).toBe('CATALOG_IN_USE');
      const amenity = await call(
        'delete',
        `/v1/super/catalog/amenities/${catalog.amenity('wi-fi').id}`,
      ).expect(409);
      expect(amenity.body.error.code).toBe('CATALOG_IN_USE');
      await call('delete', `/v1/super/catalog/sports/${NIL_UUID}`).expect(404);
      await call('delete', '/v1/super/catalog/sports/xpto').expect(404);
    });

    it('infraestrutura: CRUD', async () => {
      const created = await call('post', '/v1/super/catalog/amenities', {
        slug: 'sauna',
        name: 'Sauna',
      }).expect(201);
      await call('post', '/v1/super/catalog/amenities', { slug: 'sauna', name: 'Sauna 2' }).expect(
        409,
      );
      const updated = await call('patch', `/v1/super/catalog/amenities/${created.body.id}`, {
        name: 'Sauna seca',
      }).expect(200);
      expect(updated.body.name).toBe('Sauna seca');
      const list = await call('get', '/v1/super/catalog/amenities').expect(200);
      expect(list.body.items.map((a: Row) => a.slug)).toContain('sauna');
      await call('delete', `/v1/super/catalog/amenities/${created.body.id}`).expect(204);
      await call('patch', `/v1/super/catalog/amenities/${NIL_UUID}`, { name: 'X' }).expect(404);
    });

    it('cidades: criar, desativar (some do catálogo público), duplicada e exclusão em uso', async () => {
      const created = await call('post', '/v1/super/catalog/cities', {
        name: 'Contagem',
        state: 'MG',
      }).expect(201);
      expect(created.body).toMatchObject({
        state: 'MG',
        timezone: 'America/Sao_Paulo',
        active: true,
      });
      const dup = await call('post', '/v1/super/catalog/cities', {
        name: 'Contagem',
        state: 'MG',
      }).expect(409);
      expect(dup.body.error.code).toBe('CITY_ALREADY_EXISTS');
      // O mesmo nome em outra UF é outra cidade.
      const otherState = await call('post', '/v1/super/catalog/cities', {
        name: 'Contagem',
        state: 'SP',
      }).expect(201);
      await call('delete', `/v1/super/catalog/cities/${otherState.body.id}`).expect(204);
      await call('post', '/v1/super/catalog/cities', { name: 'X', state: 'mg' }).expect(400);
      await call('post', '/v1/super/catalog/cities', {
        name: 'X',
        state: 'MG',
        timezone: 'Marte/Olimpo',
      }).expect(400);

      expect(
        (await t.http().get('/v1/cities').expect(200)).body.items.map((c: Row) => c.name),
      ).toContain('Contagem');
      await call('patch', `/v1/super/catalog/cities/${created.body.id}`, { active: false }).expect(
        200,
      );
      expect(
        (await t.http().get('/v1/cities').expect(200)).body.items.map((c: Row) => c.name),
      ).not.toContain('Contagem');
      const all = await call('get', '/v1/super/catalog/cities').expect(200);
      expect(all.body.items.find((c: Row) => c.id === created.body.id)).toMatchObject({
        active: false,
      });

      // Cidade com espaço não é excluída; a sem uso é.
      const inUse = await call('delete', `/v1/super/catalog/cities/${catalog.city.id}`).expect(409);
      expect(inUse.body.error.code).toBe('CATALOG_IN_USE');
      await call('delete', `/v1/super/catalog/cities/${created.body.id}`).expect(204);
    });

    it('níveis: lista só leitura', async () => {
      const res = await call('get', '/v1/super/catalog/levels').expect(200);
      expect(res.body.items).toEqual([
        { value: 'BEGINNER', label: 'Iniciante' },
        { value: 'INTERMEDIATE', label: 'Intermediário' },
        { value: 'ADVANCED', label: 'Avançado' },
        { value: 'PRO', label: 'Profissional' },
      ]);
    });
  });

  describe('métricas por espaço (RF-SUPER-09)', () => {
    it('conta reservas do período (sem canceladas), mensalistas ativos e último acesso', async () => {
      const arena = await createSpace(t.db, catalog, {
        name: 'Métrica Arena',
        slug: 'metrica-arena',
      });
      const vazia = await createSpace(t.db, catalog, {
        name: 'Métrica Vazia',
        slug: 'metrica-vazia',
      });
      const dono = await member(t, 'dono-metrica@exemplo.com', arena.id, 'OWNER');
      const court = first(
        await t.db.query.courts.findMany({ where: (c, { eq }) => eq(c.spaceId, arena.id) }),
      );

      const base = {
        spaceId: arena.id,
        courtId: court.id,
        organizerUserId: dono.id,
        sportId: catalog.sport('futevolei').id,
        durationMin: 60,
        peopleCount: 4,
        pricePerHourCents: 10_000,
        priceCents: 10_000,
        source: 'APP' as const,
      };
      const at = (iso: string) => ({
        startsAt: new Date(iso),
        endsAt: new Date(new Date(iso).getTime() + 3_600_000),
      });
      await t.db.insert(bookings).values([
        { ...base, ...at('2026-03-10T15:00:00Z') },
        { ...base, ...at('2026-03-11T15:00:00Z'), status: 'COMPLETED' as const },
        { ...base, ...at('2026-03-12T15:00:00Z'), status: 'CANCELLED' as const },
        { ...base, ...at('2026-04-01T02:30:00Z') }, // 31/03 23:30 em SP → dentro
        { ...base, ...at('2026-04-01T03:30:00Z') }, // 01/04 00:30 em SP → fora
        { ...base, ...at('2026-02-20T15:00:00Z') }, // fora
      ]);
      await t.db.insert(recurringBookings).values([
        {
          spaceId: arena.id,
          courtId: court.id,
          userId: dono.id,
          sportId: base.sportId,
          weekday: 2,
          startTime: '19:00',
          durationMin: 60,
          peopleCount: 4,
          startsOn: '2026-01-01',
          status: 'ACTIVE',
        },
        {
          spaceId: arena.id,
          courtId: court.id,
          userId: dono.id,
          sportId: base.sportId,
          weekday: 3,
          startTime: '19:00',
          durationMin: 60,
          peopleCount: 4,
          startsOn: '2026-01-01',
          status: 'PAUSED',
        },
      ]);
      const lastSeen = new Date('2026-03-20T12:00:00Z');
      await t.db.update(sessions).set({ updatedAt: lastSeen }).where(eq(sessions.userId, dono.id));

      const res = await call(
        'get',
        '/v1/super/metrics/spaces?q=m%C3%A9trica&from=2026-03-01&to=2026-03-31',
      ).expect(200);
      expect(res.body.period).toEqual({ from: '2026-03-01', to: '2026-03-31' });
      const byId = new Map<string, Row>(res.body.items.map((m: Row) => [m.spaceId, m]));
      expect(byId.get(arena.id)).toMatchObject({
        name: 'Métrica Arena',
        bookings: 3,
        activeRecurring: 1,
        activeStudents: 0,
        attendances: 0,
        tournaments: 0,
        lastAccessAt: lastSeen.toISOString(),
      });
      expect(byId.get(vazia.id)).toMatchObject({
        bookings: 0,
        activeRecurring: 0,
        lastAccessAt: null,
      });
      await call('get', '/v1/super/metrics/spaces?from=2026-04-01&to=2026-03-01').expect(200);
    });

    it('padrão: 30 dias até hoje', async () => {
      const res = await call('get', '/v1/super/metrics/spaces').expect(200);
      const days =
        (Date.parse(`${res.body.period.to}T00:00:00Z`) -
          Date.parse(`${res.body.period.from}T00:00:00Z`)) /
        86_400_000;
      expect(days).toBe(29);
    });
  });

  describe('log de auditoria global (RF-SUPER-10)', () => {
    it('lista as ações do Super, mais recentes primeiro, com ator e espaço', async () => {
      const space = await createSpace(t.db, catalog, { name: 'Auditada', slug: 'auditada' });
      await call('post', `/v1/super/spaces/${space.id}/suspend`, { reason: 'Teste' }).expect(200);
      await call('post', `/v1/super/spaces/${space.id}/reactivate`).expect(200);

      const res = await call('get', `/v1/super/audit-logs?spaceId=${space.id}`).expect(200);
      expect(res.body.items.map((e: Row) => e.action)).toEqual([
        'super.space.reactivate',
        'super.space.suspend',
      ]);
      expect(res.body.items[0]).toMatchObject({
        actorId: admin.id,
        actorName: 'Super Teste',
        actingAsSuper: true,
        spaceId: space.id,
        spaceName: 'Auditada',
        entity: 'space',
        entityId: space.id,
        diff: { from: 'SUSPENDED', to: 'ACTIVE' },
      });
      expect(res.body.nextCursor).toBeNull();
    });

    it('filtra por ação (prefixo), ator, entidade, tipo de ator e período', async () => {
      const prefix = await call(
        'get',
        '/v1/super/audit-logs?action=super.catalog.&limit=100',
      ).expect(200);
      expect(prefix.body.items.length).toBeGreaterThan(0);
      expect(
        prefix.body.items.every((e: Row) => String(e.action).startsWith('super.catalog.')),
      ).toBe(true);

      const byEntity = await call('get', '/v1/super/audit-logs?entity=sport&limit=100').expect(200);
      expect(byEntity.body.items.every((e: Row) => e.entity === 'sport')).toBe(true);
      const other = await call('get', `/v1/super/audit-logs?actorId=${NIL_UUID}`).expect(200);
      expect(other.body.items).toEqual([]);
      const notSuper = await call('get', '/v1/super/audit-logs?actingAsSuper=false').expect(200);
      expect(notSuper.body.items.every((e: Row) => e.actingAsSuper === false)).toBe(true);
      const old = await call('get', '/v1/super/audit-logs?from=2020-01-01&to=2020-12-31').expect(
        200,
      );
      expect(old.body.items).toEqual([]);
      // O filtro por data é interpretado em America/Sao_Paulo; entre 21h e 0h de lá o dia UTC já virou.
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
        new Date(),
      );
      const recent = await call('get', `/v1/super/audit-logs?from=${today}&limit=1`).expect(200);
      expect(recent.body.items).toHaveLength(1);
      await call('get', '/v1/super/audit-logs?actingAsSuper=talvez').expect(400);
    });

    it('pagina por cursor sem repetir nem pular entradas', async () => {
      const all = await call('get', '/v1/super/audit-logs?limit=100').expect(200);
      const total = all.body.items.length;
      expect(total).toBeGreaterThan(5);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `limit=4${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await call('get', `/v1/super/audit-logs?${query}`).expect(200);
        seen.push(...page.body.items.map((e: Row) => e.id));
        cursor = page.body.nextCursor;
        pages += 1;
      } while (cursor && pages < 100);
      expect(seen).toEqual(all.body.items.map((e: Row) => e.id));
      expect(new Set(seen).size).toBe(total);

      const bad = await call('get', '/v1/super/audit-logs?cursor=xpto').expect(400);
      expect(bad.body.error.code).toBe('INVALID_CURSOR');
    });

    it('o log não tem escrita: o Super só lê', async () => {
      await call('post', '/v1/super/audit-logs', {}).expect(404);
      await call('delete', '/v1/super/audit-logs').expect(404);
      await t.db.update(spaces).set({ name: 'Auditada' }).where(eq(spaces.slug, 'auditada'));
    });
  });
});
