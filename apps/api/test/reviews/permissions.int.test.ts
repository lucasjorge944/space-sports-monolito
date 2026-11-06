import { eq } from 'drizzle-orm';
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaceReviewReports, spaceReviews } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertBooking, putReview } from './helpers.js';
import { insertReviewRow } from './qa-fixtures.js';

// AV.5 · matriz de permissões de TODAS as rotas de avaliações (RF-REVIEW-01 a 09, RN-REVIEW-04,
// 05 e 07): anônimo, jogador sem relação, autor, Dono, Admin, Professor, Dono de outro espaço,
// conta bloqueada, Super sem e com modo suporte. Cada célula roda com uma avaliação nova.

type Actor =
  | 'anon'
  | 'player'
  | 'author'
  | 'owner'
  | 'admin'
  | 'teacher'
  | 'foreignOwner'
  | 'blocked'
  | 'platform'
  | 'support';

const ACTORS: Actor[] = [
  'anon',
  'player',
  'author',
  'owner',
  'admin',
  'teacher',
  'foreignOwner',
  'blocked',
  'platform',
  'support',
];

/** Status esperado (e, se importa, o código do erro). Lista = qualquer um dos status. */
type Cell = number | { status: number | number[]; code?: string };

const SUPPORT = 'x-support-session';
// A conta bloqueada perde as sessões: o token deixa de valer e a resposta é sempre 401, também
// nas rotas públicas (o token inválido não é ignorado).
const BLOCKED: Cell = 401;

type Ctx = {
  /** Avaliação anônima do espaço, sem relação com nenhum ator. */
  reviewId: string;
  /** Avaliação do ator `author`. */
  ownReviewId: string;
  /** Avaliação do outro espaço. */
  foreignReviewId: string;
  /** Denúncia aberta contra `reviewId`. */
  reportId: string;
};

