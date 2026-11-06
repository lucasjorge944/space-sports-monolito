import { INVALID_PHONE_MESSAGE, meResponseSchema } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, sports, userSportProfiles, users } from '../../src/db/schema/index.js';
import { createTestApp, PHONE, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';

// RF-AUTH-02 (decisões 64 a 70): GET /v1/me com o perfil e o que falta no cadastro, e
// PATCH /v1/me/profile.

describe('perfil do usuário', () => {
  let t: TestApp;
  let beach: { id: string; name: string; slug: string };
  let futevolei: { id: string; name: string; slug: string };

  beforeAll(async () => {
    t = await createTestApp();
    const columns = { id: sports.id, name: sports.name, slug: sports.slug };
    [beach, futevolei] = (await t.db
      .insert(sports)
      .values([
        { slug: 'beach-tennis', name: 'Beach Tennis' },
        { slug: 'futevolei', name: 'Futevôlei' },
      ])
      .returning(columns)) as [typeof beach, typeof futevolei];
  });
  afterAll(() => t.close());

  const me = (user: SignedUp) =>
    t
      .http()
      .get('/v1/me')
      .set(...bearer(user));
  const patch = (user: SignedUp, body: unknown) =>
    t
      .http()
      .patch('/v1/me/profile')
      .set(...bearer(user))
      .send(body as object);
  const row = async (id: string) => first(await t.db.select().from(users).where(eq(users.id, id)));

  it('GET /v1/me traz o perfil e nada falta depois do cadastro com telefone', async () => {
    const user = await signUp(t, 'perfil@exemplo.com', 'Perfil');
    const res = await me(user).expect(200);
    expect(res.body).toMatchObject({
      phone: PHONE,
      phoneVerified: false,
      birthDate: null,
      gender: null,
      favoriteSports: [],
      profile: { missing: [] },
    });
    expect(meResponseSchema.parse(res.body)).toEqual(res.body);
  });

  it('conta sem telefone ou sem nome: profile.missing pede o que falta (decisão 66)', async () => {
    const user = await signUp(t, 'antiga@exemplo.com', 'Antiga');
    await t.db.update(users).set({ phone: null }).where(eq(users.id, user.id));
    expect((await me(user).expect(200)).body.profile).toEqual({ missing: ['phone'] });

    await t.db.update(users).set({ name: ' ' }).where(eq(users.id, user.id));
    expect((await me(user).expect(200)).body.profile).toEqual({ missing: ['name', 'phone'] });

    // O "completar cadastro" usa o próprio PATCH.
    const res = await patch(user, { name: 'Antiga Completa', phone: '+5531977778888' }).expect(200);
    expect(res.body).toMatchObject({
      name: 'Antiga Completa',
      phone: '+5531977778888',
      phoneVerified: false,
      profile: { missing: [] },
    });
  });

  it('PATCH edita só o que veio e responde como o GET /v1/me', async () => {
    const user = await signUp(t, 'editar@exemplo.com', 'Editar');
    const res = await patch(user, {
      birthDate: '1990-05-17',
      gender: 'FEMALE',
      favoriteSports: [{ sportId: futevolei.id, level: 'ADVANCED' }, { sportId: beach.id }],
    }).expect(200);
    expect(meResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body).toMatchObject({
      name: 'Editar',
      phone: PHONE,
      birthDate: '1990-05-17',
      gender: 'FEMALE',
      // Pelo nome do esporte; o nível é opcional.
      favoriteSports: [
        { sport: beach, level: null },
        { sport: futevolei, level: 'ADVANCED' },
      ],
    });
    expect((await me(user).expect(200)).body).toEqual(res.body);

    // A lista substitui a anterior; nulos apagam nascimento e gênero.
    const cleared = await patch(user, {
      birthDate: null,
      gender: null,
      favoriteSports: [{ sportId: beach.id, level: 'BEGINNER' }],
    }).expect(200);
    expect(cleared.body).toMatchObject({
      birthDate: null,
      gender: null,
      favoriteSports: [{ sport: beach, level: 'BEGINNER' }],
    });
    await patch(user, { favoriteSports: [] }).expect(200);
    expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(0);
  });

  it('trocar o telefone volta a não verificado; mandar o mesmo número não muda nada', async () => {
    const user = await signUp(t, 'verificado@exemplo.com', 'Verificado', '+5531955554444');
    await t.db.update(users).set({ phoneVerified: true }).where(eq(users.id, user.id));

    await patch(user, { phone: '+5531955554444' }).expect(200);
    expect(await row(user.id)).toMatchObject({ phone: '+5531955554444', phoneVerified: true });

    const res = await patch(user, { phone: '+5531955553333' }).expect(200);
    expect(res.body).toMatchObject({ phone: '+5531955553333', phoneVerified: false });
    expect(await row(user.id)).toMatchObject({ phone: '+5531955553333', phoneVerified: false });
  });

  it('o telefone pode ser o mesmo de outra conta, inclusive de uma verificada (decisão 64)', async () => {
    const owner = await signUp(t, 'dona-fone@exemplo.com', 'Dona', '+5531944443333');
    await t.db.update(users).set({ phoneVerified: true }).where(eq(users.id, owner.id));
    const other = await signUp(t, 'outra-fone@exemplo.com', 'Outra');

    await patch(other, { phone: '+5531944443333' }).expect(200);
    expect(await row(other.id)).toMatchObject({ phone: '+5531944443333', phoneVerified: false });
    expect(await row(owner.id)).toMatchObject({ phone: '+5531944443333', phoneVerified: true });
  });

  it('auditoria com os nomes dos campos, sem os valores', async () => {
    const user = await signUp(t, 'auditoria@exemplo.com', 'Auditoria');
    await patch(user, {
      name: 'Auditoria Nova',
      phone: '+5531933332222',
      birthDate: '1985-01-02',
      favoriteSports: [{ sportId: beach.id }],
    }).expect(200);
    // Nada mudou: sem nova entrada.
    await patch(user, { name: 'Auditoria Nova', favoriteSports: [{ sportId: beach.id }] }).expect(
      200,
    );

    const entries = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'user.profile.update')));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: user.id,
      spaceId: null,
      diff: { fields: ['name', 'phone', 'birthDate', 'favoriteSports'] },
    });
    expect(JSON.stringify(entries[0]?.diff)).not.toContain('5531933332222');
  });

  it.each([
    ['nome vazio', { name: '  ' }],
    ['nascimento no futuro', { birthDate: '2999-01-01' }],
    ['nascimento antes de 1900', { birthDate: '1899-12-31' }],
    ['data inexistente', { birthDate: '2001-02-29' }],
    ['gênero fora da lista', { gender: 'M' }],
    [
      'nível fora da lista',
      { favoriteSports: [{ sportId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd', level: 'MESTRE' }] },
    ],
    ['e-mail (fluxo próprio)', { email: 'outro@exemplo.com' }],
    ['foto (fluxo próprio)', { avatarUrl: 'https://exemplo.com/x.png' }],
  ])('400 VALIDATION_ERROR: %s', async (_label, body) => {
    const user = await signUp(t, `invalido-${Math.random().toString(36).slice(2)}@exemplo.com`);
    const res = await patch(user, body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['fora do padrão', '(31) 99999-8888'],
    ['de outro país', '+14155550123'],
    ['apagado', null],
    ['de outro tipo', 31999998888],
  ])('telefone %s: 400 INVALID_PHONE_NUMBER, como no cadastro', async (_label, phone) => {
    const user = await signUp(
      t,
      `fone-invalido-${Math.random().toString(36).slice(2)}@exemplo.com`,
    );
    const res = await patch(user, { name: 'Não Muda', phone }).expect(400);
    expect(res.body.error).toEqual({
      code: 'INVALID_PHONE_NUMBER',
      message: INVALID_PHONE_MESSAGE,
    });
    const signUpRes = await t
      .http()
      .post('/v1/auth/sign-up/email')
      .send({
        name: 'X',
        email: `cadastro-${user.id}@exemplo.com`,
        password: 'senha-forte-123',
        phone,
      })
      .expect(400);
    expect(signUpRes.body.error).toEqual(res.body.error);
    expect(await row(user.id)).toMatchObject({ name: 'Jogador Teste', phone: PHONE });
  });

  it('esporte repetido é 400; fora do catálogo é 422 e nada é gravado', async () => {
    const user = await signUp(t, 'esportes@exemplo.com', 'Esportes');
    const repeated = await patch(user, {
      favoriteSports: [{ sportId: beach.id }, { sportId: beach.id, level: 'PRO' }],
    }).expect(400);
    expect(repeated.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await patch(user, {
      name: 'Não Deve Mudar',
      favoriteSports: [{ sportId: beach.id }, { sportId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' }],
    }).expect(422);
    expect(missing.body.error.code).toBe('SPORT_NOT_FOUND');
    expect(await row(user.id)).toMatchObject({ name: 'Esportes' });
    expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(0);
  });

  it('tirar o esporte do catálogo leva junto os favoritos', async () => {
    const user = await signUp(t, 'catalogo@exemplo.com', 'Catálogo');
    const [volei] = await t.db
      .insert(sports)
      .values({ slug: 'volei-de-praia', name: 'Vôlei de Praia' })
      .returning({ id: sports.id });
    await patch(user, { favoriteSports: [{ sportId: volei?.id }, { sportId: beach.id }] }).expect(
      200,
    );
    await t.db.delete(sports).where(eq(sports.id, volei?.id ?? ''));
    expect((await me(user).expect(200)).body.favoriteSports).toEqual([
      { sport: beach, level: null },
    ]);
  });

  it('sem sessão: 401', async () => {
    await t.http().patch('/v1/me/profile').send({ name: 'X' }).expect(401);
  });
});
