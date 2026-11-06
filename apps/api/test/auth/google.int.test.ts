import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OAUTH_CALLBACK_PATH, protectSocialLink } from '../../src/auth/social-link.js';
import {
  accounts,
  auditLogs,
  devices,
  sessions,
  sports,
  userSportProfiles,
  users,
} from '../../src/db/schema/index.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { first } from '../db/helpers.js';
import { FakeStorage } from '../spaces/fixtures.js';
import {
  createTestApp,
  PASSWORD,
  sessionCookie,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from './helpers.js';

// RF-AUTH-01 (login com Google) e decisões 66 e 71: conta nova sem telefone, ligação com a conta
// de senha e proteção contra pré-sequestro (RN-AUTH-06), foto do Google só quando a conta não tem
// foto. A troca do código com o Google é simulada (fetch do token endpoint); o resto é o fluxo
// real do Better Auth: /sign-in/social (ou /link-social) → /callback/google.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALLBACK_URL = `${WEB_ORIGIN}/painel`;

type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
};

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** id_token no formato do Google (a assinatura não é conferida na troca do código). */
function fakeIdToken(profile: GoogleProfile): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: 'google-client-id',
    sub: profile.sub,
    email: profile.email,
    email_verified: profile.emailVerified ?? true,
    name: profile.name ?? 'Pessoa Google',
    picture: profile.picture,
    iat: now,
    exp: now + 3600,
  };
  return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url(payload)}.assinatura`;
}

const cookiesOf = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((cookie) => cookie.split(';')[0]);

describe('login com Google', () => {
  let t: TestApp;
  const storage = new FakeStorage();
  /** Perfil devolvido pelo "Google" para cada código de autorização. */
  const profiles = new Map<string, GoogleProfile>();
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    t = await createTestApp({
      env: { GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-secret' },
      providers: [{ provide: PhotoStorage, useValue: storage }],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(GOOGLE_TOKEN_URL)) return realFetch(input, init);
      const code = new URLSearchParams(String(init?.body ?? '')).get('code') ?? '';
      const profile = profiles.get(code);
      if (!profile) return new Response('{"error":"invalid_grant"}', { status: 400 });
      return Response.json({
        access_token: `access-${code}`,
        id_token: fakeIdToken(profile),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
      });
    });
  });
  afterEach(() => profiles.clear());
  afterAll(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  /**
   * Fluxo do navegador: pede a URL do Google e volta pelo callback com o código. Com `cookie`
   * (sessão aberta), é a ligação explícita por /link-social.
   */
  async function googleLogin(profile: GoogleProfile, { cookie }: { cookie?: string } = {}) {
    const code = `codigo-${profile.sub}`;
    profiles.set(code, profile);
    const start = await t
      .http()
      .post(cookie ? '/v1/auth/link-social' : '/v1/auth/sign-in/social')
      .set('origin', WEB_ORIGIN)
      .set('cookie', cookie ?? '')
      .send({ provider: 'google', callbackURL: CALLBACK_URL, disableRedirect: true })
      .expect(200);
    const state = new URL(start.body.url).searchParams.get('state');
    const callback = await t
      .http()
      .get('/v1/auth/callback/google')
      .query({ code, state })
      .set('cookie', [...cookiesOf(start), ...(cookie ? [cookie] : [])].join('; '))
      .expect(302);
    return { location: String(callback.headers.location), cookie: sessionCookie(callback) };
  }
  const revocations = async (userId: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityId, userId), eq(auditLogs.action, 'user.unproven_access_revoked')),
      );

  const userByEmail = async (email: string) =>
    first(await t.db.select().from(users).where(eq(users.email, email)));
  const providersOf = async (userId: string) =>
    (await t.db.select().from(accounts).where(eq(accounts.userId, userId)))
      .map((account) => account.providerId)
      .sort();
  const passwordLogin = (email: string) =>
    t.http().post('/v1/auth/sign-in/email').send({ email, password: PASSWORD });

  it('e-mail novo: cria a conta verificada, sem telefone e com a foto do Google', async () => {
    const login = await googleLogin({
      sub: 'g-novo',
      email: 'Nova.Google@Exemplo.com',
      name: 'Nova Google',
      picture: 'https://lh3.googleusercontent.com/a/nova',
    });
    expect(login.location).toBe(CALLBACK_URL);
    expect(login.cookie).toBeDefined();

    const user = await userByEmail('nova.google@exemplo.com');
    expect(user).toMatchObject({
      name: 'Nova Google',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      avatarUrl: 'https://lh3.googleusercontent.com/a/nova',
    });
    expect(await providersOf(user.id)).toEqual(['google']);

    const me = await t
      .http()
      .get('/v1/me')
      .set('cookie', login.cookie ?? '')
      .expect(200);
    expect(me.body).toMatchObject({ phone: null, profile: { missing: ['phone'] } });
  });

  it('conta de senha com e-mail verificado: liga ao Google e a senha continua valendo', async () => {
    const owner = await signUp(t, 'verificada@exemplo.com', 'Dona Verificada');
    await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, owner.id));

    const login = await googleLogin({
      sub: 'g-verificada',
      email: 'verificada@exemplo.com',
      picture: 'https://lh3.googleusercontent.com/a/verificada',
    });
    expect(login.location).toBe(CALLBACK_URL);

    const user = await userByEmail('verificada@exemplo.com');
    expect(user.id).toBe(owner.id);
    expect(await providersOf(owner.id)).toEqual(['credential', 'google']);
    // Nome e telefone da conta ficam; a foto do Google entra porque a conta não tinha foto.
    expect(user).toMatchObject({
      name: 'Dona Verificada',
      phone: '+5531988880000',
      avatarUrl: 'https://lh3.googleusercontent.com/a/verificada',
    });
    await passwordLogin('verificada@exemplo.com').expect(200);
    // A sessão de antes continua aberta.
    await t.http().get('/v1/me').set('cookie', owner.cookie).expect(200);
  });

  it('a foto do Google nunca substitui a foto que a conta já tem (decisão 71)', async () => {
    const owner = await signUp(t, 'com-foto@exemplo.com', 'Com Foto');
    const own = 'https://media.exemplo.com/users/com-foto/avatar/propria.webp';
    await t.db
      .update(users)
      .set({ emailVerified: true, avatarUrl: own })
      .where(eq(users.id, owner.id));

    await googleLogin({
      sub: 'g-com-foto',
      email: 'com-foto@exemplo.com',
      picture: 'https://lh3.googleusercontent.com/a/outra',
    });
    expect((await userByEmail('com-foto@exemplo.com')).avatarUrl).toBe(own);
  });

  it('conta de senha com e-mail NÃO verificado: vira conta nova do Google (pré-sequestro, RN-AUTH-06)', async () => {
    // Alguém cadastrou o e-mail da vítima com uma senha própria, um telefone, um perfil e uma foto.
    const squatter = await signUp(t, 'vitima@exemplo.com', 'Invasor', '+5531966660000');
    const [sport] = await t.db
      .insert(sports)
      .values({ slug: 'esporte-invasor', name: 'Esporte' })
      .returning({ id: sports.id });
    await t.db.insert(userSportProfiles).values({ userId: squatter.id, sportId: sport?.id ?? '' });
    const photoKey = `users/${squatter.id}/avatar/foto-do-invasor.jpg`;
    const pendingKey = `uploads/users/${squatter.id}/avatar/envio.jpg`;
    storage.objects.set(photoKey, { size: 10, contentType: 'image/jpeg' });
    storage.objects.set(pendingKey, { size: 10, contentType: 'image/jpeg' });
    await t.db
      .update(users)
      .set({ avatarUrl: storage.publicUrl(photoKey), birthDate: '1990-01-01', gender: 'MALE' })
      .where(eq(users.id, squatter.id));
    await t.db.insert(devices).values({
      userId: squatter.id,
      expoPushToken: 'ExponentPushToken[invasor]',
      platform: 'ANDROID',
    });
    await passwordLogin('vitima@exemplo.com').expect(200);

    // A dona do e-mail entra pelo Google.
    const login = await googleLogin({
      sub: 'g-vitima',
      email: 'vitima@exemplo.com',
      name: 'Vítima',
      picture: 'https://lh3.googleusercontent.com/a/vitima',
    });
    expect(login.location).toBe(CALLBACK_URL);
    expect(login.cookie).toBeDefined();

    const user = await userByEmail('vitima@exemplo.com');
    expect(user.id).toBe(squatter.id);
    // Nome e foto vêm do Google; o resto do perfil do invasor sai.
    expect(user).toMatchObject({
      name: 'Vítima',
      avatarUrl: 'https://lh3.googleusercontent.com/a/vitima',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      birthDate: null,
      gender: null,
    });
    expect(await t.db.$count(userSportProfiles, eq(userSportProfiles.userId, user.id))).toBe(0);
    // A foto enviada (e o envio pendente) saem do storage.
    expect(storage.objects.has(photoKey)).toBe(false);
    expect(storage.objects.has(pendingKey)).toBe(false);
    // Só o Google sobra: a senha antiga não entra mais.
    expect(await providersOf(user.id)).toEqual(['google']);
    const res = await passwordLogin('vitima@exemplo.com').expect(401);
    expect(res.body.error.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    // As sessões de antes caíram; só a do Google vale.
    await t.http().get('/v1/me').set('cookie', squatter.cookie).expect(401);
    await t.http().get('/v1/me').set('authorization', `Bearer ${squatter.token}`).expect(401);
    expect(await t.db.$count(sessions, eq(sessions.userId, user.id))).toBe(1);
    expect(await t.db.$count(devices, eq(devices.userId, user.id))).toBe(0);

    const me = await t
      .http()
      .get('/v1/me')
      .set('cookie', login.cookie ?? '')
      .expect(200);
    expect(me.body.profile).toEqual({ missing: ['phone'] });

    const [entry] = await revocations(user.id);
    expect(entry?.diff).toEqual({
      providersRemoved: ['credential'],
      sessionsEnded: 2,
      devicesRemoved: 1,
    });
  });

  it('ligação explícita (/link-social) com o e-mail ainda não verificado não revoga nada', async () => {
    const owner = await signUp(t, 'liga-explicito@exemplo.com', 'Dona Explícita');
    const login = await googleLogin(
      { sub: 'g-explicito', email: 'liga-explicito@exemplo.com', name: 'Outro Nome' },
      { cookie: owner.cookie },
    );
    expect(login.location).toBe(CALLBACK_URL);

    expect(await providersOf(owner.id)).toEqual(['credential', 'google']);
    expect(await userByEmail('liga-explicito@exemplo.com')).toMatchObject({
      name: 'Dona Explícita',
      phone: '+5531988880000',
    });
    await passwordLogin('liga-explicito@exemplo.com').expect(200);
    await t.http().get('/v1/me').set('cookie', owner.cookie).expect(200);
    expect(await revocations(owner.id)).toEqual([]);
  });

  it('fora do callback ou sem contexto da rota, a ligação a conta não verificada é recusada (falha fechada)', async () => {
    const owner = await signUp(t, 'sem-contexto@exemplo.com', 'Sem Contexto');
    for (const path of [undefined, '/sign-in/social']) {
      await expect(
        protectSocialLink(t.db, storage, {
          userId: owner.id,
          idToken: null,
          path,
          explicitLink: false,
        }),
      ).rejects.toMatchObject({ body: { code: 'account_not_linked' } });
    }
    // Nada mudou.
    expect(await providersOf(owner.id)).toEqual(['credential']);
    await t.http().get('/v1/me').set('cookie', owner.cookie).expect(200);
    expect(await revocations(owner.id)).toEqual([]);

    // Pelo callback, revoga; com o e-mail já verificado, nem olha a rota.
    expect(
      await protectSocialLink(t.db, storage, {
        userId: owner.id,
        idToken: null,
        path: OAUTH_CALLBACK_PATH,
        explicitLink: false,
      }),
    ).toBe(true);
    expect(await userByEmail('sem-contexto@exemplo.com')).toMatchObject({ name: '' });
    await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, owner.id));
    expect(
      await protectSocialLink(t.db, storage, {
        userId: owner.id,
        idToken: null,
        path: undefined,
        explicitLink: false,
      }),
    ).toBe(false);
  });

  it('e-mail não verificado pelo Google não liga a uma conta existente', async () => {
    const owner = await signUp(t, 'nao-verificado-google@exemplo.com', 'Dona');
    const login = await googleLogin({
      sub: 'g-nao-verificado',
      email: 'nao-verificado-google@exemplo.com',
      emailVerified: false,
    });
    expect(new URL(login.location).searchParams.get('error')).toBe('account_not_linked');
    expect(login.cookie).toBeUndefined();
    expect(await providersOf(owner.id)).toEqual(['credential']);
    await passwordLogin('nao-verificado-google@exemplo.com').expect(200);
  });
});
