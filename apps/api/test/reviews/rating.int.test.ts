import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoReviews } from '../../src/db/demo-reviews.js';
import { spaceMembers, spaceReviews, users } from '../../src/db/schema/index.js';
import { setUserReviewsCounted } from '../../src/reviews/review-rules.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, type Space } from '../bookings/fixtures.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertBooking, putReview, ratingOf } from './helpers.js';

// RN-REVIEW-03: contagem e soma no espaço, na mesma transação; média a partir de 5 avaliações;
// autor bloqueado fora da média. RF-REVIEW-03/04: resumo e lista pública sem dados internos.

let n = 0;

describe('avaliações: média, resumo e lista pública (RN-REVIEW-03, RF-REVIEW-03/04)', () => {
  let t: TestApp;
  let admin: SignedUp;

  /** Jogador com reserva terminada no espaço. */
  const player = async (space: Space, name = 'Bruna Costa Reis') => {
    const user = await signUp(t, `aval${n++}@exemplo.com`, name);
    await insertBooking(t.db, space, user, 180);
    return user;
  };

  const expectConsistent = async (spaceId: string, expected: { count: number; sum: number }) => {
    const { stored, actual } = await ratingOf(t.db, spaceId);
    expect(stored).toEqual(expected);
    expect(actual).toEqual(expected);
  };

  const summary = async (spaceId: string) =>
    (await t.http().get(`/v1/spaces/${spaceId}/reviews/summary`).expect(200)).body;

  const block = (user: SignedUp) =>
    t
      .http()
      .post(`/v1/super/users/${user.id}/block`)
      .set(...bearer(admin))
      .send({})
      .expect(200);
  const unblock = (user: SignedUp) =>
    t
      .http()
      .post(`/v1/super/users/${user.id}/unblock`)
      .set(...bearer(admin))
      .expect(200);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await superUser(t, 'super-aval@exemplo.com');
  });
  afterAll(() => t.close());

  it('criar, editar e excluir mantêm contagem e soma', async () => {
    const space = await createSpace(t.db, 'arena-media');
    const [a, b] = [await player(space), await player(space)];
    await putReview(t, a, space.id, { rating: 5 }).expect(200);
    await expectConsistent(space.id, { count: 1, sum: 5 });
    await putReview(t, b, space.id, { rating: 2 }).expect(200);
    await expectConsistent(space.id, { count: 2, sum: 7 });
    await putReview(t, a, space.id, { rating: 3 }).expect(200);
    await expectConsistent(space.id, { count: 2, sum: 5 });
    await t
      .http()
      .delete(`/v1/spaces/${space.id}/reviews/me`)
      .set(...bearer(b))
      .expect(204);
    await expectConsistent(space.id, { count: 1, sum: 3 });
  });

  it('concorrência: avaliações e edições ao mesmo tempo não perdem nada', async () => {
    const space = await createSpace(t.db, 'arena-concorrente');
    const players = await Promise.all(Array.from({ length: 8 }, () => player(space)));
    await Promise.all(
      players.map((user, i) => putReview(t, user, space.id, { rating: (i % 5) + 1 }).expect(200)),
    );
    // A mesma pessoa em paralelo: uma cria, as outras editam (nunca duas linhas).
    const [first] = players as [SignedUp];
    const results = await Promise.all([
      putReview(t, first, space.id, { rating: 5 }),
      putReview(t, first, space.id, { rating: 4 }),
      putReview(t, first, space.id, { rating: 3 }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    const rows = await t.db.select().from(spaceReviews).where(eq(spaceReviews.spaceId, space.id));
    expect(rows).toHaveLength(8);
    const sum = rows.reduce((acc, row) => acc + row.rating, 0);
    await expectConsistent(space.id, { count: 8, sum });

    const fresh = await Promise.all(Array.from({ length: 3 }, () => player(space)));
    await Promise.all([
      ...fresh.map((user) => putReview(t, user, space.id, { rating: 5 })),
      t
        .http()
        .delete(`/v1/spaces/${space.id}/reviews/me`)
        .set(...bearer(first)),
    ]);
    const after = await t.db.select().from(spaceReviews).where(eq(spaceReviews.spaceId, space.id));
    await expectConsistent(space.id, {
      count: after.length,
      sum: after.reduce((acc, row) => acc + row.rating, 0),
    });
  });

  it('bloquear tira as avaliações da média e da lista; desbloquear devolve', async () => {
    const space = await createSpace(t.db, 'arena-bloqueio');
    const other = await createSpace(t.db, 'arena-bloqueio-2');
    const [good, bad] = [await player(space), await player(space, 'Troll Silva')];
    await insertBooking(t.db, other, bad, 180);
    await putReview(t, good, space.id, { rating: 5 }).expect(200);
    await putReview(t, bad, space.id, { rating: 1, comment: 'Ruim demais' }).expect(200);
    await putReview(t, bad, other.id, { rating: 2 }).expect(200);
    await expectConsistent(space.id, { count: 2, sum: 6 });

    await block(bad);
    await expectConsistent(space.id, { count: 1, sum: 5 });
    await expectConsistent(other.id, { count: 0, sum: 0 });
    const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect((await summary(space.id)).distribution).toContainEqual({ rating: 1, count: 0 });

    await unblock(bad);
    await expectConsistent(space.id, { count: 2, sum: 6 });
    await expectConsistent(other.id, { count: 1, sum: 2 });
  });

  it('corrida bloqueio x criação: a avaliação feita durante o bloqueio nasce fora da média', async () => {
    const space = await createSpace(t.db, 'arena-corrida');
    const user = await player(space);
    let pending: Promise<{ status: number; body: { id: string } }> | undefined;
    await t.db.transaction(async (tx) => {
      // O bloqueio do Super em curso: conta travada, status ainda não gravado.
      await tx.select().from(users).where(eq(users.id, user.id)).for('update');
      pending = putReview(t, user, space.id, { rating: 5 }).then((res) => res);
      // O PUT passa pela autenticação (a conta ainda está ativa) e espera a conta.
      const deadline = Date.now() + 5_000;
      for (;;) {
        const { rows } = await t.db.execute<{ waiting: number }>(sql`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `);
        if ((rows[0]?.waiting ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error('O PUT não esperou a conta travada.');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await tx.update(users).set({ status: 'BLOCKED' }).where(eq(users.id, user.id));
      await setUserReviewsCounted(tx, user.id, false);
    });
    const res = await pending;
    expect(res?.status).toBe(200);
    const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.userId, user.id));
    expect(row?.counted).toBe(false);
    await expectConsistent(space.id, { count: 0, sum: 0 });

    // O desbloqueio devolve a nota à média.
    await unblock(user);
    await expectConsistent(space.id, { count: 1, sum: 5 });
  });

  it('resumo: com menos de 5, sem média ("Novo"); a partir de 5, média com uma casa', async () => {
    const space = await createSpace(t.db, 'arena-resumo');
    const reviewers = await Promise.all(Array.from({ length: 6 }, () => player(space)));
    const bodies = [
      { rating: 5, tags: ['GOOD_COURT', 'CLEAN'], comment: 'Excelente!' },
      { rating: 5, tags: ['GOOD_COURT'] },
      { rating: 4, tags: ['GOOD_COURT', 'ON_TIME'], comment: 'Muito bom.' },
      { rating: 2, tags: ['EXPENSIVE'] },
    ];
    for (const [i, body] of bodies.entries()) {
      await putReview(t, reviewers[i] as SignedUp, space.id, body).expect(200);
    }
    const small = await summary(space.id);
    expect(small).toMatchObject({ count: 4, average: null });
    expect(small.distribution).toEqual([
      { rating: 5, count: 2 },
      { rating: 4, count: 1 },
      { rating: 3, count: 0 },
      { rating: 2, count: 1 },
      { rating: 1, count: 0 },
    ]);
    expect(small.topTags).toEqual([
      { tag: 'GOOD_COURT', count: 3 },
      { tag: 'CLEAN', count: 1 },
      { tag: 'EXPENSIVE', count: 1 },
    ]);
    expect(small.recent.map((r: { comment: string }) => r.comment)).toEqual([
      'Muito bom.',
      'Excelente!',
    ]);

    await putReview(t, reviewers[4] as SignedUp, space.id, { rating: 4 }).expect(200);
    const full = await summary(space.id);
    expect(full).toMatchObject({ count: 5, average: 4 });
    await putReview(t, reviewers[5] as SignedUp, space.id, { rating: 5 }).expect(200);
    expect(await summary(space.id)).toMatchObject({ count: 6, average: 4.2 }); // 25/6 = 4,17

    // O card da vitrine, a página do espaço e os recentes leem as colunas.
    const search = await t.http().get('/v1/spaces?q=arena-resumo').expect(200);
    expect(search.body.items[0]).toMatchObject({
      id: space.id,
      rating: { count: 6, average: 4.2 },
    });
    const page = await t.http().get('/v1/spaces/arena-resumo').expect(200);
    expect(page.body.rating).toEqual({ count: 6, average: 4.2 });
    const recent = await t
      .http()
      .get('/v1/me/recent-spaces')
      .set(...bearer(reviewers[0] as SignedUp))
      .expect(200);
    expect(recent.body.items[0]).toMatchObject({
      id: space.id,
      rating: { count: 6, average: 4.2 },
    });

    await createSpace(t.db, 'arena-nova');
    const freshCard = await t.http().get('/v1/spaces?q=arena-nova').expect(200);
    expect(freshCard.body.items[0].rating).toEqual({ count: 0, average: null });
  });

  it('lista pública: autor formatado, sem id de usuário nem dados internos; filtro e cursor', async () => {
    const space = await createSpace(t.db, 'arena-lista');
    const authors = await Promise.all([
      player(space, 'Ana Paula Souza'),
      player(space, 'joão da silva'),
      player(space, 'Madonna'),
    ]);
    for (const [i, user] of authors.entries()) {
      await putReview(t, user, space.id, { rating: i === 1 ? 3 : 5, comment: `Comentário ${i}` });
    }
    const res = await t.http().get(`/v1/spaces/${space.id}/reviews?limit=2`).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toEqual(expect.any(String));
    const [newest] = res.body.items;
    expect(Object.keys(newest).sort()).toEqual(
      [
        'author',
        'comment',
        'commentHidden',
        'createdAt',
        'id',
        'rating',
        'reply',
        'tags',
        'updatedAt',
      ].sort(),
    );
    expect(newest.author).toEqual({ name: 'Madonna', avatarUrl: null, kind: 'PLAYER' });
    const json = JSON.stringify(res.body);
    for (const user of authors) expect(json).not.toContain(user.id);
    expect(json).not.toContain('Souza');

    const next = await t
      .http()
      .get(`/v1/spaces/${space.id}/reviews?limit=2&cursor=${res.body.nextCursor}`)
      .expect(200);
    expect(next.body.items.map((r: { author: { name: string } }) => r.author.name)).toEqual([
      'Ana S.',
    ]);
    expect(next.body.nextCursor).toBeNull();

    const threes = await t.http().get(`/v1/spaces/${space.id}/reviews?rating=3`).expect(200);
    expect(threes.body.items.map((r: { author: { name: string } }) => r.author.name)).toEqual([
      'João S.',
    ]);
    await t.http().get(`/v1/spaces/${space.id}/reviews?rating=6`).expect(400);
    const bad = await t.http().get(`/v1/spaces/${space.id}/reviews?cursor=xyz`).expect(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });

  it('comentário oculto: nulo na lista com commentHidden; o autor ainda vê em Minhas avaliações', async () => {
    const space = await createSpace(t.db, 'arena-oculto');
    const user = await player(space);
    const review = await putReview(t, user, space.id, { rating: 1, comment: 'Texto ofensivo' });
    await t
      .http()
      .post(`/v1/super/reviews/${review.body.id}/hide`)
      .set(...bearer(admin))
      .send({ reason: 'Ofensivo' })
      .expect(200);
    const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
    expect(list.body.items[0]).toMatchObject({ rating: 1, comment: null, commentHidden: true });
    expect((await summary(space.id)).recent).toEqual([]);
    await expectConsistent(space.id, { count: 1, sum: 1 });

    const mine = await t
      .http()
      .get('/v1/me/reviews')
      .set(...bearer(user))
      .expect(200);
    expect(mine.body.items[0]).toMatchObject({
      id: review.body.id,
      comment: 'Texto ofensivo',
      commentHidden: true,
      space: { id: space.id, slug: 'arena-oculto', inShowcase: true },
    });
    // Editar o comentário oculto não o reexibe (RN-REVIEW-04).
    const edited = await putReview(t, user, space.id, { rating: 2, comment: 'Outro texto' });
    expect(edited.body).toMatchObject({ comment: 'Outro texto', commentHidden: true });
  });

  it('Minhas avaliações: só as da pessoa, paginadas, com espaço fora da vitrine marcado', async () => {
    const [s1, s2] = [
      await createSpace(t.db, 'arena-minhas-1'),
      await createSpace(t.db, 'arena-minhas-2'),
    ];
    const user = await player(s1);
    await insertBooking(t.db, s2, user, 180);
    await putReview(t, user, s1.id, { rating: 4 }).expect(200);
    await putReview(t, user, s2.id, { rating: 3 }).expect(200);
    const stranger = await player(s1);
    await putReview(t, stranger, s1.id, { rating: 1 }).expect(200);
    await setSpaceStatus(t.db, s2.id, 'CLOSED');

    const page1 = await t
      .http()
      .get('/v1/me/reviews?limit=1')
      .set(...bearer(user))
      .expect(200);
    expect(page1.body.items).toEqual([
      expect.objectContaining({
        rating: 3,
        space: expect.objectContaining({ inShowcase: false }),
        canEdit: false,
      }),
    ]);
    const page2 = await t
      .http()
      .get(`/v1/me/reviews?limit=1&cursor=${page1.body.nextCursor}`)
      .set(...bearer(user))
      .expect(200);
    expect(page2.body).toEqual({
      items: [expect.objectContaining({ rating: 4, canEdit: true })],
      nextCursor: null,
    });
    // Entrou na equipe do espaço: só leitura.
    await t.db
      .insert(spaceMembers)
      .values({ userId: user.id, spaceId: s1.id, role: 'ADMIN', status: 'ACTIVE' });
    const asStaff = await t
      .http()
      .get('/v1/me/reviews')
      .set(...bearer(user))
      .expect(200);
    expect(asStaff.body.items.map((i: { canEdit: boolean }) => i.canEdit)).toEqual([false, false]);
  });

  it('espaço fora da vitrine: resumo e lista 404 (RN-REVIEW-07)', async () => {
    const space = await createSpace(t.db, 'arena-fechada');
    await setSpaceStatus(t.db, space.id, 'SUSPENDED');
    for (const path of ['reviews', 'reviews/summary']) {
      const res = await t.http().get(`/v1/spaces/${space.id}/${path}`).expect(404);
      expect(res.body.error.code).toBe('SPACE_NOT_FOUND');
    }
  });

  it('seed de demonstração: contagem coerente, resposta e comentário oculto; idempotente', async () => {
    const space = await createSpace(t.db, 'arena-seed-aval');
    const authors = await Promise.all(
      Array.from({ length: 5 }, (_, i) => signUp(t, `seed${i}-${n++}@exemplo.com`, `Autor ${i}`)),
    );
    const reviews = authors.map((author, i) => ({
      userId: author.id,
      rating: 5 - (i % 2),
      comment: `Comentário ${i}`,
      daysAgo: i + 1,
      ...(i === 0 ? { reply: { body: 'Valeu!', byUserId: admin.id } } : {}),
      ...(i === 1 ? { hidden: { reason: 'Teste', byUserId: admin.id } } : {}),
    }));
    expect(await seedDemoReviews(t.db, space.id, reviews)).toBe(5);
    expect(await seedDemoReviews(t.db, space.id, reviews)).toBe(0);
    await expectConsistent(space.id, { count: 5, sum: 23 });
    const res = await summary(space.id);
    expect(res).toMatchObject({ count: 5, average: 4.6 });
    const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
    expect(list.body.items[0]).toMatchObject({
      comment: 'Comentário 0',
      reply: { body: 'Valeu!' },
    });
    expect(list.body.items[1]).toMatchObject({ comment: null, commentHidden: true });
  });

  it('autor removido aparece como "Usuário removido", sem foto', async () => {
    const space = await createSpace(t.db, 'arena-removido');
    const user = await player(space);
    await putReview(t, user, space.id, { rating: 4 }).expect(200);
    await t.db.update(spaceReviews).set({ userId: null }).where(eq(spaceReviews.spaceId, space.id));
    await t.db.update(users).set({ avatarUrl: 'https://x/foto.jpg' }).where(eq(users.id, user.id));
    const list = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
    expect(list.body.items[0].author).toEqual({
      name: 'Usuário removido',
      avatarUrl: null,
      kind: 'PLAYER',
    });
  });
});
