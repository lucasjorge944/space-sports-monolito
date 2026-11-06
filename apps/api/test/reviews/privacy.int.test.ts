import { reviewAverage } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spaceReviewReports, spaceReviews } from '../../src/db/schema/index.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertBooking, putReview } from './helpers.js';

// AV.5 · RN-REVIEW-04/06/07 e RF-REVIEW-03/04: a lista e o resumo públicos não expõem ids de
// usuário nem dados internos (moderação, denúncias, quem respondeu, contas bloqueadas ou
// excluídas), e o `rating` dos cards, do detalhe, dos recentes e dos favoritos acompanha a média.

let n = 0;
const SLUG = 'arena-privacidade';

/** Todas as chaves de um JSON, em qualquer profundidade. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

describe('avaliações: privacidade das rotas públicas e rating dos cards (AV.5)', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let platform: SignedUp;
  let outsider: SignedUp;
  const people: Record<string, SignedUp> = {};
  let hiddenId: string;
  let repliedId: string;
  let removedId: string;
  let blockedId: string;

  const player = async (label: string, name: string) => {
    const user = await signUp(t, `priv${n++}-${label}@exemplo.com`, name);
    await insertBooking(t.db, space, user, 180);
    people[label] = user;
    return user;
  };

  /** Todo texto/ids que não podem aparecer em nenhuma resposta pública. */
  const forbiddenTexts = () => [
    ...Object.values(people).flatMap((user) => [user.id, user.email]),
    owner.id,
    owner.email,
    platform.id,
    platform.email,
    'Albuquerque',
    'Teixeira',
    'Nogueira',
    'Pereira Lima',
    'MOTIVO_INTERNO_DA_MODERACAO',
    'DETALHE_DA_DENUNCIA',
    'COMENTARIO_DO_BLOQUEADO',
    'NOME_DO_BLOQUEADO',
    'COMENTARIO_DO_REMOVIDO',
    'NOME_DO_REMOVIDO',
    'COMENTARIO_OCULTO_PELO_SUPER',
    'RESPOSTA_DO_REMOVIDO',
    'Denunciante Secreto',
  ];

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, SLUG);
    owner = await member(t, 'dono-priv@exemplo.com', space.id, 'OWNER');
    platform = await superUser(t, 'super-priv@exemplo.com');
    outsider = await signUp(t, 'denunciante-priv@exemplo.com', 'Denunciante Secreto Silva');
    people.outsider = outsider;

    const common = [
      ['ana', 'Ana Beatriz Albuquerque', 5, 'Quadra ótima e bem cuidada.'],
      ['bia', 'Bianca Teixeira', 4, 'Gostei do atendimento.'],
      ['caio', 'Caio Nogueira', 3, 'Ok, nada demais.'],
      ['dani', 'Daniela Pereira Lima', 5, 'Voltarei com certeza.'],
    ] as const;
    for (const [label, name, rating, comment] of common) {
      const user = await player(label, name);
      await putReview(t, user, space.id, { rating, comment, tags: [] }).expect(200);
    }

    // Oculta pelo Super (com motivo interno), respondida pelo Dono e denunciada.
    const hidden = await player('hidden', 'Hugo Oculto Nogueira');
    hiddenId = (
      await putReview(t, hidden, space.id, { rating: 1, comment: 'COMENTARIO_OCULTO_PELO_SUPER' })
    ).body.id;
    await t
      .http()
      .post(`/v1/super/reviews/${hiddenId}/hide`)
      .set(...bearer(platform))
      .send({ reason: 'MOTIVO_INTERNO_DA_MODERACAO' })
      .expect(200);
    await t
      .http()
      .put(`/v1/manage/spaces/${space.id}/reviews/${hiddenId}/reply`)
      .set(...bearer(owner))
      .send({ body: 'Lamentamos o ocorrido.' })
      .expect(200);
    await t
      .http()
      .post(`/v1/reviews/${hiddenId}/reports`)
      .set(...bearer(outsider))
      .send({ reason: 'OFFENSIVE', details: 'DETALHE_DA_DENUNCIA' })
      .expect(204);
    const replied = await player('replied', 'Rafael Respondido Teixeira');
    repliedId = (await putReview(t, replied, space.id, { rating: 2, comment: 'Demorou.' })).body.id;
    await t
      .http()
      .put(`/v1/manage/spaces/${space.id}/reviews/${repliedId}/reply`)
      .set(...bearer(owner))
      .send({ body: 'Vamos melhorar, obrigado.' })
      .expect(200);

    // Autor bloqueado: some de tudo o que é público.
    const blocked = await player('blocked', 'NOME_DO_BLOQUEADO Teixeira');
    blockedId = (
      await putReview(t, blocked, space.id, { rating: 1, comment: 'COMENTARIO_DO_BLOQUEADO' })
    ).body.id;
    await t
      .http()
      .post(`/v1/super/users/${blocked.id}/block`)
      .set(...bearer(platform))
      .send({})
      .expect(200);

    // Conta excluída: a nota fica, o resto sai.
    const removed = await player('removed', 'NOME_DO_REMOVIDO Albuquerque');
    removedId = (
      await putReview(t, removed, space.id, { rating: 4, comment: 'COMENTARIO_DO_REMOVIDO' })
    ).body.id;
    await t
      .http()
      .put(`/v1/manage/spaces/${space.id}/reviews/${removedId}/reply`)
      .set(...bearer(owner))
      .send({ body: 'RESPOSTA_DO_REMOVIDO' })
      .expect(200);
    await anonymizeUser(t.db, removed.id);
  });
  afterAll(() => t.close());

  /** O que o público (e cada tipo de logado) enxerga das avaliações do espaço. */
  async function publicPayloads(viewer?: SignedUp) {
    const get = (url: string) => {
      const req = t.http().get(url);
      if (viewer) req.set(...bearer(viewer));
      return req.expect(200);
    };
    const base = `/v1/spaces/${space.id}/reviews`;
    const pages: unknown[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`${base}?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      pages.push(res.body);
      cursor = res.body.nextCursor;
    } while (cursor);
    return {
      summary: (await get(`${base}/summary`)).body,
      pages,
      byRating: await Promise.all(
        [1, 2, 3, 4, 5].map(async (rating) => (await get(`${base}?rating=${rating}`)).body),
      ),
      detail: (await get(`/v1/spaces/${SLUG}`)).body,
    };
  }

  const viewers: Array<[string, () => SignedUp | undefined]> = [
    ['anônimo', () => undefined],
    ['jogador de fora', () => outsider],
    ['Dono (na rota pública)', () => owner],
    ['Super (na rota pública)', () => platform],
  ];

  it.each(viewers)(
    '%s: nenhum id, e-mail, sobrenome, texto interno ou conta bloqueada/excluída',
    async (_label, who) => {
      const payloads = await publicPayloads(who());
      const text = JSON.stringify(payloads);
      for (const forbidden of forbiddenTexts()) {
        expect(text, `vazou: ${forbidden}`).not.toContain(forbidden);
      }
      // Chaves internas nunca aparecem nas avaliações, em qualquer profundidade (o detalhe do
      // espaço tem telefone e outros campos próprios; ele entra só na busca por texto acima).
      const keys = keysOf({
        summary: payloads.summary,
        pages: payloads.pages,
        byRating: payloads.byRating,
      });
      for (const internal of [
        'userId',
        'user_id',
        'email',
        'phone',
        'counted',
        'commentHiddenBy',
        'commentHiddenReason',
        'commentHiddenAt',
        'hidden',
        'replyBy',
        'reporter',
        'reports',
        'openReports',
        'reportedBySpace',
        'replyNotifiedAt',
        'blocked',
        'reason',
        'details',
      ]) {
        expect(keys.has(internal), `chave interna na resposta pública: ${internal}`).toBe(false);
      }
    },
  );

  it('o formato da lista é fechado: só as chaves documentadas', async () => {
    const { pages, summary } = await publicPayloads();
    const items = (pages as Array<{ items: Array<Record<string, unknown>> }>).flatMap(
      (p) => p.items,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
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
      expect(Object.keys(item.author as object).sort()).toEqual(['avatarUrl', 'kind', 'name']);
      if (item.reply) {
        expect(Object.keys(item.reply as object).sort()).toEqual([
          'body',
          'repliedAt',
          'updatedAt',
        ]);
      }
    }
    expect(Object.keys(summary).sort()).toEqual(
      ['average', 'count', 'distribution', 'recent', 'topTags'].sort(),
    );
    for (const recent of summary.recent) {
      expect(Object.keys(recent).sort()).toEqual(
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
    }
  });

  it('autores aparecem como "Primeiro N." e a conta excluída como "Usuário removido"', async () => {
    const { pages } = await publicPayloads();
    const items = (
      pages as Array<{ items: Array<{ id: string; author: { name: string } }> }>
    ).flatMap((p) => p.items);
    const names = items.map((item) => item.author.name).sort();
    expect(names).toEqual(
      [
        'Ana A.',
        'Bianca T.',
        'Caio N.',
        'Daniela L.',
        'Hugo N.',
        'Rafael T.',
        'Usuário removido',
      ].sort(),
    );
  });

  it('comentário oculto sai da lista e do resumo, mas a nota fica na média; a resposta segue pública', async () => {
    const { pages, summary } = await publicPayloads();
    const items = (
      pages as Array<{
        items: Array<{
          id: string;
          comment: string | null;
          commentHidden: boolean;
          reply: { body: string } | null;
        }>;
      }>
    ).flatMap((p) => p.items);
    const hidden = items.find((item) => item.id === hiddenId);
    expect(hidden).toMatchObject({
      comment: null,
      commentHidden: true,
      reply: { body: 'Lamentamos o ocorrido.' },
    });
    expect(summary.recent.map((r: { id: string }) => r.id)).not.toContain(hiddenId);
    // 7 contam (a do bloqueado não): 5+4+3+5+1+2+4 = 24.
    expect(summary.count).toBe(7);
    expect(summary.average).toBe(reviewAverage(24, 7));
    expect(items.map((item) => item.id)).not.toContain(blockedId);
  });

  it('a conta excluída: nota e média ficam, comentário e resposta saem', async () => {
    const { pages } = await publicPayloads();
    const item = (
      pages as Array<{
        items: Array<{ id: string; rating: number; comment: string | null; reply: unknown }>;
      }>
    )
      .flatMap((p) => p.items)
      .find((i) => i.id === removedId);
    expect(item).toMatchObject({ rating: 4, comment: null, reply: null });
  });

  describe('o que cada papel vê onde o texto deveria aparecer', () => {
    it('o autor vê o próprio comentário oculto em Minhas avaliações; ninguém mais', async () => {
      const mine = await t
        .http()
        .get('/v1/me/reviews')
        .set(...bearer(people.hidden as SignedUp))
        .expect(200);
      expect(mine.body.items[0]).toMatchObject({
        id: hiddenId,
        comment: 'COMENTARIO_OCULTO_PELO_SUPER',
        commentHidden: true,
      });
      // O motivo interno e as denúncias não vão para o autor.
      const text = JSON.stringify(mine.body);
      expect(text).not.toContain('MOTIVO_INTERNO_DA_MODERACAO');
      expect(text).not.toContain('DETALHE_DA_DENUNCIA');
      expect(text).not.toContain('Denunciante');
    });

    it('o painel do espaço vê o comentário oculto como nulo e não vê o autor, nem a moderação', async () => {
      const list = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/reviews?limit=50`)
        .set(...bearer(owner))
        .expect(200);
      const text = JSON.stringify(list.body);
      for (const forbidden of forbiddenTexts().filter((f) => f !== owner.id && f !== owner.email)) {
        expect(text, `vazou no painel: ${forbidden}`).not.toContain(forbidden);
      }
      const keys = keysOf(list.body);
      for (const internal of ['userId', 'counted', 'commentHiddenReason', 'reporter', 'replyBy']) {
        expect(keys.has(internal), internal).toBe(false);
      }
      const hidden = list.body.items.find((i: { id: string }) => i.id === hiddenId);
      expect(hidden).toMatchObject({ comment: null, commentHidden: true });
      expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(blockedId);
    });

    it('só o Super vê o autor real, a moderação e as denúncias', async () => {
      const detail = await t
        .http()
        .get(`/v1/super/reviews/${hiddenId}`)
        .set(...bearer(platform))
        .expect(200);
      expect(detail.body.comment).toBe('COMENTARIO_OCULTO_PELO_SUPER');
      expect(detail.body.hidden).toMatchObject({ reason: 'MOTIVO_INTERNO_DA_MODERACAO' });
      expect(detail.body.author).toMatchObject({ userId: people.hidden?.id });
      expect(detail.body.reports[0]).toMatchObject({
        reason: 'OFFENSIVE',
        details: 'DETALHE_DA_DENUNCIA',
      });
      const blocked = await t
        .http()
        .get(`/v1/super/reviews/${blockedId}`)
        .set(...bearer(platform))
        .expect(200);
      expect(blocked.body).toMatchObject({ counted: false, author: { blocked: true } });
      const removed = await t
        .http()
        .get(`/v1/super/reviews/${removedId}`)
        .set(...bearer(platform))
        .expect(200);
      expect(removed.body).toMatchObject({
        comment: null,
        reply: null,
        author: { userId: null, name: 'Usuário removido' },
      });
    });

    it('a denúncia do denunciante some com a conta dele, mas a avaliação denunciada continua', async () => {
      const reporter = await signUp(t, `priv${n++}-reporter@exemplo.com`, 'Quem Denuncia Sozinho');
      await t
        .http()
        .post(`/v1/reviews/${repliedId}/reports`)
        .set(...bearer(reporter))
        .send({ reason: 'SPAM' })
        .expect(204);
      expect(
        await t.db
          .select()
          .from(spaceReviewReports)
          .where(eq(spaceReviewReports.reporterUserId, reporter.id)),
      ).toHaveLength(1);
      await anonymizeUser(t.db, reporter.id);
      expect(
        await t.db
          .select()
          .from(spaceReviewReports)
          .where(eq(spaceReviewReports.reporterUserId, reporter.id)),
      ).toEqual([]);
      const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, repliedId));
      expect(row?.rating).toBe(2);
    });
  });

  describe('rating nos cards e no detalhe (RF-REVIEW-03)', () => {
    const find = async (slug: string, viewer?: SignedUp) => {
      const req = t.http().get('/v1/spaces').query({ q: slug });
      if (viewer) req.set(...bearer(viewer));
      const res = await req.expect(200);
      return res.body.items.find((item: { slug: string }) => item.slug === slug);
    };

    it('card, detalhe, recentes e favoritos têm só { count, average } e batem com a média', async () => {
      const viewer = people.ana as SignedUp;
      await t
        .http()
        .put(`/v1/spaces/${space.id}/favorite`)
        .set(...bearer(viewer))
        .expect(204);
      const card = await find(SLUG);
      const detail = (await t.http().get(`/v1/spaces/${SLUG}`).expect(200)).body;
      const recent = (
        await t
          .http()
          .get('/v1/me/recent-spaces')
          .set(...bearer(viewer))
          .expect(200)
      ).body.items.find((item: { slug: string }) => item.slug === SLUG);
      const favorite = (
        await t
          .http()
          .get('/v1/me/favorites')
          .set(...bearer(viewer))
          .expect(200)
      ).body.items.find((item: { slug: string }) => item.slug === SLUG);

      const expected = { count: 7, average: reviewAverage(24, 7) };
      for (const [where, source] of Object.entries({ card, detail, recent, favorite })) {
        expect(source, where).toBeDefined();
        expect(source.rating, where).toEqual(expected);
        expect(Object.keys(source.rating).sort(), where).toEqual(['average', 'count']);
      }
      expect(expected.average).toBe(3.4);
    });

    it('menos de 5 avaliações: média nula ("Novo") em todos; bloqueado não conta', async () => {
      const small = await createSpace(t.db, 'arena-privacidade-nova');
      const users = [];
      for (let i = 0; i < 5; i++) {
        const user = await signUp(t, `priv${n++}-novo@exemplo.com`, `Autor Novo ${i}`);
        await insertBooking(t.db, small, user, 180);
        await putReview(t, user, small.id, { rating: 5 }).expect(200);
        users.push(user);
      }
      expect((await find('arena-privacidade-nova'))?.rating).toEqual({ count: 5, average: 5 });
      // Bloquear um tira a 5ª: volta a "Novo", em todos os lugares.
      await t
        .http()
        .post(`/v1/super/users/${users[0]?.id}/block`)
        .set(...bearer(platform))
        .send({})
        .expect(200);
      const card = await find('arena-privacidade-nova');
      expect(card?.rating).toEqual({ count: 4, average: null });
      const detail = (await t.http().get('/v1/spaces/arena-privacidade-nova').expect(200)).body;
      expect(detail.rating).toEqual({ count: 4, average: null });
      const summary = (await t.http().get(`/v1/spaces/${small.id}/reviews/summary`).expect(200))
        .body;
      expect(summary).toMatchObject({ count: 4, average: null });
      // Desbloquear devolve.
      await t
        .http()
        .post(`/v1/super/users/${users[0]?.id}/unblock`)
        .set(...bearer(platform))
        .expect(200);
      expect((await find('arena-privacidade-nova'))?.rating).toEqual({ count: 5, average: 5 });
    });

    it('arredondamento da média em uma casa: 4,25 → 4,3 e 3,95 → 4,0 (como o cliente exibe)', async () => {
      // 17/4 = 4,25 ; 79/20 = 3,95 ; 14/3 = 4,666...
      expect(reviewAverage(17, 4, 1)).toBe(4.3);
      expect(reviewAverage(79, 20)).toBe(4);
      expect(reviewAverage(14, 3, 1)).toBe(4.7);
      expect(reviewAverage(0, 0, 1)).toBeNull();
    });

    it('espaço sem nenhuma avaliação: { count: 0, average: null } e resumo vazio', async () => {
      const empty = await createSpace(t.db, 'arena-privacidade-vazia');
      expect((await find('arena-privacidade-vazia'))?.rating).toEqual({ count: 0, average: null });
      const summary = (await t.http().get(`/v1/spaces/${empty.id}/reviews/summary`).expect(200))
        .body;
      expect(summary).toMatchObject({ count: 0, average: null, topTags: [], recent: [] });
      expect(summary.distribution).toEqual([5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })));
      const list = (await t.http().get(`/v1/spaces/${empty.id}/reviews`).expect(200)).body;
      expect(list).toEqual({ items: [], nextCursor: null });
    });
  });

  it('resumo: até 3 comentários recentes, só com comentário visível, mais novos primeiro; chips mais citados', async () => {
    const arena = await createSpace(t.db, 'arena-privacidade-chips');
    const tagSets = [
      ['GOOD_COURT', 'CLEAN'],
      ['GOOD_COURT', 'GOOD_SERVICE'],
      ['GOOD_COURT', 'CLEAN', 'GOOD_VALUE'],
      ['CLEAN'],
      ['GOOD_SERVICE'],
      [],
    ];
    const ids: string[] = [];
    for (const [i, tags] of tagSets.entries()) {
      const user = await signUp(t, `priv${n++}-chips@exemplo.com`, `Pessoa Chips ${i}`);
      await insertBooking(t.db, arena, user, 180);
      const res = await putReview(t, user, arena.id, {
        rating: 5,
        tags,
        comment: i === 4 ? undefined : `Comentário ${i}`,
      }).expect(200);
      ids.push(res.body.id);
      // createdAt distinto e crescente, para a ordem ser inequívoca.
      await t.db
        .update(spaceReviews)
        .set({ createdAt: new Date(Date.now() - (tagSets.length - i) * 60_000) })
        .where(eq(spaceReviews.id, res.body.id));
    }
    const summary = (await t.http().get(`/v1/spaces/${arena.id}/reviews/summary`).expect(200)).body;
    expect(summary.recent.map((r: { comment: string }) => r.comment)).toEqual([
      'Comentário 5',
      'Comentário 3', // o 4 não tem comentário
      'Comentário 2',
    ]);
    // GOOD_COURT 3, CLEAN 3, GOOD_SERVICE 2, GOOD_VALUE 1: empate na ordem do catálogo.
    expect(summary.topTags).toEqual([
      { tag: 'GOOD_COURT', count: 3 },
      { tag: 'CLEAN', count: 3 },
      { tag: 'GOOD_SERVICE', count: 2 },
    ]);
    expect(summary.count).toBe(6);
  });
});
