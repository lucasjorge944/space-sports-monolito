import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema/index.js';
import {
  createTestApp,
  PASSWORD,
  PHONE,
  type SignedUp,
  signUp,
  type TestApp,
  WEB_ORIGIN,
} from '../auth/helpers.js';
import { createSpace, seedCatalog } from '../spaces/fixtures.js';

// BUG-MCP-3: o Postgres recusa o byte NUL (0x00) em texto. Antes, `GET /v1/spaces?q=a%00b` e
// `GET /v1/spaces/a%00b` respondiam 500 INTERNAL_ERROR. Agora toda entrada com NUL (caminho, query
// ou corpo) responde 400 VALIDATION_ERROR antes da rota, e as entradas válidas seguem iguais.

describe('byte NUL em query, parâmetro de rota e corpo → 400 VALIDATION_ERROR (BUG-MCP-3)', () => {
  let t: TestApp;
  let ana: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    const catalog = await seedCatalog(t.db);
    await createSpace(t.db, catalog, { slug: 'arena-sao-jose', name: 'Arena São José' });
    ana = await signUp(t, 'ana.nul@exemplo.com', 'Ana Souza');
  });
  afterAll(() => t?.close());

  const expectNulRejected = (res: { status: number; body: unknown }, field: string) => {
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ field, code: 'invalid_format', message: expect.stringContaining('nulo') }],
      },
    });
  };

  it('busca: NUL no `q` (e em qualquer parâmetro) é recusado; o texto válido segue funcionando', async () => {
    expectNulRejected(await t.http().get('/v1/spaces?q=a%00b'), 'q');
    expectNulRejected(await t.http().get('/v1/spaces').query({ q: 'are\u0000na' }), 'q');
    expectNulRejected(await t.http().get('/v1/spaces').query({ city: '\u0000' }), 'city');

    for (const q of ['São José', 'arena', "'; drop table spaces; --", '%00', '\\u0000']) {
      const res = await t.http().get('/v1/spaces').query({ q });
      expect(res.status, q).toBe(200);
    }
    const found = await t.http().get('/v1/spaces').query({ q: 'São José' });
    expect(found.body.items.map((item: { slug: string }) => item.slug)).toEqual(['arena-sao-jose']);
  });

  it('slug: NUL no parâmetro de rota é recusado; `%00` literal e slug válido seguem normais', async () => {
    expectNulRejected(await t.http().get('/v1/spaces/a%00b'), 'path');
    expectNulRejected(await t.http().get('/v1/spaces/arena-sao-jose%00/classes'), 'path');
    // `%2500` decodifica para o texto "%00" (sem NUL): só não acha o espaço.
    const literal = await t.http().get('/v1/spaces/a%2500b');
    expect(literal.status).toBe(404);
    expect(literal.body.error.code).toBe('SPACE_NOT_FOUND');
    expect((await t.http().get('/v1/spaces/arena-sao-jose')).status).toBe(200);
  });

  it('corpo JSON: NUL num campo (ou aninhado) é recusado e nada é gravado', async () => {
    const patch = (body: unknown) =>
      t
        .http()
        .patch('/v1/me/profile')
        .set('authorization', `Bearer ${ana.token}`)
        .send(body as object);
    expectNulRejected(await patch({ name: 'Ana\u0000 Souza' }), 'name');
    expectNulRejected(
      await patch({ favoriteSports: [{ sportId: 'x', level: 'INICIANTE\u0000' }] }),
      'favoriteSports.0.level',
    );
    const [row] = await t.db.select({ name: users.name }).from(users).where(eq(users.id, ana.id));
    expect(row?.name).toBe('Ana Souza');

    // Texto válido com acento, emoji e controle que não é NUL passa.
    const ok = await patch({ name: 'Ana Souza 💥' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Ana Souza 💥');
  });

  it('rotas do Better Auth também: cadastro com NUL é recusado, sem criar conta', async () => {
    const res = await t.http().post('/v1/auth/sign-up/email').send({
      name: 'Bob\u0000',
      email: 'bob.nul@exemplo.com',
      password: PASSWORD,
      phone: PHONE,
    });
    expectNulRejected(res, 'name');
    expect(await t.db.select().from(users).where(eq(users.email, 'bob.nul@exemplo.com'))).toEqual(
      [],
    );
  });

  it('rotas OAuth (formulário) respondem no formato do RFC 6749', async () => {
    const res = await t
      .http()
      .post('/v1/auth/oauth2/token')
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: 'abc\u0000' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request', error_description: expect.any(String) });
  });

  it('mais de 1000 parâmetros na query não escondem o NUL (o Better Auth relê a URL crua)', async () => {
    // O parser do Express guarda só os 1000 primeiros parâmetros em `req.query`.
    const many = Array.from({ length: 1000 }, (_, i) => `p${i}=x`).join('&');
    const authorize = await t
      .http()
      .get(`/v1/auth/oauth2/authorize?${many}&client_id=https%3A%2F%2Fa%00b.example.com%2Fc.json`);
    expect(authorize.status).toBe(400);
    expect(authorize.body).toEqual({
      error: 'invalid_request',
      error_description: expect.any(String),
    });
    // Fora das rotas OAuth: 400 VALIDATION_ERROR, com o campo `query` (o nome se perdeu no parser).
    expectNulRejected(await t.http().get(`/v1/spaces?${many}&q=a%00b`), 'query');
  });

  it('dupla codificação não leva NUL ao banco', async () => {
    // `%2500` decodifica uma vez para o texto "%00": busca normal, sem erro.
    const literal = await t.http().get('/v1/spaces?q=a%2500b');
    expect(literal.status).toBe(200);
    expect(literal.body.items).toEqual([]);

    // A query assinada do OAuth é decodificada de novo (`URLSearchParams`); com `%00` dentro, a
    // assinatura falha antes de qualquer consulta pelo cliente.
    const forged = new URLSearchParams({
      client_id: 'https://a\u0000b.example.com/c.json',
      exp: '9999999999',
      ba_param: 'client_id',
      sig: 'assinatura-falsa',
    }).toString();
    expect(forged).toContain('%00');
    const described = await t
      .http()
      .get('/v1/oauth/consent-request')
      .query({ oauthQuery: forged })
      .set('authorization', `Bearer ${ana.token}`);
    expect(described.status).toBe(400);
    expect(described.body.error.code).toBe('OAUTH_REQUEST_INVALID');

    for (const [path, body] of [
      ['/v1/auth/oauth2/consent', { accept: true, oauth_query: forged }],
      ['/v1/auth/oauth2/continue', { selected: true, oauth_query: forged }],
      ['/v1/auth/sign-in/email', { email: ana.email, password: PASSWORD, oauth_query: forged }],
    ] as const) {
      const res = await t
        .http()
        .post(path)
        .set('cookie', ana.cookie)
        .set('origin', WEB_ORIGIN)
        .send(body);
      expect(res.status, path).toBeLessThan(500);
    }
  });
});
