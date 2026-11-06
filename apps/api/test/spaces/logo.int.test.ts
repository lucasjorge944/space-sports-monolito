import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, favorites, spaces } from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { SpaceLogoService } from '../../src/spaces/space-logo.service.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import { bearer, superUser } from '../super/fixtures.js';
import {
  type Catalog,
  createSpace,
  FakeGeocoder,
  FakeStorage,
  member,
  seedCatalog,
  setSpaceStatus,
} from './fixtures.js';

// RF-SPACE-11 (decisão 44): logo do espaço, enviada pela gestão no fluxo pré-assinado das fotos.

/** JPEG real 150x150 (logo de parceiro). */
const SQUARE_JPEG = new Uint8Array(
  readFileSync(new URL('../../src/db/demo-assets/duna-sports.jpg', import.meta.url)),
);
/** PNG 3x2 (não quadrado), gerado com o Pillow. */
const WIDE_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGNkDqllYGBgYGBgYoABAA6qANj4KocdAAAAAElFTkSuQmCC',
    'base64',
  ),
);
/** WebP 4x4 sem perdas. */
const SQUARE_WEBP = new Uint8Array(
  Buffer.from('UklGRiIAAABXRUJQVlA4TBUAAAAvA8AAAAdQKoUAAqCgaV//Y0RE/wMA', 'base64'),
);