describe('avaliações: matriz de permissões (AV.5)', () => {
  let t: TestApp;
  let space: Space;
  let other: Space;
  let actors: Record<Exclude<Actor, 'anon' | 'support'>, SignedUp>;
  let supportSession: string;

  const as = (actor: Actor, req: Test): Test => {
    if (actor === 'anon') return req;
    const user = actor === 'support' ? actors.platform : actors[actor];
    req.set(...bearer(user));
    if (actor === 'support') req.set(SUPPORT, supportSession);
    return req;
  };

  /** Uma avaliação do espaço com o que a rota testada precisa. */
  async function fresh(
    options: { reply?: boolean; hidden?: boolean; report?: boolean } = {},
  ): Promise<Ctx> {
    const review = await insertReviewRow(t.db, space.id, {
      ...(options.reply
        ? { reply: 'Obrigado!', replyBy: actors.owner.id, repliedAt: new Date() }
        : {}),
      ...(options.hidden
        ? {
            commentHiddenAt: new Date(),
            commentHiddenBy: actors.platform.id,
            commentHiddenReason: 'Ofensivo',
          }
        : {}),
    });
    const foreign = await insertReviewRow(t.db, other.id);
    // A avaliação do autor sempre existe (cria na primeira vez, edita nas seguintes).
    const own = await putReview(t, actors.author, space.id, { rating: 3 }).expect(200);
    let reportId = '';
    if (options.report) {
      const [report] = await t.db
        .insert(spaceReviewReports)
        .values({ reviewId: review.id, reporterUserId: actors.player.id, reason: 'SPAM' })
        .returning({ id: spaceReviewReports.id });
      reportId = report?.id ?? '';
    }
    return { reviewId: review.id, ownReviewId: own.body.id, foreignReviewId: foreign.id, reportId };
  }

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-permissoes');
    other = await createSpace(t.db, 'arena-permissoes-2');
    const platform = await superUser(t, 'super-perm@exemplo.com');
    const author = await signUp(t, 'autor-perm@exemplo.com', 'Autor Permissões');
    await insertBooking(t.db, space, author, 180);
    const blocked = await signUp(t, 'bloqueado-perm@exemplo.com', 'Bloqueado Perm');
    actors = {
      player: await signUp(t, 'jogador-perm@exemplo.com', 'Jogador Perm'),
      author,
      owner: await member(t, 'dono-perm@exemplo.com', space.id, 'OWNER'),
      admin: await member(t, 'admin-perm@exemplo.com', space.id, 'ADMIN'),
      teacher: await member(t, 'prof-perm@exemplo.com', space.id, 'TEACHER'),
      foreignOwner: await member(t, 'dono-outro-perm@exemplo.com', other.id, 'OWNER'),
      blocked,
      platform,
    };
    await t
      .http()
      .post(`/v1/super/users/${blocked.id}/block`)
      .set(...bearer(platform))
      .send({})
      .expect(200);
    const session = await t
      .http()
      .post(`/v1/super/spaces/${space.id}/support-sessions`)
      .set(...bearer(platform))
      .send({ reason: 'Testes de permissão das avaliações' })
      .expect(201);
    supportSession = session.body.id;
  });
  afterAll(() => t.close());

  /** Roda a rota com cada ator e confere o status (e o código do erro, se pedido). */
  function matrix(
    title: string,
    options: Parameters<typeof fresh>[0],
    call: (actor: Actor, ctx: Ctx) => Test,
    expected: Record<Actor, Cell>,
  ) {
    describe(title, () => {
      it.each(ACTORS)('%s', async (actor) => {
        const ctx = await fresh(options);
        const cell = expected[actor];
        const { status, code } =
          typeof cell === 'number' ? { status: cell, code: undefined } : cell;
        const res = await as(actor, call(actor, ctx));
        const accepted = Array.isArray(status) ? status : [status];
        expect(accepted, `${title} · ${actor} respondeu ${res.status}: ${res.text}`).toContain(
          res.status,
        );
        if (code) expect(res.body.error?.code).toBe(code);
      });
    });
  }

  const everyone = (cell: Cell): Record<Actor, Cell> =>
    Object.fromEntries(ACTORS.map((actor) => [actor, cell])) as Record<Actor, Cell>;
  const http = () => t.http();
  const spaceReviews_ = (path = '') => `/v1/spaces/${space.id}/reviews${path}`;
  const manage = (path = '') => `/v1/manage/spaces/${space.id}/reviews${path}`;

  // ---------------------------------------------------------------------------------------------
  describe('rotas públicas (RN-REVIEW-07: sem login, mesma visibilidade da página do espaço)', () => {
    const publicCell: Cell = 200;
    matrix('GET /spaces/:id/reviews/summary', {}, () => http().get(spaceReviews_('/summary')), {
      ...everyone(200),
      blocked: publicCell,
    });
    matrix('GET /spaces/:id/reviews', {}, () => http().get(spaceReviews_()), {
      ...everyone(200),
      blocked: publicCell,
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('jogador logado (RF-REVIEW-01, 02 e 08)', () => {
    matrix(
      'GET /spaces/:id/reviews/eligibility',
      {},
      () => http().get(spaceReviews_('/eligibility')),
      { ...everyone(200), anon: 401, blocked: BLOCKED },
    );

    matrix(
      'PUT /spaces/:id/reviews/me',
      {},
      () => http().put(spaceReviews_('/me')).send({ rating: 4 }),
      {
        anon: 401,
        // Quem usou o espaço avalia; quem não usou, não (RN-REVIEW-01).
        author: 200,
        player: { status: 403, code: 'REVIEW_NOT_ELIGIBLE' },
        foreignOwner: { status: 403, code: 'REVIEW_NOT_ELIGIBLE' },
        platform: { status: 403, code: 'REVIEW_NOT_ELIGIBLE' },
        support: { status: 403, code: 'REVIEW_NOT_ELIGIBLE' },
        // A equipe não avalia o próprio espaço.
        owner: { status: 403, code: 'REVIEW_NOT_ALLOWED' },
        admin: { status: 403, code: 'REVIEW_NOT_ALLOWED' },
        teacher: { status: 403, code: 'REVIEW_NOT_ALLOWED' },
        blocked: BLOCKED,
      },
    );

    matrix('DELETE /spaces/:id/reviews/me', {}, () => http().delete(spaceReviews_('/me')), {
      ...everyone({ status: 404, code: 'REVIEW_NOT_FOUND' }),
      anon: 401,
      author: 204,
      blocked: BLOCKED,
    });

    matrix('GET /me/reviews', {}, () => http().get('/v1/me/reviews'), {
      ...everyone(200),
      anon: 401,
      blocked: BLOCKED,
    });

    // Denunciar: qualquer pessoa logada, menos o autor da própria avaliação.
    matrix(
      'POST /reviews/:id/reports',
      {},
      (actor, ctx) =>
        http()
          .post(`/v1/reviews/${actor === 'author' ? ctx.ownReviewId : ctx.reviewId}/reports`)
          .send({ reason: 'SPAM' }),
      {
        ...everyone(204),
        anon: 401,
        author: { status: 403, code: 'REVIEW_REPORT_OWN' },
        blocked: BLOCKED,
      },
    );

    it('Minhas avaliações lista só as da própria pessoa', async () => {
      await fresh();
      const mine = await as('author', http().get('/v1/me/reviews')).expect(200);
      expect(mine.body.items.length).toBeGreaterThan(0);
      for (const item of mine.body.items) expect(item.space.id).toBe(space.id);
      const ids = mine.body.items.map((item: { id: string }) => item.id);
      for (const actor of ['player', 'owner', 'foreignOwner', 'platform'] as const) {
        const res = await as(actor, http().get('/v1/me/reviews')).expect(200);
        for (const item of res.body.items) expect(ids).not.toContain(item.id);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('painel do espaço (RF-REVIEW-06, RN-REVIEW-05)', () => {
    // Ver: Dono, Admin, Professor. O Super só em modo suporte (vale como Dono).
    const view: Record<Actor, Cell> = {
      anon: 401,
      player: 403,
      author: 403,
      owner: 200,
      admin: 200,
      teacher: 200,
      foreignOwner: 403,
      blocked: BLOCKED,
      platform: 403,
      support: 200,
    };
    // Responder e denunciar: só Dono e Admin (e o suporte). Professor só lê.
    const write = (ok: Cell): Record<Actor, Cell> => ({
      ...view,
      owner: ok,
      admin: ok,
      teacher: 403,
      support: ok,
    });

    matrix('GET /manage/.../reviews', {}, () => http().get(manage()), view);
    matrix('GET /manage/.../reviews/summary', {}, () => http().get(manage('/summary')), view);
    matrix(
      'PUT /manage/.../reviews/:id/reply',
      {},
      (_actor, ctx) =>
        http()
          .put(manage(`/${ctx.reviewId}/reply`))
          .send({ body: 'Obrigado!' }),
      write(200),
    );
    matrix(
      'DELETE /manage/.../reviews/:id/reply',
      { reply: true },
      (_actor, ctx) => http().delete(manage(`/${ctx.reviewId}/reply`)),
      write(204),
    );
    matrix(
      'POST /manage/.../reviews/:id/reports',
      {},
      (_actor, ctx) =>
        http()
          .post(manage(`/${ctx.reviewId}/reports`))
          .send({ reason: 'FALSE_INFO' }),
      write(204),
    );

    it('os negados não mudam nada: a avaliação segue sem resposta e sem denúncia', async () => {
      const ctx = await fresh();
      for (const actor of ['player', 'author', 'teacher', 'foreignOwner', 'platform'] as const) {
        await as(
          actor,
          http()
            .put(manage(`/${ctx.reviewId}/reply`))
            .send({ body: 'Invasão' }),
        ).expect(403);
        await as(
          actor,
          http()
            .post(manage(`/${ctx.reviewId}/reports`))
            .send({ reason: 'SPAM' }),
        ).expect(403);
      }
      const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, ctx.reviewId));
      expect(row?.reply).toBeNull();
      expect(
        await t.db
          .select()
          .from(spaceReviewReports)
          .where(eq(spaceReviewReports.reviewId, ctx.reviewId)),
      ).toEqual([]);
    });

    it('entre espaços: o Dono não age em avaliação nem em painel de outro espaço', async () => {
      const ctx = await fresh();
      // Avaliação de outro espaço pelo caminho do próprio: 404 (não revela que existe).
      for (const res of [
        await as(
          'owner',
          http()
            .put(manage(`/${ctx.foreignReviewId}/reply`))
            .send({ body: 'x' }),
        ),
        await as('owner', http().delete(manage(`/${ctx.foreignReviewId}/reply`))),
        await as(
          'owner',
          http()
            .post(manage(`/${ctx.foreignReviewId}/reports`))
            .send({ reason: 'SPAM' }),
        ),
      ]) {
        expect(res.status).toBe(404);
      }
      // Painel de outro espaço: 403.
      await as('owner', http().get(`/v1/manage/spaces/${other.id}/reviews`)).expect(403);
      await as(
        'owner',
        http()
          .put(`/v1/manage/spaces/${other.id}/reviews/${ctx.foreignReviewId}/reply`)
          .send({ body: 'x' }),
      ).expect(403);
      const [row] = await t.db
        .select()
        .from(spaceReviews)
        .where(eq(spaceReviews.id, ctx.foreignReviewId));
      expect(row?.reply).toBeNull();
    });

    it('a sessão de suporte de um espaço não vale em outro', async () => {
      const res = await http()
        .get(`/v1/manage/spaces/${other.id}/reviews`)
        .set(...bearer(actors.platform))
        .set(SUPPORT, supportSession);
      expect(res.status).toBe(403);
    });

    it('nenhuma rota deixa o espaço apagar ou alterar a avaliação (decisão 103/104)', async () => {
      const ctx = await fresh();
      const before = (
        await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, ctx.reviewId))
      )[0];
      const attempts: Array<() => Test> = [
        () => http().delete(manage(`/${ctx.reviewId}`)),
        () =>
          http()
            .put(manage(`/${ctx.reviewId}`))
            .send({ rating: 1, comment: 'alterada' }),
        () =>
          http()
            .patch(manage(`/${ctx.reviewId}`))
            .send({ rating: 1 }),
        () =>
          http()
            .post(manage(`/${ctx.reviewId}/hide`))
            .send({ reason: 'x' }),
        () =>
          http()
            .post(manage(`/${ctx.reviewId}/unhide`))
            .send({ reason: 'x' }),
        () => http().delete(`/v1/reviews/${ctx.reviewId}`),
        () => http().put(`/v1/reviews/${ctx.reviewId}`).send({ rating: 1 }),
        () =>
          http().post(`/v1/spaces/${space.id}/reviews/${ctx.reviewId}/hide`).send({ reason: 'x' }),
      ];
      for (const [i, attempt] of attempts.entries()) {
        const res = await as('owner', attempt());
        expect(res.status, `tentativa ${i + 1}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      const after = (
        await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, ctx.reviewId))
      )[0];
      expect(after).toEqual(before);
    });

    it('PUT /spaces/:id/reviews/me do autor não escolhe a avaliação nem o autor: id e userId extras → 400', async () => {
      const ctx = await fresh();
      const [foreignBefore] = await t.db
        .select()
        .from(spaceReviews)
        .where(eq(spaceReviews.id, ctx.reviewId));
      // O autor é elegível (a mesma chamada sem os campos extras edita a dele)...
      await as('author', http().put(spaceReviews_('/me')).send({ rating: 3 })).expect(200);
      // ...mas o corpo é estrito: campos que apontam para outra avaliação são recusados.
      for (const extra of [{ id: ctx.reviewId }, { userId: null }, { reviewId: ctx.reviewId }]) {
        const res = await as(
          'author',
          http()
            .put(spaceReviews_('/me'))
            .send({ rating: 1, ...extra }),
        );
        expect(res.status, JSON.stringify(extra)).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      // Nada mudou: nem a avaliação alheia, nem a do próprio autor.
      const [foreignAfter] = await t.db
        .select()
        .from(spaceReviews)
        .where(eq(spaceReviews.id, ctx.reviewId));
      expect(foreignAfter).toEqual(foreignBefore);
      const [own] = await t.db
        .select()
        .from(spaceReviews)
        .where(eq(spaceReviews.id, ctx.ownReviewId));
      expect(own).toMatchObject({ rating: 3, userId: actors.author.id });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('Super (RF-REVIEW-07): só o Super, com ou sem sessão de suporte', () => {
    const superOnly = (ok: Cell): Record<Actor, Cell> => ({
      ...everyone({ status: 403, code: 'SUPER_REQUIRED' }),
      anon: 401,
      blocked: BLOCKED,
      platform: ok,
      support: ok,
    });

    matrix(
      'GET /super/reviews/reports',
      {},
      () => http().get('/v1/super/reviews/reports'),
      superOnly(200),
    );
    matrix(
      'GET /super/reviews',
      {},
      () => http().get(`/v1/super/reviews?spaceId=${space.id}`),
      superOnly(200),
    );
    matrix(
      'GET /super/reviews/summary',
      {},
      () => http().get(`/v1/super/reviews/summary?spaceId=${space.id}`),
      superOnly(200),
    );
    matrix(
      'GET /super/reviews/:id',
      {},
      (_actor, ctx) => http().get(`/v1/super/reviews/${ctx.reviewId}`),
      superOnly(200),
    );
    matrix(
      'POST /super/reviews/:id/hide',
      {},
      (_actor, ctx) =>
        http().post(`/v1/super/reviews/${ctx.reviewId}/hide`).send({ reason: 'Ofensivo' }),
      superOnly(200),
    );
    matrix(
      'POST /super/reviews/:id/unhide',
      { hidden: true },
      (_actor, ctx) =>
        http().post(`/v1/super/reviews/${ctx.reviewId}/unhide`).send({ reason: 'Engano' }),
      superOnly(200),
    );
    matrix(
      'POST /super/reviews/reports/:id/dismiss',
      { report: true },
      (_actor, ctx) => http().post(`/v1/super/reviews/reports/${ctx.reportId}/dismiss`).send({}),
      superOnly(200),
    );

    it('os negados não ocultam, não reexibem e não descartam nada', async () => {
      const ctx = await fresh({ report: true });
      for (const actor of ['player', 'author', 'owner', 'admin', 'teacher'] as const) {
        await as(
          actor,
          http().post(`/v1/super/reviews/${ctx.reviewId}/hide`).send({ reason: 'x' }),
        ).expect(403);
        await as(
          actor,
          http().post(`/v1/super/reviews/reports/${ctx.reportId}/dismiss`).send({}),
        ).expect(403);
      }
      const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, ctx.reviewId));
      expect(row?.commentHiddenAt).toBeNull();
      const [report] = await t.db
        .select()
        .from(spaceReviewReports)
        .where(eq(spaceReviewReports.id, ctx.reportId));
      expect(report?.status).toBe('OPEN');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('espaço fora da vitrine (RN-REVIEW-07)', () => {
    it('resumo, lista, elegibilidade, PUT e denúncia respondem 404 para todos; o autor ainda exclui', async () => {
      const suspended = await createSpace(t.db, 'arena-permissoes-susp');
      const writer = await signUp(t, 'autor-susp-perm@exemplo.com', 'Autor Suspenso');
      await insertBooking(t.db, suspended, writer, 180);
      const mine = await putReview(t, writer, suspended.id, { rating: 2 }).expect(200);
      const anonymous = await insertReviewRow(t.db, suspended.id);
      await setSpaceStatus(t.db, suspended.id, 'SUSPENDED');

      const base = `/v1/spaces/${suspended.id}/reviews`;
      await http().get(`${base}/summary`).expect(404);
      await http().get(base).expect(404);
      for (const actor of ['player', 'author', 'platform'] as const) {
        await as(actor, http().get(`${base}/eligibility`)).expect(404);
        await as(actor, http().put(`${base}/me`).send({ rating: 3 })).expect(404);
        // Avaliação que não aparece em público não se denuncia.
        const res = await as(
          actor,
          http().post(`/v1/reviews/${anonymous.id}/reports`).send({ reason: 'SPAM' }),
        );
        expect(res.status).toBe(404);
      }
      expect(mine.body.id).toEqual(expect.any(String));
      await http()
        .delete(`${base}/me`)
        .set(...bearer(writer))
        .expect(204);
    });
  });
});
