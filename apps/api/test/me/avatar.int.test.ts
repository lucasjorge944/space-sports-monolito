import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, users } from '../../src/db/schema/index.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, PASSWORD, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import { FakeStorage } from '../spaces/fixtures.js';
import { bearer, superUser } from '../super/fixtures.js';

// RF-AUTH-02 (decisões 67 e 71): foto de perfil do próprio usuário, no fluxo pré-assinado da logo
// do espaço; a foto do Google (URL externa) nunca é apagada do lugar de origem. LGPD: atender o
// pedido de exclusão apaga do storage a foto enviada pelo titular, depois do commit.

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
const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/ACg8ocJ-foto-do-google=s96-c';
const UUID = '00000000-0000-4000-8000-000000000000';

describe('foto de perfil (RF-AUTH-02)', () => {
  let t: TestApp;
  const storage = new FakeStorage();

  beforeAll(async () => {
    t = await createTestApp({ providers: [{ provide: PhotoStorage, useValue: storage }] });
  });
  afterAll(() => t.close());

  let n = 0;
  async function player() {
    n += 1;
    const user = await signUp(t, `jogador-foto${n}@exemplo.com`, `Jogador Foto ${n}`);
    return { user, api: apiFor(user) };
  }

  const apiFor = (user: SignedUp) => ({
    me: () =>
      t
        .http()
        .get('/v1/me')
        .set(...bearer(user)),
    presign: (body: object = { contentType: 'image/jpeg' }) =>
      t
        .http()
        .post('/v1/me/avatar/uploads')
        .set(...bearer(user))
        .send(body),
    set: (key: string) =>
      t
        .http()
        .put('/v1/me/avatar')
        .set(...bearer(user))
        .send({ key }),
    remove: () =>
      t
        .http()
        .delete('/v1/me/avatar')
        .set(...bearer(user)),
  });
  type Api = ReturnType<typeof apiFor>;

  /** Pede a URL, "envia" o arquivo e devolve a chave. */
  async function uploaded(api: Api, body = SQUARE_JPEG, contentType = 'image/jpeg') {
    const res = await api.presign({ contentType }).expect(201);
    storage.uploadBody(res.body.key, body);
    return res.body.key as string;
  }

  const avatarOf = async (userId: string) =>
    first(await t.db.select({ url: users.avatarUrl }).from(users).where(eq(users.id, userId))).url;

  const setAvatarUrl = (userId: string, url: string | null) =>
    t.db.update(users).set({ avatarUrl: url }).where(eq(users.id, userId));

  it('pede a URL, registra a foto e devolve avatarUrl no /v1/me', async () => {
    const { user, api } = await player();
    expect((await api.me().expect(200)).body.avatarUrl).toBeNull();

    const presign = await api.presign({ contentType: 'image/webp', size: 100 }).expect(201);
    expect(presign.body).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp' },
      key: expect.stringMatching(
        new RegExp(`^uploads/users/${user.id}/avatar/[0-9a-f-]{36}\\.webp$`),
      ),
      uploadUrl: expect.stringContaining(presign.body.key),
      expiresAt: expect.any(String),
    });
    // Sem o upload, não registra.
    expect((await api.set(presign.body.key).expect(422)).body.error.code).toBe('UPLOAD_NOT_FOUND');

    const key = await uploaded(api, SQUARE_WEBP, 'image/webp');
    const res = await api.set(key).expect(200);
    // Chave publicada nova a cada registro: `<uuid do upload>-<uuid novo>.<ext>`.
    const target = storage.publishedOf(key);
    const uploadUuid = key
      .split('/')
      .at(-1)
      ?.replace(/\.webp$/, '');
    expect(target).toMatch(
      new RegExp(`^users/${user.id}/avatar/${uploadUuid}-[0-9a-f-]{36}\\.webp$`),
    );
    expect(res.body).toEqual({ avatarUrl: `https://fotos.test/${target}` });
    // Publicada numa cópia, fora do alcance da URL pré-assinada; o upload é apagado.
    expect(storage.objects.has(target)).toBe(true);
    expect(storage.objects.has(key)).toBe(false);
    expect((await api.me().expect(200)).body.avatarUrl).toBe(`https://fotos.test/${target}`);

    // Registrar de novo a mesma chave não muda nada.
    expect((await api.set(key).expect(200)).body.avatarUrl).toBe(`https://fotos.test/${target}`);
    expect(storage.objects.has(target)).toBe(true);

    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'user.avatar.update')));
    expect(logs).toHaveLength(1);
    // Sem a URL (dado pessoal) no log.
    expect(logs[0]).toMatchObject({ actorId: user.id, spaceId: null, diff: { replaced: false } });
  });

  it('trocar apaga a foto anterior; remover apaga a atual e é idempotente', async () => {
    const { user, api } = await player();
    const firstKey = await uploaded(api);
    await api.set(firstKey).expect(200);
    const second = await uploaded(api);
    await api.set(second).expect(200);
    expect(storage.deleted).toContain(storage.publishedOf(firstKey));
    expect(storage.objects.has(storage.publishedOf(firstKey))).toBe(false);
    expect(await avatarOf(user.id)).toBe(`https://fotos.test/${storage.publishedOf(second)}`);

    await api.remove().expect(204);
    expect(storage.objects.has(storage.publishedOf(second))).toBe(false);
    expect(await avatarOf(user.id)).toBeNull();
    expect((await api.me().expect(200)).body.avatarUrl).toBeNull();
    await api.remove().expect(204);

    const actions = (
      await t.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, user.id))
    ).map((row) => row.action);
    expect(actions.filter((a) => a === 'user.avatar.update')).toHaveLength(2);
    expect(actions.filter((a) => a === 'user.avatar.remove')).toHaveLength(1);
  });

  it('foto do Google (URL externa): a enviada a substitui, mas nada é apagado do storage', async () => {
    const { user, api } = await player();
    await setAvatarUrl(user.id, GOOGLE_PHOTO);
    expect((await api.me().expect(200)).body.avatarUrl).toBe(GOOGLE_PHOTO);

    const deletedBefore = storage.deleted.length;
    const key = await uploaded(api);
    await api.set(key).expect(200);
    // Só o upload (copiado) sai; nenhuma tentativa de apagar a foto do Google.
    expect(storage.deleted.slice(deletedBefore)).toEqual([key]);
    expect(await avatarOf(user.id)).toBe(`https://fotos.test/${storage.publishedOf(key)}`);

    // Remover a foto do Google só tira a URL do perfil.
    await setAvatarUrl(user.id, GOOGLE_PHOTO);
    const deletedNow = storage.deleted.length;
    await api.remove().expect(204);
    expect(storage.deleted.length).toBe(deletedNow);
    expect(await avatarOf(user.id)).toBeNull();
  });

  it('o Better Auth não grava a foto: `image` é recusado no cadastro e no update-user', async () => {
    const { user, api } = await player();
    const key = await uploaded(api);
    const { avatarUrl } = (await api.set(key).expect(200)).body;

    // Trocar a URL sem passar por /v1/me/avatar deixaria a foto enviada órfã (e pública).
    for (const image of [GOOGLE_PHOTO, 'https://fotos.test/users/outra/avatar/x.jpg', null]) {
      const res = await t
        .http()
        .post('/v1/auth/update-user')
        .set(...bearer(user))
        .send({ name: 'Outro Nome', image })
        .expect(400);
      expect(res.body.error.code).toBe('IMAGE_NOT_ALLOWED');
    }
    expect(await avatarOf(user.id)).toBe(avatarUrl);
    expect(storage.objects.has(storage.publishedOf(key))).toBe(true);
    // Sem `image`, o update-user segue valendo (o app troca o nome por ele).
    await t
      .http()
      .post('/v1/auth/update-user')
      .set(...bearer(user))
      .send({ name: 'Outro Nome' })
      .expect(200);
    expect((await api.me().expect(200)).body).toMatchObject({ name: 'Outro Nome', avatarUrl });

    const signUp = await t
      .http()
      .post('/v1/auth/sign-up/email')
      .send({
        name: 'Com Foto',
        email: 'cadastro-com-foto@exemplo.com',
        password: PASSWORD,
        image: avatarUrl,
      })
      .expect(400);
    expect(signUp.body.error.code).toBe('IMAGE_NOT_ALLOWED');
    expect(await t.db.$count(users, eq(users.email, 'cadastro-com-foto@exemplo.com'))).toBe(0);
  });

  it('a URL pré-assinada ainda vale: cada registro confere a própria cópia', async () => {
    const { user, api } = await player();
    const key = await uploaded(api);
    // Entre a cópia deste registro e a conferência, o arquivo é regravado (inválido) pela URL e
    // registrado de novo: o outro registro copia para outra chave, que é a recusada.
    storage.afterCopy = async () => {
      storage.uploadBody(key, WIDE_PNG, 'image/jpeg');
      expect((await api.set(key).expect(422)).body.error.code).toBe('INVALID_IMAGE_FILE');
    };
    const { avatarUrl } = (await api.set(key).expect(200)).body;

    const [mine, other] = storage.copies.filter((c) => c.source === key).map((c) => c.target);
    expect(mine).not.toBe(other);
    expect(avatarUrl).toBe(`https://fotos.test/${mine}`);
    expect(storage.bodies.get(mine as string)).toEqual(SQUARE_JPEG);
    expect(storage.objects.has(other as string)).toBe(false);
    expect(await avatarOf(user.id)).toBe(avatarUrl);
  });

  it('chave de outro usuário, de um espaço ou fora do formato: INVALID_UPLOAD_KEY', async () => {
    const a = await player();
    const b = await player();
    const keyOfB = await uploaded(b.api);
    for (const key of [
      keyOfB,
      `uploads/spaces/${UUID}/logo/${UUID}.jpg`,
      `uploads/users/${a.user.id}/avatar/foto.jpg`,
      `uploads/users/${a.user.id}/avatar/${UUID}.gif`,
      `users/${a.user.id}/avatar/${UUID}.jpg`,
      `uploads/users/${a.user.id}/avatar/../../${b.user.id}/avatar/${UUID}.jpg`,
    ]) {
      expect((await a.api.set(key).expect(422)).body.error.code).toBe('INVALID_UPLOAD_KEY');
    }
    // A chave do outro usuário nem é tocada.
    expect(storage.objects.has(keyOfB)).toBe(true);
    expect(await avatarOf(a.user.id)).toBeNull();
  });

  it('confere o arquivo real: tamanho, tipo pelos bytes e imagem quadrada; o inválido é apagado', async () => {
    const { user, api } = await player();

    const wide = await uploaded(api, WIDE_PNG, 'image/png');
    const notSquare = await api.set(wide).expect(422);
    expect(notSquare.body.error).toMatchObject({
      code: 'IMAGE_NOT_SQUARE',
      details: { width: 3, height: 2 },
    });
    expect(storage.objects.has(storage.publishedOf(wide))).toBe(false);

    // Declarado JPEG, mas os bytes são PNG.
    const lying = (await api.presign({ contentType: 'image/jpeg' }).expect(201)).body.key;
    storage.uploadBody(lying, WIDE_PNG, 'image/jpeg');
    expect((await api.set(lying).expect(422)).body.error.code).toBe('INVALID_IMAGE_FILE');

    // Content-Type do objeto diferente do pedido.
    const other = (await api.presign({ contentType: 'image/png' }).expect(201)).body.key;
    storage.uploadBody(other, WIDE_PNG, 'text/html');
    expect((await api.set(other).expect(422)).body.error.code).toBe('INVALID_IMAGE_FILE');

    // Maior que o limite (2 MB): nem lê os bytes.
    const big = (await api.presign({ contentType: 'image/jpeg' }).expect(201)).body.key;
    storage.upload(big, 2 * 1024 * 1024 + 1);
    expect((await api.set(big).expect(422)).body.error.code).toBe('IMAGE_TOO_LARGE');
    expect(storage.objects.has(storage.publishedOf(big))).toBe(false);

    expect(await avatarOf(user.id)).toBeNull();

    // Pedido fora do limite ou de tipo não aceito nem gera a URL.
    await api.presign({ contentType: 'image/gif' }).expect(400);
    await api.presign({ contentType: 'image/png', size: 2 * 1024 * 1024 + 1 }).expect(400);
  });

  it('falha depois da cópia: apaga a cópia publicada e mantém a foto atual', async () => {
    const { user, api } = await player();
    const current = await uploaded(api);
    await api.set(current).expect(200);

    const next = await uploaded(api);
    storage.failHead = new Error('storage fora do ar');
    await api.set(next).expect(500);
    expect(storage.objects.has(storage.publishedOf(next))).toBe(false);
    expect(storage.objects.has(storage.publishedOf(current))).toBe(true);
    expect(await avatarOf(user.id)).toBe(`https://fotos.test/${storage.publishedOf(current)}`);
  });

  it('sem storage configurado: STORAGE_UNAVAILABLE; remover continua funcionando', async () => {
    const { user, api } = await player();
    await setAvatarUrl(user.id, GOOGLE_PHOTO);
    storage.enabled = false;
    try {
      expect((await api.presign().expect(503)).body.error.code).toBe('STORAGE_UNAVAILABLE');
      expect(
        (await api.set(`uploads/users/${user.id}/avatar/${UUID}.jpg`).expect(503)).body.error.code,
      ).toBe('STORAGE_UNAVAILABLE');
      await api.remove().expect(204);
      expect(await avatarOf(user.id)).toBeNull();
    } finally {
      storage.enabled = true;
    }
  });

  it('exige sessão; conta inativa não altera a foto', async () => {
    await t.http().post('/v1/me/avatar/uploads').send({ contentType: 'image/jpeg' }).expect(401);
    await t.http().put('/v1/me/avatar').send({ key: 'x' }).expect(401);
    await t.http().delete('/v1/me/avatar').expect(401);

    const { user, api } = await player();
    const key = await uploaded(api);
    await t.db.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, user.id));
    expect((await api.set(key).expect(403)).body.error.code).toBe('ACCOUNT_INACTIVE');
    expect(await avatarOf(user.id)).toBeNull();
  });

  describe('exclusão de conta (LGPD)', () => {
    let admin: SignedUp;
    beforeAll(async () => {
      admin = await superUser(t, 'super-foto@exemplo.com');
    });

    async function deleteAccount(user: SignedUp) {
      const { requestId } = (
        await t
          .http()
          .post('/v1/me/deletion-request')
          .set(...bearer(user))
          .send({ password: PASSWORD })
          .expect(201)
      ).body;
      await t
        .http()
        .post(`/v1/super/deletion-requests/${requestId}/fulfill`)
        .set(...bearer(admin))
        .send({})
        .expect(200);
    }

    it('atender o pedido apaga tudo do titular no storage, inclusive órfãos e envios pendentes', async () => {
      const { user, api } = await player();
      const key = await uploaded(api);
      await api.set(key).expect(200);
      // Órfão (troca cuja remoção falhou) e um envio ainda não registrado.
      const orphan = `users/${user.id}/avatar/${UUID}-${UUID}.jpg`;
      storage.uploadBody(orphan, SQUARE_JPEG);
      const pending = (await api.presign().expect(201)).body.key as string;
      storage.uploadBody(pending, SQUARE_JPEG);
      // A foto de outra pessoa fica.
      const other = await player();
      const otherKey = await uploaded(other.api);
      await other.api.set(otherKey).expect(200);

      await deleteAccount(user);
      for (const gone of [storage.publishedOf(key), orphan, pending]) {
        expect(storage.objects.has(gone), gone).toBe(false);
      }
      expect([...storage.objects.keys()].some((k) => k.includes(user.id))).toBe(false);
      expect(storage.objects.has(storage.publishedOf(otherKey))).toBe(true);
      const row = first(await t.db.select().from(users).where(eq(users.id, user.id)));
      expect(row).toMatchObject({ avatarUrl: null, deletedAt: expect.any(Date) });
    });

    it('foto do Google: sai da conta, e nada de fora do storage é tocado', async () => {
      const { user } = await player();
      await setAvatarUrl(user.id, GOOGLE_PHOTO);
      const deletedBefore = storage.deleted.length;
      await deleteAccount(user);
      expect(storage.deleted.length).toBe(deletedBefore);
      expect(await avatarOf(user.id)).toBeNull();
    });

    it('falha no storage só é logada: a anonimização fica', async () => {
      const { user, api } = await player();
      const key = await uploaded(api);
      await api.set(key).expect(200);

      const original = storage.deletePrefix.bind(storage);
      storage.deletePrefix = async () => {
        throw new Error('storage fora do ar');
      };
      try {
        await deleteAccount(user);
      } finally {
        storage.deletePrefix = original;
      }
      const row = first(await t.db.select().from(users).where(eq(users.id, user.id)));
      expect(row).toMatchObject({ avatarUrl: null, deletedAt: expect.any(Date) });
      // Sobra só o órfão no bucket.
      expect(storage.objects.has(storage.publishedOf(key))).toBe(true);
    });
  });
});
