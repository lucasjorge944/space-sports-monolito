import { meResponseSchema } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cities, spaceMembers, spaces, users } from '../../src/db/schema/index.js';
import { first } from '../db/helpers.js';
import {
  createTestApp,
  makeSuper,
  PASSWORD,
  PHONE,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from './helpers.js';

describe('sessão por cookie (web) e por bearer (app)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('sem sessão, /v1/me responde 401 UNAUTHENTICATED', async () => {
    const res = await t.http().get('/v1/me').expect(401);
    expect(res.body.error).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Faça login para continuar.',
    });
  });

  it('cookie da sessão do web dá acesso a /v1/me', async () => {
    const user = await signUp(t, 'web@exemplo.com', 'Usuária Web');
    const res = await t.http().get('/v1/me').set('cookie', user.cookie).expect(200);
    expect(res.body).toMatchObject({ id: user.id, email: 'web@exemplo.com' });
  });

  it('o cookie é HttpOnly e SameSite=Lax', async () => {
    const res = await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'web@exemplo.com', password: PASSWORD })
      .expect(200);
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('space-sports.session_token='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('token bearer do app (header set-auth-token ou campo token) dá acesso a /v1/me', async () => {
    const login = await t
      .http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'web@exemplo.com', password: PASSWORD })
      .expect(200);

    for (const token of [login.headers['set-auth-token'], login.body.token]) {
      const res = await t.http().get('/v1/me').set('authorization', `Bearer ${token}`).expect(200);
      expect(res.body.email).toBe('web@exemplo.com');
    }
  });

  it('o bearer também vale nas rotas do Better Auth (get-session)', async () => {
    const user = await signUp(t, 'app@exemplo.com', 'Usuário App');
    const res = await t
      .http()
      .get('/v1/auth/get-session')
      .set('authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.user).toMatchObject({ id: user.id, email: 'app@exemplo.com' });
  });

  it('token inválido ou adulterado responde 401', async () => {
    const user = await signUp(t, 'adulterado@exemplo.com');
    await t.http().get('/v1/me').set('authorization', 'Bearer nao-existe').expect(401);
    await t
      .http()
      .get('/v1/me')
      .set('authorization', `Bearer ${user.token.slice(0, -2)}xx`)
      .expect(401);
    await t.http().get('/v1/me').set('cookie', 'space-sports.session_token=forjado').expect(401);
  });

  it('logout pelo web invalida o cookie; exige origem confiável', async () => {
    const user = await signUp(t, 'logout@exemplo.com');

    const blocked = await t
      .http()
      .post('/v1/auth/sign-out')
      .set('cookie', user.cookie)
      .set('origin', 'https://site-malicioso.example')
      .send({})
      .expect(403);
    expect(blocked.body.error.code).toBe('INVALID_ORIGIN');
    await t.http().get('/v1/me').set('cookie', user.cookie).expect(200);

    await t
      .http()
      .post('/v1/auth/sign-out')
      .set('cookie', user.cookie)
      .set('origin', WEB_ORIGIN)
      .send({})
      .expect(200);
    await t.http().get('/v1/me').set('cookie', user.cookie).expect(401);
  });

  it('logout pelo app (bearer) invalida o token', async () => {
    const user = await signUp(t, 'logout-app@exemplo.com');
    await t
      .http()
      .post('/v1/auth/sign-out')
      .set('authorization', `Bearer ${user.token}`)
      .send({})
      .expect(200);
    await t.http().get('/v1/me').set('authorization', `Bearer ${user.token}`).expect(401);
  });

  it('conta bloqueada depois do login perde o acesso (403 USER_BLOCKED)', async () => {
    const user = await signUp(t, 'bloqueada-depois@exemplo.com');
    await t.db.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, user.id));
    const res = await t.http().get('/v1/me').set('cookie', user.cookie).expect(403);
    expect(res.body.error.code).toBe('USER_BLOCKED');
  });

  it('CORS libera só as origens web confiáveis, com credenciais', async () => {
    const allowed = await t
      .http()
      .options('/v1/me')
      .set('origin', WEB_ORIGIN)
      .set('access-control-request-method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await t
      .http()
      .options('/v1/me')
      .set('origin', 'https://site-malicioso.example')
      .set('access-control-request-method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /v1/me', () => {
  let t: TestApp;
  let spaceA: string;
  let spaceB: string;
  let spaceC: string;
  beforeAll(async () => {
    t = await createTestApp();
    const city = first(
      await t.db
        .insert(cities)
        .values({ name: 'Belo Horizonte', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    [spaceA, spaceB, spaceC] = (
      await t.db
        .insert(spaces)
        .values([
          { name: 'Arena Beta', slug: 'arena-beta', cityId: city.id },
          { name: 'Arena Alfa', slug: 'arena-alfa', cityId: city.id, status: 'SUSPENDED' },
          { name: 'Arena Gama', slug: 'arena-gama', cityId: city.id },
        ])
        .returning()
    ).map((space) => space.id) as [string, string, string];
  });
  afterAll(() => t.close());

  it('jogador sem vínculos: sem acesso ao painel nem ao Super', async () => {
    const user = await signUp(t, 'jogador@exemplo.com', 'Jogador');
    const res = await t.http().get('/v1/me').set('cookie', user.cookie).expect(200);
    expect(res.body).toEqual({
      id: user.id,
      name: 'Jogador',
      email: 'jogador@exemplo.com',
      emailVerified: false,
      phone: PHONE,
      phoneVerified: false,
      avatarUrl: null,
      birthDate: null,
      gender: null,
      favoriteSports: [],
      profile: { missing: [] },
      platformRole: 'USER',
      memberships: [],
      access: { super: false, management: false },
    });
    expect(meResponseSchema.parse(res.body)).toEqual(res.body);
  });

  it('lista os vínculos ativos por espaço, com os papéis de cada um (RN-AUTH-03)', async () => {
    const user = await signUp(t, 'gestor@exemplo.com', 'Gestor');
    await t.db.insert(spaceMembers).values([
      { userId: user.id, spaceId: spaceA, role: 'ADMIN', status: 'ACTIVE' },
      { userId: user.id, spaceId: spaceA, role: 'TEACHER', status: 'ACTIVE' },
      { userId: user.id, spaceId: spaceB, role: 'TEACHER', status: 'ACTIVE' },
      // Convite pendente e vínculo removido não contam.
      { userId: user.id, spaceId: spaceC, role: 'OWNER', status: 'INVITED' },
      { userId: user.id, spaceId: spaceB, role: 'OWNER', status: 'REMOVED' },
    ]);

    const res = await t
      .http()
      .get('/v1/me')
      .set('authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.memberships).toEqual([
      {
        space: {
          id: spaceB,
          name: 'Arena Alfa',
          slug: 'arena-alfa',
          status: 'SUSPENDED',
          logoUrl: null,
        },
        roles: ['TEACHER'],
      },
      {
        space: {
          id: spaceA,
          name: 'Arena Beta',
          slug: 'arena-beta',
          status: 'ACTIVE',
          logoUrl: null,
        },
        roles: ['ADMIN', 'TEACHER'],
      },
    ]);
    expect(res.body.access).toEqual({ super: false, management: true });
    expect(meResponseSchema.parse(res.body)).toEqual(res.body);
  });

  it('usuário Super tem acesso ao /super', async () => {
    const user = await signUp(t, 'super@exemplo.com', 'Super');
    await makeSuper(t.db, user.id);
    const res = await t.http().get('/v1/me').set('cookie', user.cookie).expect(200);
    expect(res.body).toMatchObject({
      platformRole: 'SUPER',
      access: { super: true, management: false },
    });
  });
});

describe('OpenAPI (/docs-json)', () => {
  let t: TestApp;
  let doc: {
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  };
  beforeAll(async () => {
    t = await createTestApp();
    doc = (await t.http().get('/docs-json').expect(200)).body;
  });
  afterAll(() => t.close());

  it('descreve as rotas de auth e o /v1/me para o orval', () => {
    for (const path of [
      '/v1/auth/sign-up/email',
      '/v1/auth/sign-in/email',
      '/v1/auth/sign-in/social',
      '/v1/auth/sign-out',
      '/v1/auth/get-session',
      '/v1/auth/request-password-reset',
      '/v1/auth/reset-password',
      '/v1/auth/verify-email',
      '/v1/me',
      '/v1/me/profile',
    ]) {
      expect(doc.paths, path).toHaveProperty([path]);
    }
    // Decisão 65: login por telefone desligado.
    expect(doc.paths).not.toHaveProperty(['/v1/auth/phone-number/send-otp']);
    expect(doc.components.schemas).toHaveProperty('MeResponseDto');
    expect(doc.components.schemas).toHaveProperty('AuthUser');
  });

  it('toda operação tem operationId único e os erros usam o formato padrão', () => {
    const ids = Object.values(doc.paths).flatMap((ops) =>
      Object.values(ops).map((op) => op.operationId),
    );
    expect(ids.every((id) => typeof id === 'string' && id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const signIn = doc.paths['/v1/auth/sign-in/email']?.post as {
      tags: string[];
      responses: Record<string, unknown>;
    };
    expect(signIn.tags).toEqual(['auth']);
    expect(signIn.responses['401']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ErrorResponseDto' } },
      },
    });
  });

  it('não expõe as colunas internas usadas pelo hook de sessão', () => {
    const user = doc.components.schemas.AuthUser?.properties ?? {};
    expect(Object.keys(user)).not.toContain('status');
    expect(Object.keys(user)).not.toContain('deletedAt');
    expect(user.email).toMatchObject({ nullable: true });
  });
});
