import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookings,
  courtSports,
  spacePhotos,
  spaceSettings,
  sports,
  users,
} from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { expectPgError, first } from '../db/helpers.js';
import {
  BH,
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  member,
  seedCatalog,
} from './fixtures.js';

describe('gestão do espaço pelo painel', () => {
  let t: TestApp;
  let catalog: Catalog;
  const geocoder = new FakeGeocoder();
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: geocoder },
        { provide: PhotoStorage, useValue: storage },
      ],
    });
    catalog = await seedCatalog(t.db);
  });
  afterAll(() => t.close());

  let n = 0;
  async function ownedSpace(options: Parameters<typeof createSpace>[2] = {}) {
    n += 1;
    const space = await createSpace(t.db, catalog, options);
    const owner = await member(t, `dono${n}@exemplo.com`, space.id, 'OWNER');
    const as = (user: SignedUp = owner) => ({
      get: (path: string) =>
        t.http().get(`/v1/manage/spaces/${space.id}${path}`).set('cookie', user.cookie),
      patch: (path: string, body: object) =>
        t
          .http()
          .patch(`/v1/manage/spaces/${space.id}${path}`)
          .set('cookie', user.cookie)
          .send(body),
      put: (path: string, body: object) =>
        t.http().put(`/v1/manage/spaces/${space.id}${path}`).set('cookie', user.cookie).send(body),
      post: (path: string, body: object) =>
        t.http().post(`/v1/manage/spaces/${space.id}${path}`).set('cookie', user.cookie).send(body),
      delete: (path: string) =>
        t.http().delete(`/v1/manage/spaces/${space.id}${path}`).set('cookie', user.cookie),
    });
    return { space, owner, api: as() };
  }

  describe('configurações (RF-SPACE-04, docs/02 seção 2.1)', () => {
    it('sem nada salvo, devolve os padrões do doc e o preço nulo', async () => {
      const { api } = await ownedSpace({ price: null });
      const res = await api.get('/settings').expect(200);
      expect(res.body).toEqual({
        pricePerHourCents: null,
        bookingMinDurationMin: 60,
        bookingMaxDurationMin: 180,
        bookingMinAdvanceMin: 60,
        bookingWindowDays: 30,
        cancellationDeadlineMin: 60,
        attendanceMode: 'AUTOMATIC',
        attendanceOpenBeforeMin: 1440,
        attendanceCloseBeforeMin: 60,
        attendanceCancelDeadlineMin: 120,
        pastDueBlockEnabled: true,
        pastDueBlockDays: 7,
        acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
      });
    });

    it('PATCH parcial grava o resultado completo e mantém o resto', async () => {
      const { space, api } = await ownedSpace({ price: null });
      const res = await api
        .patch('/settings', {
          pricePerHourCents: 15_000,
          bookingMinDurationMin: 90,
          acceptedPaymentMethods: ['PIX', 'CASH'],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        pricePerHourCents: 15_000,
        bookingMinDurationMin: 90,
        bookingMaxDurationMin: 180,
        acceptedPaymentMethods: ['PIX', 'CASH'],
      });
      const row = first(
        await t.db.select().from(spaceSettings).where(eq(spaceSettings.spaceId, space.id)),
      );
      expect(row).toMatchObject({
        pricePerHourCents: 15_000,
        bookingMaxDurationMin: 180,
        bookingWindowDays: 30,
      });

      await api.patch('/settings', { bookingWindowDays: 15 }).expect(200);
      const again = await api.get('/settings').expect(200);
      expect(again.body).toMatchObject({
        pricePerHourCents: 15_000,
        bookingMinDurationMin: 90,
        bookingWindowDays: 15,
      });
    });

    it('cria a linha de configurações se o espaço não tiver', async () => {
      const { space, api } = await ownedSpace();
      await t.db.delete(spaceSettings).where(eq(spaceSettings.spaceId, space.id));
      await api.patch('/settings', { pricePerHourCents: 9_000 }).expect(200);
      expect((await api.get('/settings')).body.pricePerHourCents).toBe(9_000);
    });

    it.each([
      [{ bookingMinDurationMin: 45 }, 'bookingMinDurationMin'],
      [{ bookingMaxDurationMin: 200 }, 'bookingMaxDurationMin'],
      [{ bookingMinDurationMin: 0 }, 'bookingMinDurationMin'],
      [{ pricePerHourCents: 99.5 }, 'pricePerHourCents'],
      [{ pricePerHourCents: -100 }, 'pricePerHourCents'],
      [{ pricePerHourCents: null }, 'pricePerHourCents'],
      // Decisão 27: o mensalista não tem valor mensal nem vencimento.
      [{ recurringMonthlyPriceCents: 40_000 }, ''],
      [{ recurringBillingDay: 10 }, ''],
      [{ attendanceMode: 'SOMETIMES' }, 'attendanceMode'],
      [{ acceptedPaymentMethods: [] }, 'acceptedPaymentMethods'],
      [{ acceptedPaymentMethods: ['BOLETO'] }, 'acceptedPaymentMethods.0'],
      [{ campoQueNaoExiste: 1 }, ''],
    ])('rejeita %j', async (body, field) => {
      const { api } = await ownedSpace();
      const res = await api.patch('/settings', body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      if (field)
        expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    });

    it('mínimo ≤ máximo vale contra o que já está salvo', async () => {
      const { api } = await ownedSpace();
      await api.patch('/settings', { bookingMaxDurationMin: 120 }).expect(200);
      const res = await api.patch('/settings', { bookingMinDurationMin: 150 }).expect(400);
      expect(res.body.error.details[0].field).toBe('bookingMaxDurationMin');
      await api.patch('/settings', { bookingMinDurationMin: 120 }).expect(200);
      await api
        .patch('/settings', { bookingMinDurationMin: 30, bookingMaxDurationMin: 30 })
        .expect(200);
    });

    it('lista de presença: fechamento antes da abertura', async () => {
      const { api } = await ownedSpace();
      await api
        .patch('/settings', { attendanceOpenBeforeMin: 60, attendanceCloseBeforeMin: 60 })
        .expect(400);
      await api
        .patch('/settings', { attendanceOpenBeforeMin: 120, attendanceCloseBeforeMin: 30 })
        .expect(200);
    });
  });

  describe('dados, endereço e geocodificação (RF-SPACE-01)', () => {
    const address = {
      street: 'Rua da Bahia',
      number: '1000',
      neighborhood: 'Centro',
      postalCode: '30160-011',
    };

    beforeEach(() => {
      geocoder.enabled = true;
      geocoder.failing = false;
      geocoder.byPostalCode.clear();
    });

    it('geocodifica o endereço e salva a localização', async () => {
      geocoder.byPostalCode.set('30160011', BH.center);
      const { api } = await ownedSpace({ location: null });
      const res = await api
        .patch('', {
          address,
          phone: '+5531999998888',
          whatsapp: '+5531988887777',
          instagram: '@arena',
          description: 'Areia boa',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        address: {
          street: 'Rua da Bahia',
          number: '1000',
          neighborhood: 'Centro',
          postalCode: '30160011',
          city: { name: 'Belo Horizonte', state: 'MG' },
        },
        location: BH.center,
        phone: '+5531999998888',
        instagram: 'arena',
        description: 'Areia boa',
      });
      expect(geocoder.calls.at(-1)).toEqual({
        ...address,
        postalCode: '30160011',
        city: 'Belo Horizonte',
        state: 'MG',
      });
    });

    it('endereço não encontrado: 422 e nada muda', async () => {
      const { api } = await ownedSpace();
      const res = await api.patch('', { address, description: 'não salva' }).expect(422);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
      expect((await api.get('')).body).toMatchObject({ description: null, location: BH.center });
    });

    it('provedor fora do ar: 503', async () => {
      geocoder.failing = true;
      const { api } = await ownedSpace();
      expect((await api.patch('', { address }).expect(503)).body.error.code).toBe(
        'GEOCODING_UNAVAILABLE',
      );
    });

    it('pino ajustado à mão dispensa a geocodificação; sem provedor, fica sem localização', async () => {
      const { api } = await ownedSpace();
      const calls = geocoder.calls.length;
      const res = await api.patch('', { address, location: BH.savassi }).expect(200);
      expect(res.body.location).toEqual(BH.savassi);
      expect(geocoder.calls.length).toBe(calls);

      geocoder.enabled = false;
      const other = await api.patch('', { address: { ...address, number: '2000' } }).expect(200);
      expect(other.body.location).toBeNull();
    });

    it('valida telefone, CEP e campos que o painel não edita', async () => {
      const { api } = await ownedSpace();
      await api.patch('', { phone: '31 99999-8888' }).expect(400);
      await api.patch('', { address: { ...address, postalCode: '123' } }).expect(400);
      await api.patch('', { name: 'Outro nome' }).expect(400);
      await api.patch('', { status: 'SUSPENDED' }).expect(400);
    });

    it('infraestrutura e horário de funcionamento', async () => {
      const { api } = await ownedSpace();
      const ids = [catalog.amenity('wi-fi').id, catalog.amenity('banheiro').id];
      const res = await api.put('/amenities', { amenityIds: ids }).expect(200);
      expect(res.body.amenities.map((a: { slug: string }) => a.slug)).toEqual([
        'banheiro',
        'wi-fi',
      ]);
      await api.put('/amenities', { amenityIds: [ids[0]] }).expect(200);
      expect((await api.get('')).body.amenities).toHaveLength(1);
      const unknown = await api
        .put('/amenities', { amenityIds: ['0192f3a4-5b6c-7d8e-9f01-23456789abcd'] })
        .expect(422);
      expect(unknown.body.error.code).toBe('UNKNOWN_AMENITY');

      const hours = [
        { weekday: 6, opensAt: '08:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '18:00', closesAt: '01:00' },
        { weekday: 1, opensAt: '06:00', closesAt: '10:00' },
      ];
      const saved = await api.put('/opening-hours', { openingHours: hours }).expect(200);
      expect(saved.body.openingHours).toEqual([
        { weekday: 1, opensAt: '06:00', closesAt: '10:00' },
        { weekday: 1, opensAt: '18:00', closesAt: '01:00' },
        { weekday: 6, opensAt: '08:00', closesAt: '12:00' },
      ]);
      await api
        .put('/opening-hours', {
          openingHours: [...hours, { weekday: 1, opensAt: '09:00', closesAt: '11:00' }],
        })
        .expect(400);
      await api.put('/opening-hours', { openingHours: [] }).expect(200);
      expect((await api.get('')).body.openingHours).toEqual([]);
    });

    it('showcase indica o que falta para aparecer na vitrine (RN-SPACE-01)', async () => {
      const { api } = await ownedSpace({
        price: null,
        courts: [{ status: 'MAINTENANCE', sports: ['futevolei'] }],
      });
      expect((await api.get('')).body.showcase).toEqual({
        visible: false,
        missing: ['ACTIVE_COURT', 'PRICE_PER_HOUR'],
      });
    });
  });

  describe('quadras (RF-SPACE-03)', () => {
    it('CRUD com esportes, coberta e status; a capacidade é o padrão do esporte (decisão 51)', async () => {
      const { api } = await ownedSpace({ courts: [] });
      const fut = catalog.sport('futevolei').id;
      const bt = catalog.sport('beach-tennis').id;

      const created = await api
        .post('/courts', {
          name: 'Quadra Central',
          covered: true,
          sportIds: [fut, bt],
        })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        name: 'Quadra Central',
        covered: true,
        status: 'ACTIVE',
        sports: [
          { sportId: bt, slug: 'beach-tennis', name: 'Beach Tennis', maxPlayers: 20 },
          { sportId: fut, slug: 'futevolei', name: 'Futevôlei', maxPlayers: 20 },
        ],
      });
      const id = created.body.id;

      const updated = await api
        .patch(`/courts/${id}`, { status: 'MAINTENANCE', sportIds: [bt] })
        .expect(200);
      expect(updated.body).toMatchObject({
        status: 'MAINTENANCE',
        covered: true,
        sports: [{ slug: 'beach-tennis', maxPlayers: 20 }],
      });

      expect((await api.get('/courts')).body.items).toHaveLength(1);
      await api.get(`/courts/${id}`).expect(200);
      await api.delete(`/courts/${id}`).expect(204);
      await api.get(`/courts/${id}`).expect(404);
      await api.get('/courts/nao-e-uuid').expect(404);
    });

    it('capacidade: não vem do cadastro, segue o padrão do esporte e o limite de 20', async () => {
      const { api } = await ownedSpace({ courts: [] });
      const sport = async (slug: string, defaultMaxPlayers: number | null) =>
        first(
          await t.db
            .insert(sports)
            .values({ slug, name: slug, defaultMaxPlayers })
            .returning({ id: sports.id }),
        ).id;
      const padel = await sport('padel-cadastro', 4);
      const semPadrao = await sport('esporte-sem-padrao', null);
      const acimaDoLimite = await sport('esporte-acima-do-limite', 30);

      const created = await api
        .post('/courts', { name: 'Padrões', sportIds: [padel, semPadrao, acimaDoLimite] })
        .expect(201);
      const capacity = (id: string) =>
        created.body.sports.find((s: { sportId: string }) => s.sportId === id).maxPlayers;
      expect(capacity(padel)).toBe(4);
      expect(capacity(semPadrao)).toBe(20);
      expect(capacity(acimaDoLimite)).toBe(20);

      // `maxPlayers` e o formato antigo não existem mais, no cadastro nem na edição.
      await api.post('/courts', { name: 'Antigo', sports: [{ sportId: padel }] }).expect(400);
      await api.post('/courts', { name: 'Antigo', sportIds: [padel], maxPlayers: 8 }).expect(400);
      await api
        .patch(`/courts/${created.body.id}`, { sports: [{ sportId: padel, maxPlayers: 8 }] })
        .expect(400);
    });

    it('nome único no espaço, esporte do catálogo', async () => {
      const { api } = await ownedSpace({ courts: [] });
      const sportId = catalog.sport('futevolei').id;
      await api.post('/courts', { name: 'A', sportIds: [sportId] }).expect(201);
      expect(
        (await api.post('/courts', { name: 'A', sportIds: [sportId] }).expect(409)).body.error.code,
      ).toBe('COURT_NAME_TAKEN');
      await api.post('/courts', { name: 'B', sportIds: [] }).expect(400);
      const unknown = await api
        .post('/courts', {
          name: 'B',
          sportIds: ['0192f3a4-5b6c-7d8e-9f01-23456789abcd'],
        })
        .expect(422);
      expect(unknown.body.error.code).toBe('UNKNOWN_SPORT');
    });

    it('o banco também limita a 20 jogadores (decisão 18)', async () => {
      const { space } = await ownedSpace();
      const court = first(
        await t.db.query.courts.findMany({ where: (c, { eq }) => eq(c.spaceId, space.id) }),
      );
      const err = await expectPgError(
        t.db.update(courtSports).set({ maxPlayers: 21 }).where(eq(courtSports.courtId, court.id)),
      );
      expect(err).toMatchObject({ code: '23514', constraint: 'court_sports_max_players_range' });
    });

    it('quadra com reserva não pode ser excluída (409)', async () => {
      const { space, owner, api } = await ownedSpace();
      const court = first(
        await t.db.query.courts.findMany({ where: (c, { eq }) => eq(c.spaceId, space.id) }),
      );
      const organizer = first(await t.db.select().from(users).where(eq(users.id, owner.id)));
      const startsAt = new Date('2026-11-02T10:00:00Z');
      await t.db.insert(bookings).values({
        spaceId: space.id,
        courtId: court.id,
        organizerUserId: organizer.id,
        sportId: catalog.sport('futevolei').id,
        startsAt,
        endsAt: new Date('2026-11-02T11:00:00Z'),
        durationMin: 60,
        peopleCount: 4,
        pricePerHourCents: 10_000,
        priceCents: 10_000,
        source: 'APP',
      });
      const res = await api.delete(`/courts/${court.id}`).expect(409);
      expect(res.body.error.code).toBe('COURT_HAS_BOOKINGS');
    });
  });

  describe('fotos (upload pré-assinado no storage)', () => {
    /** Pede a URL declarando 1000 bytes e "envia" `size` bytes (o R2 não confere o tamanho). */
    async function upload(api: Awaited<ReturnType<typeof ownedSpace>>['api'], size = 1000) {
      const res = await api
        .post('/photos/uploads', { contentType: 'image/jpeg', size: 1000 })
        .expect(201);
      storage.upload(res.body.key, size);
      return res.body.key as string;
    }

    it('pede a URL, envia, registra, reordena (capa = primeira) e remove', async () => {
      const { space, api } = await ownedSpace();
      const presign = await api
        .post('/photos/uploads', { contentType: 'image/webp', size: 2048 })
        .expect(201);
      expect(presign.body).toMatchObject({
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
        key: expect.stringMatching(
          new RegExp(`^uploads/spaces/${space.id}/photos/[0-9a-f-]{36}\\.webp$`),
        ),
      });
      // Sem o upload, não registra.
      expect(
        (await api.post('/photos', { key: presign.body.key }).expect(422)).body.error.code,
      ).toBe('PHOTO_NOT_UPLOADED');

      const keys = [await upload(api), await upload(api), await upload(api)] as const;
      const photos = [];
      for (const key of keys) {
        photos.push(
          (await api.post('/photos', { key, blurhash: 'LEHV6nWB2yk8' }).expect(201)).body,
        );
      }
      expect(photos.map((p) => p.position)).toEqual([0, 1, 2]);
      // Publicada numa cópia, fora do alcance da URL pré-assinada; o upload é apagado.
      expect(photos[0].url).toBe(`https://fotos.test/${storage.publishedOf(keys[0])}`);
      // Chave publicada nova a cada registro: `<uuid do upload>-<uuid novo>.<ext>`.
      const uploadUuid = keys[0]
        .split('/')
        .at(-1)
        ?.replace(/\.jpg$/, '');
      expect(storage.publishedOf(keys[0])).toMatch(
        new RegExp(`^spaces/${space.id}/photos/${uploadUuid}-[0-9a-f-]{36}\\.jpg$`),
      );
      expect(storage.objects.has(keys[0])).toBe(false);
      // Registrar de novo, mesmo com outro arquivo regravado pela URL, não toca o publicado.
      storage.upload(keys[0], 0, 'text/html');
      expect((await api.post('/photos', { key: keys[0] }).expect(409)).body.error.code).toBe(
        'PHOTO_ALREADY_ADDED',
      );
      expect(storage.objects.get(storage.publishedOf(keys[0]))).toEqual({
        size: 1000,
        contentType: 'image/jpeg',
      });
      expect(storage.deleted).not.toContain(storage.publishedOf(keys[0]));
      // A chave publicada não é aceita como chave de upload.
      expect(
        (await api.post('/photos', { key: storage.publishedOf(keys[0]) }).expect(422)).body.error
          .code,
      ).toBe('INVALID_PHOTO_KEY');

      const order = [photos[2].id, photos[0].id, photos[1].id];
      const reordered = await api.put('/photos/order', { photoIds: order }).expect(200);
      expect(reordered.body.items.map((p: { id: string }) => p.id)).toEqual(order);
      await api.put('/photos/order', { photoIds: order.slice(0, 2) }).expect(422);
      await api.put('/photos/order', { photoIds: [order[0], order[0], order[1]] }).expect(422);

      await api.delete(`/photos/${photos[2].id}`).expect(204);
      expect(storage.deleted).toContain(storage.publishedOf(keys[2]));
      const after = (await api.get('')).body.photos;
      expect(after.map((p: { id: string; position: number }) => [p.id, p.position])).toEqual([
        [photos[0].id, 0],
        [photos[1].id, 1],
      ]);
      await api.delete(`/photos/${photos[2].id}`).expect(404);
    });

    it('chave de outro espaço, arquivo grande demais e tipo não aceito', async () => {
      const a = await ownedSpace();
      const b = await ownedSpace();
      const keyOfB = await upload(b.api);
      expect((await a.api.post('/photos', { key: keyOfB }).expect(422)).body.error.code).toBe(
        'INVALID_PHOTO_KEY',
      );
      expect(
        (await a.api.post('/photos', { key: '../segredo.jpg' }).expect(422)).body.error.code,
      ).toBe('INVALID_PHOTO_KEY');

      const big = await upload(a.api, 11 * 1024 * 1024);
      expect((await a.api.post('/photos', { key: big }).expect(422)).body.error.code).toBe(
        'PHOTO_TOO_LARGE',
      );
      expect(storage.deleted).toContain(big);
      expect(storage.deleted).toContain(storage.publishedOf(big));

      await a.api.post('/photos/uploads', { contentType: 'image/gif', size: 100 }).expect(400);
      await a.api
        .post('/photos/uploads', { contentType: 'image/jpeg', size: 11 * 1024 * 1024 })
        .expect(400);
    });

    it('confere tipo e tamanho reais no storage e apaga o objeto inválido sem gravar', async () => {
      const { api } = await ownedSpace();
      const cases = [
        { size: 1000, contentType: 'image/png', code: 'INVALID_PHOTO_FILE' },
        { size: 1000, contentType: 'text/html', code: 'INVALID_PHOTO_FILE' },
        { size: 1000, contentType: null, code: 'INVALID_PHOTO_FILE' },
        { size: 0, contentType: 'image/jpeg', code: 'INVALID_PHOTO_FILE' },
        { size: 10 * 1024 * 1024 + 1, contentType: 'image/jpeg', code: 'PHOTO_TOO_LARGE' },
      ];
      for (const { size, contentType, code } of cases) {
        const presign = await api
          .post('/photos/uploads', { contentType: 'image/jpeg', size: 1000 })
          .expect(201);
        const key = presign.body.key as string;
        storage.upload(key, size, contentType);
        const res = await api.post('/photos', { key }).expect(422);
        expect(res.body.error.code, JSON.stringify({ size, contentType })).toBe(code);
        expect(storage.deleted).toContain(key);
        expect(await storage.head(key)).toBeNull();
        expect(await storage.head(storage.publishedOf(key))).toBeNull();
      }
      expect((await api.get('')).body.photos).toEqual([]);

      // No limite exato e com o tipo certo, grava.
      const ok = await api
        .post('/photos/uploads', { contentType: 'image/png', size: 1000 })
        .expect(201);
      storage.upload(ok.body.key, 10 * 1024 * 1024);
      await api.post('/photos', { key: ok.body.key }).expect(201);
    });

    it('limite de 20 fotos por espaço', async () => {
      const { api } = await ownedSpace({ photos: 20 });
      expect(
        (await api.post('/photos/uploads', { contentType: 'image/jpeg', size: 100 }).expect(409))
          .body.error.code,
      ).toBe('PHOTO_LIMIT_REACHED');
    });

    it('dois registros da mesma chave em paralelo: PHOTO_ALREADY_ADDED e o arquivo fica', async () => {
      const { api } = await ownedSpace();
      // O outro pedido termina antes da cópia deste (upload já apagado).
      const key = await upload(api);
      storage.beforeCopy = async () => {
        await api.post('/photos', { key }).expect(201);
      };
      expect((await api.post('/photos', { key }).expect(409)).body.error.code).toBe(
        'PHOTO_ALREADY_ADDED',
      );
      expect(storage.objects.has(storage.publishedOf(key))).toBe(true);

      // O outro pedido termina entre a cópia deste e a conferência, que então falha.
      const other = await upload(api);
      storage.afterCopy = async () => {
        await api.post('/photos', { key: other }).expect(201);
        storage.failHead = new Error('storage fora do ar');
      };
      await api.post('/photos', { key: other }).expect(500);
      expect(storage.objects.has(storage.publishedOf(other))).toBe(true);
      expect((await api.get('')).body.photos).toHaveLength(2);
    });

    it('limite atingido entre o pedido da URL e o registro: apaga a cópia publicada', async () => {
      const { space, api } = await ownedSpace({ photos: 19 });
      const key = await upload(api);
      await t.db
        .insert(spacePhotos)
        .values({ spaceId: space.id, url: 'https://fotos.test/outra.jpg', position: 19 });
      expect((await api.post('/photos', { key }).expect(409)).body.error.code).toBe(
        'PHOTO_LIMIT_REACHED',
      );
      expect(await storage.head(key)).toBeNull();
      expect(await storage.head(storage.publishedOf(key))).toBeNull();
    });

    it('fotos externas (seed de demonstração): reordena e remove sem apagar nada no storage', async () => {
      const { space, api } = await ownedSpace();
      const external = [
        'https://images.unsplash.com/photo-1-a?w=1600&q=80&auto=format&fit=crop',
        'https://images.unsplash.com/photo-2-b?w=1600&q=80&auto=format&fit=crop',
      ];
      await t.db
        .insert(spacePhotos)
        .values(external.map((url, position) => ({ spaceId: space.id, url, position })));
      // A enviada pelo painel entra no fim da galeria, depois das externas.
      const key = await upload(api);
      const uploaded = (await api.post('/photos', { key }).expect(201)).body;
      expect(uploaded.position).toBe(2);
      const photos: { id: string; url: string }[] = (await api.get('')).body.photos;
      expect(photos.map((p) => p.url)).toEqual([...external, uploaded.url]);
      await api
        .put('/photos/order', { photoIds: [photos[1]?.id, uploaded.id, photos[0]?.id] })
        .expect(200);

      const before = storage.deleted.length;
      await api.delete(`/photos/${photos[0]?.id}`).expect(204);
      await api.delete(`/photos/${photos[1]?.id}`).expect(204);
      // URL fora do storage (R2_PUBLIC_URL): nenhuma tentativa de apagar no bucket.
      expect(storage.deleted.slice(before)).toEqual([]);
      const after = (await api.get('')).body.photos;
      expect(after.map((p: { id: string; position: number }) => [p.id, p.position])).toEqual([
        [uploaded.id, 0],
      ]);
      // A do bucket continua sendo apagada ao remover.
      await api.delete(`/photos/${uploaded.id}`).expect(204);
      expect(storage.deleted.slice(before)).toEqual([storage.publishedOf(key)]);
    });

    it('sem storage configurado: 503', async () => {
      const { api } = await ownedSpace();
      storage.enabled = false;
      try {
        expect(
          (await api.post('/photos/uploads', { contentType: 'image/jpeg', size: 100 }).expect(503))
            .body.error.code,
        ).toBe('STORAGE_UNAVAILABLE');
      } finally {
        storage.enabled = true;
      }
    });
  });
});
