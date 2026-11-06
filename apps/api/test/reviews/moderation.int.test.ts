import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, notifications, spaceReviews } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertBooking, putReview, ratingOf } from './helpers.js';

// RF-REVIEW-06 e 07, RN-REVIEW-04 e 05 (decisões 103 e 104): o painel vê (Dono, Admin,
// Professor), Dono e Admin respondem e denunciam; o Super modera o comentário (a nota fica) e
// descarta denúncias. Nenhuma rota deixa o espaço apagar ou alterar a avaliação.

let n = 0;
const SUPPORT = 'x-support-session';

describe('avaliações: gestão e moderação', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let platform: SignedUp;
  let author: SignedUp;
  let reviewId: string;

  const player = async (name = 'Paula Mendes') => {
    const user = await signUp(t, `mod${n++}@exemplo.com`, name);
    await insertBooking(t.db, space, user, 180);
    return user;
  };
  const manage = (user: SignedUp, path = '') =>
    t
      .http()
      .get(`/v1/manage/spaces/${space.id}/reviews${path}`)
      .set(...bearer(user));
  const reply = (user: SignedUp, id: string, body: string) =>
    t
      .http()
      .put(`/v1/manage/spaces/${space.id}/reviews/${id}/reply`)
      .set(...bearer(user))
      .send({ body });
  const auditOf = (id: string, action: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, action)));

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-moderacao');
    owner = await member(t, 'dono-mod@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin-mod@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'prof-mod@exemplo.com', space.id, 'TEACHER');
    platform = await superUser(t, 'super-mod@exemplo.com');
    author = await player('Rita de Cássia Prado');
    const res = await putReview(t, author, space.id, {
      rating: 2,
      tags: ['DIRTY'],
      comment: 'Banheiro sujo e quadra mal cuidada.',
    }).expect(200);
    reviewId = res.body.id;
  });
  afterAll(() => t.close());

  describe('painel do espaço', () => {
    it('Dono, Admin e Professor veem a lista e o resumo; jogador e outro espaço não', async () => {
      for (const user of [owner, admin, teacher]) {
        const list = await manage(user).expect(200);
        expect(list.body.items[0]).toMatchObject({
          id: reviewId,
          author: { name: 'Rita P.' },
          reportedBySpace: false,
        });
        await manage(user, '/summary').expect(200);
      }
      const outsider = await player();
      const forbidden = await manage(outsider).expect(403);
      expect(forbidden.body.error.code).toBe('SPACE_FORBIDDEN');
      const otherSpace = await createSpace(t.db, 'arena-mod-outra');
      await t
        .http()
        .get(`/v1/manage/spaces/${otherSpace.id}/reviews`)
        .set(...bearer(owner))
        .expect(403);
    });

    it('resumo do painel: média mesmo abaixo de 5, sem resposta e tendência de 90 dias', async () => {
      const weekly = await manage(owner, '/summary').expect(200);
      expect(weekly.body).toMatchObject({
        count: 1,
        average: 2,
        publicSummaryVisible: false,
        unansweredCount: 1,
        highlights: { positive: [], negative: [{ tag: 'DIRTY', count: 1 }] },
        trend: { granularity: 'WEEK', count: 1, average: 2 },
      });
      const points = weekly.body.trend.points as { count: number; cumulativeAverage: number }[];
      expect(points.length).toBeGreaterThanOrEqual(13);
      expect(points.length).toBeLessThanOrEqual(14);
      expect(points.at(-1)).toMatchObject({ count: 1, average: 2, cumulativeAverage: 2 });

      const daily = await manage(owner, '/summary?trend=DAY').expect(200);
      expect(daily.body.trend.points).toHaveLength(90);
      expect(daily.body.trend.points[0]).toMatchObject({
        count: 0,
        average: null,
        cumulativeAverage: null,
      });
    });

    it('Dono responde, edita e remove a resposta (auditado); o autor é avisado só na primeira', async () => {
      const first = await reply(owner, reviewId, ' Obrigado pelo retorno, já limpamos! ').expect(
        200,
      );
      expect(first.body.reply).toEqual({
        body: 'Obrigado pelo retorno, já limpamos!',
        repliedAt: expect.any(String),
        updatedAt: null,
      });
      const inbox = await t.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, author.id), eq(notifications.type, 'REVIEW_REPLIED')));
      // RF-REVIEW-09: sem o texto da resposta.
      expect(inbox).toEqual([
        expect.objectContaining({
          title: 'Resposta à sua avaliação',
          body: 'O Espaço arena-moderacao respondeu sua avaliação. Toque para ver a resposta.',
          data: { spaceId: space.id, slug: 'arena-moderacao', reviewId },
        }),
      ]);

      const edited = await reply(admin, reviewId, 'Resposta revisada.').expect(200);
      expect(edited.body.reply).toMatchObject({
        body: 'Resposta revisada.',
        repliedAt: first.body.reply.repliedAt,
        updatedAt: expect.any(String),
      });
      const after = await t.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, author.id), eq(notifications.type, 'REVIEW_REPLIED')));
      expect(after).toHaveLength(1);

      // Na lista pública a resposta aparece; "sem resposta" filtra.
      const pub = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
      expect(pub.body.items[0]).toMatchObject({
        updatedAt: expect.any(String),
        reply: {
          body: 'Resposta revisada.',
          repliedAt: first.body.reply.repliedAt,
          updatedAt: expect.any(String),
        },
      });
      expect((await manage(owner, '?unanswered=true').expect(200)).body.items).toEqual([]);

      await t
        .http()
        .delete(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reply`)
        .set(...bearer(owner))
        .expect(204);
      const gone = await t
        .http()
        .delete(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reply`)
        .set(...bearer(owner))
        .expect(404);
      expect(gone.body.error.code).toBe('REVIEW_REPLY_NOT_FOUND');
      expect(await auditOf(reviewId, 'review.reply')).toHaveLength(2);
      expect(await auditOf(reviewId, 'review.reply_delete')).toHaveLength(1);

      // A resposta não mexe na avaliação, nem no `updatedAt` (marca "editada" da AV.1).
      const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, reviewId));
      expect(row).toMatchObject({ rating: 2, comment: 'Banheiro sujo e quadra mal cuidada.' });
      expect(row?.updatedAt.toISOString()).toBe(pub.body.items[0].updatedAt);
      expect(new Date(pub.body.items[0].updatedAt).getTime()).toBeLessThan(
        new Date(first.body.reply.repliedAt).getTime(),
      );
    });

    it('remover a resposta e responder de novo não avisa o autor outra vez', async () => {
      const repliedTo = async () =>
        (
          await t.db
            .select()
            .from(notifications)
            .where(
              and(eq(notifications.userId, author.id), eq(notifications.type, 'REVIEW_REPLIED')),
            )
        ).length;
      expect(await repliedTo()).toBe(1);
      const again = await reply(owner, reviewId, 'Nova resposta depois de remover.').expect(200);
      expect(again.body.reply).toMatchObject({ updatedAt: null });
      await reply(admin, reviewId, 'E editada.').expect(200);
      expect(await repliedTo()).toBe(1);
      const [row] = await t.db.select().from(spaceReviews).where(eq(spaceReviews.id, reviewId));
      expect(row?.replyNotifiedAt).toBeInstanceOf(Date);
      await t
        .http()
        .delete(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reply`)
        .set(...bearer(owner))
        .expect(204);
    });

    it('Professor só lê: responder e denunciar → 403', async () => {
      const res = await reply(teacher, reviewId, 'Oi').expect(403);
      expect(res.body.error.code).toBe('SPACE_FORBIDDEN');
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reports`)
        .set(...bearer(teacher))
        .send({ reason: 'SPAM' })
        .expect(403);
    });

    it('avaliação de outro espaço pelo id: 404', async () => {
      const other = await createSpace(t.db, 'arena-mod-alheia');
      const otherOwner = await member(t, 'dono-alheio@exemplo.com', other.id, 'OWNER');
      const res = await t
        .http()
        .put(`/v1/manage/spaces/${other.id}/reviews/${reviewId}/reply`)
        .set(...bearer(otherOwner))
        .send({ body: 'Invasão' })
        .expect(404);
      expect(res.body.error.code).toBe('REVIEW_NOT_FOUND');
    });

    it('modo suporte vale como Dono (auditado como Super); espaço suspenso é só leitura', async () => {
      const session = await t
        .http()
        .post(`/v1/super/spaces/${space.id}/support-sessions`)
        .set(...bearer(platform))
        .send({ reason: 'Responder avaliação a pedido do dono' })
        .expect(201);
      await t
        .http()
        .put(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reply`)
        .set(...bearer(platform))
        .set(SUPPORT, session.body.id)
        .send({ body: 'Resposta pelo suporte.' })
        .expect(200);
      const [entry] = (await auditOf(reviewId, 'review.reply')).filter((e) => e.actingAsSuper);
      expect(entry?.diff).toMatchObject({ supportSessionId: session.body.id });
      // Sem o header, o Super não tem acesso ao painel do espaço.
      await reply(platform, reviewId, 'Sem suporte').expect(403);

      const suspended = await createSpace(t.db, 'arena-mod-suspensa');
      const suspendedOwner = await member(t, 'dono-susp@exemplo.com', suspended.id, 'OWNER');
      await setSpaceStatus(t.db, suspended.id, 'SUSPENDED');
      await t
        .http()
        .get(`/v1/manage/spaces/${suspended.id}/reviews`)
        .set(...bearer(suspendedOwner))
        .expect(200);
      const ro = await t
        .http()
        .put(`/v1/manage/spaces/${suspended.id}/reviews/${reviewId}/reply`)
        .set(...bearer(suspendedOwner))
        .send({ body: 'x' })
        .expect(403);
      expect(ro.body.error.code).toBe('SPACE_READ_ONLY');
    });
  });

  describe('denúncias', () => {
    it('jogador denuncia uma vez (409 na segunda); não denuncia a própria; exige login', async () => {
      const reporter = await player();
      const report = (user: SignedUp, body: object = { reason: 'OFFENSIVE', details: 'Xingou' }) =>
        t
          .http()
          .post(`/v1/reviews/${reviewId}/reports`)
          .set(...bearer(user))
          .send(body);
      await report(reporter).expect(204);
      const dup = await report(reporter, { reason: 'SPAM' }).expect(409);
      expect(dup.body.error.code).toBe('REVIEW_ALREADY_REPORTED');
      const own = await report(author).expect(403);
      expect(own.body.error.code).toBe('REVIEW_REPORT_OWN');
      await report(reporter, { reason: 'RUDE' }).expect(400);
      await t.http().post(`/v1/reviews/${reviewId}/reports`).send({ reason: 'SPAM' }).expect(401);
      const missing = await t
        .http()
        .post('/v1/reviews/00000000-0000-4000-8000-000000000000/reports')
        .set(...bearer(reporter))
        .send({ reason: 'SPAM' })
        .expect(404);
      expect(missing.body.error.code).toBe('REVIEW_NOT_FOUND');
    });

    it('Dono denuncia pelo painel: marcada com o espaço e auditada', async () => {
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reports`)
        .set(...bearer(owner))
        .send({ reason: 'FALSE_INFO', details: 'Nunca jogou aqui nesse dia' })
        .expect(204);
      const list = await manage(admin).expect(200);
      expect(list.body.items[0]).toMatchObject({ id: reviewId, reportedBySpace: true });
      expect(await auditOf(reviewId, 'review.report')).toHaveLength(1);
    });
  });

  describe('Super', () => {
    const superGet = (path: string, user = platform) =>
      t
        .http()
        .get(`/v1/super/reviews${path}`)
        .set(...bearer(user));
    const superPost = (path: string, body: object = {}, user = platform) =>
      t
        .http()
        .post(`/v1/super/reviews${path}`)
        .set(...bearer(user))
        .send(body);

    it('só o Super: Dono e jogador recebem 403 SUPER_REQUIRED', async () => {
      for (const user of [owner, author]) {
        const res = await superGet('/reports', user).expect(403);
        expect(res.body.error.code).toBe('SUPER_REQUIRED');
        await superPost(`/${reviewId}/hide`, { reason: 'x' }, user).expect(403);
      }
    });

    it('fila de denúncias abertas, da mais antiga para a mais nova, com a avaliação', async () => {
      const res = await superGet('/reports?status=OPEN').expect(200);
      expect(res.body.items.map((r: { reason: string }) => r.reason)).toEqual([
        'OFFENSIVE',
        'FALSE_INFO',
      ]);
      expect(res.body.items[1]).toMatchObject({
        status: 'OPEN',
        reporter: { userId: owner.id, spaceId: space.id },
        review: {
          id: reviewId,
          author: { userId: author.id, name: 'Rita de Cássia Prado', blocked: false },
          comment: 'Banheiro sujo e quadra mal cuidada.',
          openReports: 2,
          hidden: null,
        },
      });
      const page = await superGet('/reports?status=OPEN&limit=1').expect(200);
      const next = await superGet(`/reports?status=OPEN&limit=1&cursor=${page.body.nextCursor}`);
      expect(next.body.items[0].reason).toBe('FALSE_INFO');
    });

    it('ocultar: o comentário some, a nota fica na média e as denúncias abertas se resolvem', async () => {
      const before = await ratingOf(t.db, space.id);
      const hidden = await superPost(`/${reviewId}/hide`, { reason: 'Linguagem ofensiva' }).expect(
        200,
      );
      expect(hidden.body).toMatchObject({
        hidden: { reason: 'Linguagem ofensiva', byName: 'Super Teste' },
        openReports: 0,
      });
      expect(
        hidden.body.reports.map((r: { status: string; resolutionReason: string | null }) => [
          r.status,
          r.resolutionReason,
        ]),
      ).toEqual([
        ['RESOLVED', 'Linguagem ofensiva'],
        ['RESOLVED', 'Linguagem ofensiva'],
      ]);
      expect(await ratingOf(t.db, space.id)).toEqual(before);
      const again = await superPost(`/${reviewId}/hide`, { reason: 'De novo' }).expect(409);
      expect(again.body.error.code).toBe('REVIEW_COMMENT_HIDDEN');
      await superPost(`/${reviewId}/hide`, {}).expect(400);
      expect((await superGet('/reports?status=OPEN').expect(200)).body.items).toEqual([]);

      const unhidden = await superPost(`/${reviewId}/unhide`, { reason: 'Revisto' }).expect(200);
      expect(unhidden.body.hidden).toBeNull();
      const notHidden = await superPost(`/${reviewId}/unhide`, { reason: 'x' }).expect(409);
      expect(notHidden.body.error.code).toBe('REVIEW_COMMENT_NOT_HIDDEN');

      const history = (await superGet(`/${reviewId}`).expect(200)).body.history as {
        action: string;
      }[];
      expect(history.map((h) => h.action)).toEqual(
        expect.arrayContaining(['review.hide', 'review.unhide', 'review.report']),
      );
      const [hideAudit] = await auditOf(reviewId, 'review.hide');
      expect(hideAudit).toMatchObject({ actingAsSuper: true, spaceId: space.id });
    });

    it('sem comentário não há o que ocultar (409 REVIEW_NO_COMMENT)', async () => {
      const silent = await player();
      const res = await putReview(t, silent, space.id, { rating: 5 }).expect(200);
      const err = await superPost(`/${res.body.id}/hide`, { reason: 'x' }).expect(409);
      expect(err.body.error.code).toBe('REVIEW_NO_COMMENT');
    });

    it('descartar denúncia: só aberta, auditada; a avaliação não muda', async () => {
      const reporter = await player();
      await t
        .http()
        .post(`/v1/reviews/${reviewId}/reports`)
        .set(...bearer(reporter))
        .send({ reason: 'SPAM' })
        .expect(204);
      const [open] = (await superGet('/reports?status=OPEN').expect(200)).body.items;
      const dismissed = await superPost(`/reports/${open.id}/dismiss`).expect(200);
      expect(dismissed.body.reports.find((r: { id: string }) => r.id === open.id)).toMatchObject({
        status: 'DISMISSED',
        resolvedByName: 'Super Teste',
        resolutionReason: null,
      });
      const twice = await superPost(`/reports/${open.id}/dismiss`).expect(409);
      expect(twice.body.error.code).toBe('REVIEW_REPORT_RESOLVED');
      expect(await auditOf(reviewId, 'review.report_dismiss')).toHaveLength(1);
      const resolved = await superGet('/reports?status=DISMISSED').expect(200);
      expect(resolved.body.items.map((r: { id: string }) => r.id)).toContain(open.id);
    });

    it('autor bloqueado: o Super vê author.blocked e counted falso; o público não vê', async () => {
      const troll = await player('Troll Moderado');
      const res = await putReview(t, troll, space.id, { rating: 1, comment: 'Spam' }).expect(200);
      await t
        .http()
        .post(`/v1/super/users/${troll.id}/block`)
        .set(...bearer(platform))
        .send({})
        .expect(200);
      const detail = await superGet(`/${res.body.id}`).expect(200);
      expect(detail.body).toMatchObject({
        author: { userId: troll.id, name: 'Troll Moderado', blocked: true },
        counted: false,
        // Bloquear não é editar a avaliação.
        updatedAt: res.body.updatedAt,
      });
      const pub = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
      expect(pub.body.items.map((r: { id: string }) => r.id)).not.toContain(res.body.id);
      await t
        .http()
        .post(`/v1/super/users/${troll.id}/unblock`)
        .set(...bearer(platform))
        .expect(200);
      expect((await superGet(`/${res.body.id}`).expect(200)).body).toMatchObject({
        author: { blocked: false },
        counted: true,
      });
    });

    it('avaliações por espaço: todas, com filtros', async () => {
      const all = await superGet(`?spaceId=${space.id}`).expect(200);
      expect(all.body.items.length).toBeGreaterThanOrEqual(2);
      const fives = await superGet(`?spaceId=${space.id}&rating=5`).expect(200);
      expect(fives.body.items.every((r: { rating: number }) => r.rating === 5)).toBe(true);
      await superGet('').expect(400); // spaceId obrigatório
      await superGet('/00000000-0000-4000-8000-000000000000').expect(404);
    });
  });
});