describe('logo do espaço (RF-SPACE-11)', () => {
  let t: TestApp;
  let catalog: Catalog;
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestApp({
      providers: [
        { provide: Geocoder, useValue: new FakeGeocoder() },
        { provide: PhotoStorage, useValue: storage },
      ],
    });
    catalog = await seedCatalog(t.db);
  });
  afterAll(() => t.close());

  let n = 0;
  async function ownedSpace() {
    n += 1;
    const space = await createSpace(t.db, catalog, { name: `Arena Logo ${n}` });
    const owner = await member(t, `dono-logo${n}@exemplo.com`, space.id, 'OWNER');
    return { space, owner, api: apiFor(space.id, owner) };
  }

  const apiFor = (spaceId: string, user: SignedUp, headers: Record<string, string> = {}) => {
    const base = `/v1/manage/spaces/${spaceId}`;
    const auth = (req: ReturnType<ReturnType<TestApp['http']>['get']>) => {
      req.set(...bearer(user));
      for (const [name, value] of Object.entries(headers)) req.set(name, value);
      return req;
    };
    return {
      get: () => auth(t.http().get(base)),
      presign: (body: object = { contentType: 'image/jpeg', size: SQUARE_JPEG.length }) =>
        auth(t.http().post(`${base}/logo/uploads`)).send(body),
      set: (key: string) => auth(t.http().put(`${base}/logo`)).send({ key }),
      remove: () => auth(t.http().delete(`${base}/logo`)),
    };
  };

  /** Pede a URL, "envia" o arquivo e devolve a chave. */
  async function uploaded(
    api: ReturnType<typeof apiFor>,
    body = SQUARE_JPEG,
    contentType?: string,
  ) {
    const presign = await api
      .presign({ contentType: contentType ?? 'image/jpeg', size: body.length })
      .expect(201);
    storage.uploadBody(presign.body.key, body);
    return presign.body.key as string;
  }

  const audits = (spaceId: string, action: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.spaceId, spaceId), eq(auditLogs.action, action)));

  it('pede a URL, registra a logo e devolve logoUrl no espaço do painel', async () => {
    const { space, owner, api } = await ownedSpace();
    expect((await api.get().expect(200)).body.logoUrl).toBeNull();

    const presign = await api.presign().expect(201);
    expect(presign.body).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      key: expect.stringMatching(
        new RegExp(`^uploads/spaces/${space.id}/logo/[0-9a-f-]{36}\\.jpg$`),
      ),
    });
    expect((await api.set(presign.body.key).expect(422)).body.error.code).toBe('LOGO_NOT_UPLOADED');

    storage.uploadBody(presign.body.key, SQUARE_JPEG);
    const res = await api.set(presign.body.key).expect(200);
    // Publicada numa cópia, fora do alcance da URL pré-assinada; o upload é apagado.
    // Chave publicada nova a cada registro: `<uuid do upload>-<uuid novo>.<ext>`.
    const published = storage.publishedOf(presign.body.key);
    const uploadUuid = presign.body.key
      .split('/')
      .at(-1)
      .replace(/\.jpg$/, '');
    expect(published).toMatch(
      new RegExp(`^spaces/${space.id}/logo/${uploadUuid}-[0-9a-f-]{36}\\.jpg$`),
    );
    expect(res.body.logoUrl).toBe(`https://fotos.test/${published}`);
    expect(res.body.photos).toEqual([]);
    expect(storage.objects.has(published)).toBe(true);
    expect(storage.objects.has(presign.body.key)).toBe(false);
    expect(storage.reads).toContainEqual({ key: published, maxBytes: 2 * 1024 * 1024 });

    const [entry] = await audits(space.id, 'space.logo.update');
    expect(entry).toMatchObject({
      actorId: owner.id,
      actingAsSuper: false,
      entity: 'space',
      entityId: space.id,
      diff: { before: null, after: res.body.logoUrl },
    });
  });

  it('trocar apaga o arquivo anterior; remover apaga o atual e é idempotente', async () => {
    const { space, api } = await ownedSpace();
    const firstKey = await uploaded(api);
    await api.set(firstKey).expect(200);

    const secondKey = await uploaded(api, SQUARE_WEBP, 'image/webp');
    const swapped = await api.set(secondKey).expect(200);
    expect(swapped.body.logoUrl).toBe(`https://fotos.test/${storage.publishedOf(secondKey)}`);
    expect(storage.deleted).toContain(storage.publishedOf(firstKey));
    expect(storage.objects.has(storage.publishedOf(secondKey))).toBe(true);

    // Registrar de novo a mesma chave não muda nada nem apaga o arquivo.
    await api.set(secondKey).expect(200);
    expect(storage.objects.has(storage.publishedOf(secondKey))).toBe(true);
    expect(await audits(space.id, 'space.logo.update')).toHaveLength(2);

    await api.remove().expect(204);
    expect(storage.deleted).toContain(storage.publishedOf(secondKey));
    expect((await api.get().expect(200)).body.logoUrl).toBeNull();
    const [removed] = await audits(space.id, 'space.logo.remove');
    expect(removed?.diff).toEqual({
      before: `https://fotos.test/${storage.publishedOf(secondKey)}`,
    });

    await api.remove().expect(204);
    expect(await audits(space.id, 'space.logo.remove')).toHaveLength(1);
  });

  it('regravar o arquivo pela URL pré-assinada não alcança a logo publicada', async () => {
    const { space, api } = await ownedSpace();
    const key = await uploaded(api);
    const logoUrl = (await api.set(key).expect(200)).body.logoUrl;
    const published = storage.publishedOf(key);

    // A URL ainda vale: um arquivo inválido regravado na chave de upload e registrado de novo.
    storage.uploadBody(key, WIDE_PNG, 'image/jpeg');
    await api.set(key).expect(200);
    expect(storage.bodies.get(published)).toEqual(SQUARE_JPEG);
    expect(storage.deleted).not.toContain(published);
    expect((await api.get().expect(200)).body.logoUrl).toBe(logoUrl);
    expect(await audits(space.id, 'space.logo.update')).toHaveLength(1);

    // A chave publicada não é aceita como chave de upload.
    expect((await api.set(published).expect(422)).body.error.code).toBe('INVALID_LOGO_KEY');
    expect(storage.objects.has(published)).toBe(true);
  });

  it('falha depois da cópia (storage ou transação): apaga a cópia publicada', async () => {
    const { space, api } = await ownedSpace();
    const key = await uploaded(api);
    storage.failHead = new Error('storage fora do ar');
    await api.set(key).expect(500);
    expect(storage.objects.has(key)).toBe(false);
    expect(storage.objects.has(storage.publishedOf(key))).toBe(false);

    // Transação falhando: a auditoria com um ator inexistente viola a FK.
    const again = await uploaded(api);
    const service = t.app.get(SpaceLogoService);
    await expect(
      service.set(space.id, '00000000-0000-4000-8000-000000000000', { key: again }),
    ).rejects.toThrow();
    expect(storage.objects.has(again)).toBe(false);
    expect(storage.objects.has(storage.publishedOf(again))).toBe(false);
    expect((await api.get().expect(200)).body.logoUrl).toBeNull();
  });

  it('dois registros da mesma chave em paralelo: cada um confere a própria cópia', async () => {
    const { space, api } = await ownedSpace();
    const key = await uploaded(api);
    // O outro pedido termina entre a cópia deste e a conferência, que então falha.
    storage.afterCopy = async () => {
      await api.set(key).expect(200);
      storage.failHead = new Error('storage fora do ar');
    };
    await api.set(key).expect(500);
    const [mine, other] = storage.copies.filter((c) => c.source === key).map((c) => c.target);
    // Cópias diferentes: a do pedido que falhou é apagada, a gravada fica.
    expect(mine).not.toBe(other);
    expect(storage.objects.has(mine as string)).toBe(false);
    expect(storage.objects.has(other as string)).toBe(true);
    expect((await api.get().expect(200)).body.logoUrl).toBe(`https://fotos.test/${other}`);

    // O outro pedido termina antes da cópia deste (upload já apagado): nada muda.
    const second = await uploaded(api);
    storage.beforeCopy = async () => {
      await api.set(second).expect(200);
    };
    await api.set(second).expect(200);
    expect(storage.objects.has(storage.publishedOf(second))).toBe(true);
    expect(await audits(space.id, 'space.logo.update')).toHaveLength(2);
  });

  it('confere o arquivo real: tamanho, tipo pelos bytes e imagem quadrada; o inválido é apagado', async () => {
    const { space, api } = await ownedSpace();
    const jpeg = 'image/jpeg';
    const cases: { requested: string; stored: string | null; body: Uint8Array; code: string }[] = [
      // Declarado JPEG, mas os bytes são de PNG (e vice-versa).
      { requested: jpeg, stored: jpeg, body: WIDE_PNG, code: 'INVALID_LOGO_FILE' },
      { requested: 'image/png', stored: 'image/png', body: SQUARE_JPEG, code: 'INVALID_LOGO_FILE' },
      {
        requested: jpeg,
        stored: jpeg,
        body: new TextEncoder().encode('<html></html>'),
        code: 'INVALID_LOGO_FILE',
      },
      { requested: jpeg, stored: jpeg, body: new Uint8Array(), code: 'INVALID_LOGO_FILE' },
      // Content-Type do objeto diferente do pedido, ou ausente.
      { requested: jpeg, stored: 'image/png', body: SQUARE_JPEG, code: 'INVALID_LOGO_FILE' },
      { requested: jpeg, stored: null, body: SQUARE_JPEG, code: 'INVALID_LOGO_FILE' },
      {
        requested: jpeg,
        stored: jpeg,
        body: new Uint8Array(2 * 1024 * 1024 + 1),
        code: 'LOGO_TOO_LARGE',
      },
    ];
    for (const [index, { requested, stored, body, code }] of cases.entries()) {
      const presign = await api.presign({ contentType: requested, size: 1000 }).expect(201);
      storage.uploadBody(presign.body.key, body, stored);
      const res = await api.set(presign.body.key).expect(422);
      expect(res.body.error.code, `caso ${index}`).toBe(code);
      expect(storage.objects.has(presign.body.key)).toBe(false);
      expect(storage.objects.has(storage.publishedOf(presign.body.key))).toBe(false);
    }

    const wide = await uploaded(api, WIDE_PNG, 'image/png');
    const res = await api.set(wide).expect(422);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_LOGO_FILE',
      details: { width: 3, height: 2 },
    });
    expect((await api.get().expect(200)).body.logoUrl).toBeNull();
    expect(await audits(space.id, 'space.logo.update')).toHaveLength(0);

    // Pedido fora do limite ou de tipo não aceito nem gera a URL.
    await api.presign({ contentType: 'image/gif', size: 100 }).expect(400);
    await api.presign({ contentType: 'image/png', size: 2 * 1024 * 1024 + 1 }).expect(400);
  });

  it('chave de outro espaço, da galeria ou fora do formato: INVALID_LOGO_KEY', async () => {
    const a = await ownedSpace();
    const b = await ownedSpace();
    const keyOfB = await uploaded(b.api);
    const photoKey = `uploads/spaces/${a.space.id}/photos/00000000-0000-4000-8000-000000000000.jpg`;
    // Formato antigo (antes do S3): `uploads/<espaço>/logo/…`, sem o `spaces/`.
    const legacyKey = `uploads/${a.space.id}/logo/00000000-0000-4000-8000-000000000000.jpg`;
    for (const key of [
      keyOfB,
      photoKey,
      legacyKey,
      '../segredo.jpg',
      `spaces/${a.space.id}/logo/x.jpg`,
    ]) {
      expect((await a.api.set(key).expect(422)).body.error.code).toBe('INVALID_LOGO_KEY');
    }
    expect(storage.objects.has(keyOfB)).toBe(true);
  });

  it('sem storage configurado: STORAGE_UNAVAILABLE', async () => {
    const { api } = await ownedSpace();
    storage.enabled = false;
    try {
      expect((await api.presign().expect(503)).body.error.code).toBe('STORAGE_UNAVAILABLE');
      expect(
        (await api.set('spaces/x/logo/00000000-0000-4000-8000-000000000000.jpg').expect(503)).body
          .error.code,
      ).toBe('STORAGE_UNAVAILABLE');
    } finally {
      storage.enabled = true;
    }
  });

  it('só Dono e Admin; espaço suspenso fica só leitura', async () => {
    const { space, api } = await ownedSpace();
    const admin = await member(t, `admin-logo${n}@exemplo.com`, space.id, 'ADMIN');
    const key = await uploaded(apiFor(space.id, admin));
    await apiFor(space.id, admin).set(key).expect(200);

    for (const role of ['TEACHER'] as const) {
      const user = await member(t, `${role.toLowerCase()}-logo${n}@exemplo.com`, space.id, role);
      const other = apiFor(space.id, user);
      for (const res of [await other.presign(), await other.set(key), await other.remove()]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
      }
    }

    await setSpaceStatus(t.db, space.id, 'SUSPENDED');
    for (const res of [await api.presign(), await api.set(key), await api.remove()]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SPACE_READ_ONLY');
    }
    expect((await api.get().expect(200)).body.logoUrl).toBe(
      `https://fotos.test/${storage.publishedOf(key)}`,
    );
  });

  it('modo suporte do Super: troca a logo como Dono, auditado com a sessão de suporte', async () => {
    const { space } = await ownedSpace();
    const admin = await superUser(t, `super-logo${n}@exemplo.com`);
    // Sem sessão de suporte o Super não tem acesso.
    expect((await apiFor(space.id, admin).presign()).status).toBe(403);

    const session = await t
      .http()
      .post(`/v1/super/spaces/${space.id}/support-sessions`)
      .set(...bearer(admin))
      .send({ reason: 'Trocar a logo a pedido do dono' })
      .expect(201);
    const api = apiFor(space.id, admin, { 'x-support-session': session.body.id });
    const key = await uploaded(api);
    const res = await api.set(key).expect(200);
    expect(res.headers['x-support-mode']).toBe('true');

    const [entry] = await audits(space.id, 'space.logo.update');
    expect(entry).toMatchObject({
      actorId: admin.id,
      actingAsSuper: true,
      diff: expect.objectContaining({ supportSessionId: session.body.id }),
    });
    await api.remove().expect(204);
    const [removed] = await audits(space.id, 'space.logo.remove');
    expect(removed).toMatchObject({ actorId: admin.id, actingAsSuper: true });
  });

  it('logoUrl nas respostas do jogador, da equipe e do Super (nula sem logo)', async () => {
    const { space, owner, api } = await ownedSpace();
    const without = await createSpace(t.db, catalog, { name: 'Arena Sem Logo' });
    const key = await uploaded(api);
    const logoUrl = (await api.set(key).expect(200)).body.logoUrl;
    await t.db.insert(favorites).values([
      { userId: owner.id, spaceId: space.id },
      { userId: owner.id, spaceId: without.id },
    ]);

    const search = await t.http().get('/v1/spaces?limit=50').expect(200);
    const card = (id: string) => search.body.items.find((item: { id: string }) => item.id === id);
    expect(card(space.id).logoUrl).toBe(logoUrl);
    expect(card(without.id).logoUrl).toBeNull();

    // Mapa: a mesma busca com lat/lng.
    const map = await t.http().get('/v1/spaces?lat=-19.9191&lng=-43.9386&limit=50').expect(200);
    expect(map.body.items.find((i: { id: string }) => i.id === space.id).logoUrl).toBe(logoUrl);

    expect((await t.http().get(`/v1/spaces/${space.slug}`).expect(200)).body.logoUrl).toBe(logoUrl);
    expect((await t.http().get(`/v1/spaces/${without.slug}`).expect(200)).body.logoUrl).toBeNull();

    const favs = await t
      .http()
      .get('/v1/me/favorites')
      .set(...bearer(owner))
      .expect(200);
    expect(favs.body.items.map((i: { logoUrl: string | null }) => i.logoUrl)).toEqual(
      expect.arrayContaining([logoUrl, null]),
    );

    const me = await t
      .http()
      .get('/v1/me')
      .set(...bearer(owner))
      .expect(200);
    expect(me.body.memberships[0].space).toMatchObject({ id: space.id, logoUrl });
    const staff = await t
      .http()
      .get('/v1/me/staff-spaces')
      .set(...bearer(owner))
      .expect(200);
    expect(staff.body.items[0].space).toMatchObject({ id: space.id, logoUrl });

    const admin = await superUser(t, 'super-respostas@exemplo.com');
    const list = await t
      .http()
      .get(`/v1/super/spaces?q=${encodeURIComponent(space.name)}`)
      .set(...bearer(admin))
      .expect(200);
    expect(list.body.items[0]).toMatchObject({ id: space.id, logoUrl });
    const detail = await t
      .http()
      .get(`/v1/super/spaces/${space.id}`)
      .set(...bearer(admin))
      .expect(200);
    expect(detail.body.logoUrl).toBe(logoUrl);

    const row = first(await t.db.select().from(spaces).where(eq(spaces.id, space.id)));
    expect(row.logoUrl).toBe(logoUrl);
  });
});
