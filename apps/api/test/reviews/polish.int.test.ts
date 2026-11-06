import { addMinutes, REVIEW_MODERATION_REASON_MAX_LENGTH } from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, notifications, spaceReviewReports, spaces } from '../../src/db/schema/index.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { setSpaceStatus } from '../spaces/fixtures.js';
import { NIL_UUID, superUser } from '../super/fixtures.js';
import { DAY_MIN, insertBooking, putReview } from './helpers.js';
import { insertReviewRow } from './qa-fixtures.js';

// AV.6a · acabamento das avaliações: destaques por grupo e agregado da tendência no painel
// (RF-REVIEW-06), resumo e `rating` no Super (RF-REVIEW-07), motivo do descarte da denúncia
// (RN-REVIEW-04), bairro e cidade em Minhas avaliações (RF-REVIEW-08) e as decisões 107
// (Professor denuncia pela rota pública) e 108 (o espaço responde de novo à avaliação anônima).
// O BUG-AV5-2 (pedidos respondidos) está em requests.int.test.ts e requests-clock.int.test.ts.

let n = 0;

describe('avaliações: acabamento (AV.6a)', () => {
  let t: TestApp;
  let platform: SignedUp;

  const player = async (space: Space, name = 'Paula Mendes') => {
    const user = await signUp(t, `polish${n++}@exemplo.com`, name);
    await insertBooking(t.db, space, user, 180);
    return user;
  };
  const get = (path: string, user: SignedUp) =>
    t
      .http()
      .get(path)
      .set(...bearer(user));

  beforeAll(async () => {
    t = await createTestApp();
    platform = await superUser(t, 'super-polish@exemplo.com');
  });
  afterAll(() => t.close());

  describe('resumo do painel (RF-REVIEW-06)', () => {
    it('até 5 elogios e até 5 críticas mais citados, com a contagem; empate na ordem do catálogo', async () => {
      const space = await createSpace(t.db, 'arena-destaques');
      const owner = await member(t, 'dono-destaques@exemplo.com', space.id, 'OWNER');
      const positive = [
        ['GOOD_COURT', 'CLEAN', 'GOOD_VALUE'],
        ['GOOD_COURT', 'CLEAN', 'GOOD_VALUE', 'GOOD_FACILITIES'],
        ['GOOD_COURT', 'GOOD_LIGHTING', 'EASY_BOOKING'],
        ['GOOD_SERVICE'],
      ] as const;
      for (const tags of positive)
        await insertReviewRow(t.db, space.id, { rating: 5, tags: [...tags] });
      const negative = [
        ['DIRTY', 'DELAYS', 'BAD_LIGHTING'],
        ['DIRTY', 'HARD_BOOKING'],
        ['EXPENSIVE', 'BAD_COURT'],
      ] as const;
      for (const tags of negative)
        await insertReviewRow(t.db, space.id, { rating: 2, tags: [...tags] });
      // Autor bloqueado: fora da média e dos destaques.
      for (let i = 0; i < 4; i++) {
        await insertReviewRow(t.db, space.id, { rating: 1, tags: ['BAD_SERVICE'], counted: false });
      }

      const res = await get(`/v1/manage/spaces/${space.id}/reviews/summary`, owner).expect(200);
      expect(res.body).not.toHaveProperty('topTags');
      expect(res.body.highlights).toEqual({
        positive: [
          { tag: 'GOOD_COURT', count: 3 },
          { tag: 'CLEAN', count: 2 },
          { tag: 'GOOD_VALUE', count: 2 },
          // Empates com 1, na ordem do catálogo: GOOD_SERVICE, EASY_BOOKING, GOOD_LIGHTING,
          // GOOD_FACILITIES (os dois últimos ficam de fora).
          { tag: 'GOOD_SERVICE', count: 1 },
          { tag: 'EASY_BOOKING', count: 1 },
        ],
        negative: [
          { tag: 'DIRTY', count: 2 },
          { tag: 'BAD_COURT', count: 1 },
          { tag: 'EXPENSIVE', count: 1 },
          { tag: 'HARD_BOOKING', count: 1 },
          { tag: 'BAD_LIGHTING', count: 1 },
        ],
      });

      // A página pública segue com os 3 mais citados no total (RF-REVIEW-03).
      const pub = await t.http().get(`/v1/spaces/${space.id}/reviews/summary`).expect(200);
      expect(pub.body.topTags).toEqual([
        { tag: 'GOOD_COURT', count: 3 },
        { tag: 'CLEAN', count: 2 },
        { tag: 'DIRTY', count: 2 },
      ]);
    });

    it('grupo sem nenhum chip citado vem vazio', async () => {
      const space = await createSpace(t.db, 'arena-destaques-vazios');
      const owner = await member(t, 'dono-destaques-vazios@exemplo.com', space.id, 'OWNER');
      await insertReviewRow(t.db, space.id, { rating: 5, tags: ['ON_TIME'] });
      await insertReviewRow(t.db, space.id, { rating: 3, tags: [] });
      const res = await get(`/v1/manage/spaces/${space.id}/reviews/summary`, owner).expect(200);
      expect(res.body.highlights).toEqual({
        positive: [{ tag: 'ON_TIME', count: 1 }],
        negative: [],
      });
    });

    it('trend.count e trend.average: só os 90 dias, das que contam, da soma e da contagem (não das médias dos pontos)', async () => {
      const space = await createSpace(t.db, 'arena-tendencia-total');
      const owner = await member(t, 'dono-tendencia@exemplo.com', space.id, 'OWNER');
      const now = new Date();
      const at = (daysAgo: number) => addMinutes(now, -daysAgo * DAY_MIN);
      // Antes da janela: entra só na média acumulada.
      await insertReviewRow(t.db, space.id, { rating: 1, createdAt: at(120) });
      // Uma semana com quatro 5 e outra com um 1: média do período 21/5 = 4,2. A média das
      // médias semanais daria (5 + 1) / 2 = 3.
      for (let i = 0; i < 4; i++) {
        await insertReviewRow(t.db, space.id, { rating: 5, createdAt: at(60) });
      }
      await insertReviewRow(t.db, space.id, { rating: 1, createdAt: at(10) });
      // Autor bloqueado dentro da janela: não conta.
      await insertReviewRow(t.db, space.id, { rating: 1, createdAt: at(5), counted: false });

      for (const granularity of ['WEEK', 'DAY']) {
        const res = await get(
          `/v1/manage/spaces/${space.id}/reviews/summary?trend=${granularity}`,
          owner,
        ).expect(200);
        expect(res.body).toMatchObject({ count: 6, average: 3.7 });
        expect(res.body.trend).toMatchObject({ granularity, count: 5, average: 4.2 });
        const points = res.body.trend.points as { count: number }[];
        expect(points.reduce((sum, p) => sum + p.count, 0)).toBe(5);
      }
    });

    it('publicSummaryVisible: com 5 ou mais, só na vitrine (suspenso ou encerrado: falso), como no Super', async () => {
      const space = await createSpace(t.db, 'arena-resumo-visivel');
      const owner = await member(t, 'dono-resumo-visivel@exemplo.com', space.id, 'OWNER');
      const visible = async () => {
        const [manage, platformView] = await Promise.all([
          get(`/v1/manage/spaces/${space.id}/reviews/summary`, owner).expect(200),
          get(`/v1/super/reviews/summary?spaceId=${space.id}`, platform).expect(200),
        ]);
        expect(manage.body.publicSummaryVisible).toBe(platformView.body.publicSummaryVisible);
        return manage.body.publicSummaryVisible as boolean;
      };
      for (const rating of [5, 4, 4, 3]) await insertReviewRow(t.db, space.id, { rating });
      expect(await visible()).toBe(false);
      await insertReviewRow(t.db, space.id, { rating: 5 });
      expect(await visible()).toBe(true);

      // Suspenso: o painel continua lendo (só leitura), mas o público não vê a média.
      await setSpaceStatus(t.db, space.id, 'SUSPENDED');
      await t.http().get(`/v1/spaces/${space.id}/reviews/summary`).expect(404);
      const suspended = await get(`/v1/manage/spaces/${space.id}/reviews/summary`, owner).expect(
        200,
      );
      expect(suspended.body).toMatchObject({ count: 5, average: 4.2, publicSummaryVisible: false });
      expect(await visible()).toBe(false);

      await setSpaceStatus(t.db, space.id, 'CLOSED');
      expect(await visible()).toBe(false);
      await setSpaceStatus(t.db, space.id, 'ACTIVE');
      expect(await visible()).toBe(true);
    });

    it('sem avaliação nos 90 dias: trend.count 0 e trend.average nula', async () => {
      const space = await createSpace(t.db, 'arena-tendencia-vazia');
      const owner = await member(t, 'dono-tendencia-vazia@exemplo.com', space.id, 'OWNER');
      await insertReviewRow(t.db, space.id, {
        rating: 4,
        createdAt: addMinutes(new Date(), -200 * DAY_MIN),
      });
      const res = await get(`/v1/manage/spaces/${space.id}/reviews/summary`, owner).expect(200);
      expect(res.body.trend).toMatchObject({ count: 0, average: null });
      expect(res.body.trend.points.at(-1)).toMatchObject({ count: 0, cumulativeAverage: 4 });
    });
  });

  describe('Super: resumo por espaço e rating no detalhe (RF-REVIEW-07)', () => {
    it('funciona fora da vitrine e conta as avaliações fora da média', async () => {
      const space = await createSpace(t.db, 'arena-super-resumo');
      for (const rating of [5, 4, 2]) {
        await insertReviewRow(t.db, space.id, {
          rating,
          tags: rating >= 4 ? ['GOOD_COURT'] : ['DIRTY'],
        });
      }
      for (let i = 0; i < 2; i++) {
        await insertReviewRow(t.db, space.id, { rating: 1, tags: ['BAD_SERVICE'], counted: false });
      }
      await setSpaceStatus(t.db, space.id, 'SUSPENDED');
      // O público não vê o espaço suspenso.
      await t.http().get(`/v1/spaces/${space.id}/reviews/summary`).expect(404);

      const summary = await get(`/v1/super/reviews/summary?spaceId=${space.id}`, platform).expect(
        200,
      );
      expect(summary.body).toEqual({
        count: 3,
        // Mesmo abaixo de 5: (5 + 4 + 2) / 3 = 3,67 → 3,7.
        average: 3.7,
        publicSummaryVisible: false,
        uncountedCount: 2,
        distribution: [
          { rating: 5, count: 1 },
          { rating: 4, count: 1 },
          { rating: 3, count: 0 },
          { rating: 2, count: 1 },
          { rating: 1, count: 0 },
        ],
        highlights: {
          positive: [{ tag: 'GOOD_COURT', count: 2 }],
          negative: [{ tag: 'DIRTY', count: 1 }],
        },
      });

      const detail = await get(`/v1/super/spaces/${space.id}`, platform).expect(200);
      // Como no card da vitrine: média só a partir de 5.
      expect(detail.body.rating).toEqual({ count: 3, average: null });
    });

    it('com 5 ou mais e na vitrine, o público já vê a média; o rating do detalhe a mostra', async () => {
      const space = await createSpace(t.db, 'arena-super-resumo-publico');
      for (const rating of [5, 5, 4, 4, 3]) await insertReviewRow(t.db, space.id, { rating });
      await insertReviewRow(t.db, space.id, { rating: 1, counted: false });
      const summary = await get(`/v1/super/reviews/summary?spaceId=${space.id}`, platform).expect(
        200,
      );
      expect(summary.body).toMatchObject({
        count: 5,
        average: 4.2,
        publicSummaryVisible: true,
        uncountedCount: 1,
        highlights: { positive: [], negative: [] },
      });
      const detail = await get(`/v1/super/spaces/${space.id}`, platform).expect(200);
      expect(detail.body.rating).toEqual({ count: 5, average: 4.2 });

      // Encerrado: continua no Super, mas o público deixa de ver.
      await setSpaceStatus(t.db, space.id, 'CLOSED');
      const closed = await get(`/v1/super/reviews/summary?spaceId=${space.id}`, platform).expect(
        200,
      );
      expect(closed.body).toMatchObject({ count: 5, publicSummaryVisible: false });
    });

    it('espaço sem avaliações: zeros; espaço inexistente: 404; sem spaceId: 400', async () => {
      const space = await createSpace(t.db, 'arena-super-resumo-vazio');
      const empty = await get(`/v1/super/reviews/summary?spaceId=${space.id}`, platform).expect(
        200,
      );
      expect(empty.body).toMatchObject({
        count: 0,
        average: null,
        publicSummaryVisible: false,
        uncountedCount: 0,
        highlights: { positive: [], negative: [] },
      });
      expect((await get(`/v1/super/spaces/${space.id}`, platform).expect(200)).body.rating).toEqual(
        { count: 0, average: null },
      );
      const missing = await get(`/v1/super/reviews/summary?spaceId=${NIL_UUID}`, platform).expect(
        404,
      );
      expect(missing.body.error.code).toBe('SPACE_NOT_FOUND');
      await get('/v1/super/reviews/summary', platform).expect(400);
      await get('/v1/super/reviews/summary?spaceId=nao-e-uuid', platform).expect(400);
    });
  });

  describe('descartar denúncia com motivo (RN-REVIEW-04)', () => {
    let space: Space;
    let reviewId: string;

    const openReport = async () => {
      const reporter = await player(space, 'Denunciante Teste');
      await t
        .http()
        .post(`/v1/reviews/${reviewId}/reports`)
        .set(...bearer(reporter))
        .send({ reason: 'SPAM' })
        .expect(204);
      const [report] = await t.db
        .select()
        .from(spaceReviewReports)
        .where(
          and(
            eq(spaceReviewReports.reviewId, reviewId),
            eq(spaceReviewReports.reporterUserId, reporter.id),
          ),
        );
      if (!report) throw new Error('Denúncia não gravada.');
      return report.id;
    };
    const dismiss = (reportId: string, body?: object) => {
      const req = t
        .http()
        .post(`/v1/super/reviews/reports/${reportId}/dismiss`)
        .set(...bearer(platform));
      return body === undefined ? req : req.send(body);
    };
    const dismissAudit = (reportId: string) =>
      t.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'review.report_dismiss'),
            sql`${auditLogs.diff} ->> 'reportId' = ${reportId}`,
          ),
        );

    beforeAll(async () => {
      space = await createSpace(t.db, 'arena-descarte');
      const author = await player(space, 'Autora Descarte');
      reviewId = (
        await putReview(t, author, space.id, { rating: 4, comment: 'Gostei bastante.' }).expect(200)
      ).body.id;
    });

    it('o motivo é aparado, gravado na denúncia e na auditoria', async () => {
      const reportId = await openReport();
      const res = await dismiss(reportId, { reason: '  Não viola as regras.  ' }).expect(200);
      expect(res.body.reports.find((r: { id: string }) => r.id === reportId)).toMatchObject({
        status: 'DISMISSED',
        resolvedByName: 'Super Teste',
        resolutionReason: 'Não viola as regras.',
      });
      const [stored] = await t.db
        .select()
        .from(spaceReviewReports)
        .where(eq(spaceReviewReports.id, reportId));
      expect(stored?.resolutionReason).toBe('Não viola as regras.');
      const [entry] = await dismissAudit(reportId);
      expect(entry).toMatchObject({
        actingAsSuper: true,
        entityId: reviewId,
        spaceId: space.id,
        diff: { reportId, reason: 'Não viola as regras.' },
      });
      // A fila dos descartados também traz o motivo.
      const queue = await get('/v1/super/reviews/reports?status=DISMISSED', platform).expect(200);
      expect(queue.body.items.find((r: { id: string }) => r.id === reportId)).toMatchObject({
        resolutionReason: 'Não viola as regras.',
      });
    });

    it('sem corpo, com corpo vazio ou com motivo em branco: motivo nulo', async () => {
      for (const body of [undefined, {}, { reason: '   ' }, { reason: null }]) {
        const reportId = await openReport();
        const res = await dismiss(reportId, body).expect(200);
        expect(res.body.reports.find((r: { id: string }) => r.id === reportId)).toMatchObject({
          status: 'DISMISSED',
          resolutionReason: null,
        });
        const [entry] = await dismissAudit(reportId);
        expect(entry?.diff).toEqual({ reportId, reason: null });
      }
    });

    it('motivo acima de 500 ou campo desconhecido: 400, e a denúncia continua aberta', async () => {
      const reportId = await openReport();
      const long = await dismiss(reportId, {
        reason: 'x'.repeat(REVIEW_MODERATION_REASON_MAX_LENGTH + 1),
      }).expect(400);
      expect(long.body.error.code).toBe('VALIDATION_ERROR');
      await dismiss(reportId, { motivo: 'Campo errado' }).expect(400);
      await dismiss(reportId, { reason: 42 }).expect(400);
      const [stored] = await t.db
        .select()
        .from(spaceReviewReports)
        .where(eq(spaceReviewReports.id, reportId));
      expect(stored).toMatchObject({ status: 'OPEN', resolutionReason: null });
      expect(await dismissAudit(reportId)).toEqual([]);
      // No limite, passa.
      const res = await dismiss(reportId, {
        reason: 'y'.repeat(REVIEW_MODERATION_REASON_MAX_LENGTH),
      }).expect(200);
      expect(
        res.body.reports.find((r: { id: string }) => r.id === reportId).resolutionReason,
      ).toHaveLength(REVIEW_MODERATION_REASON_MAX_LENGTH);
    });
  });

  describe('Minhas avaliações com bairro e cidade (RF-REVIEW-08)', () => {
    it('cada item traz o bairro (ou nulo) e a cidade do espaço, como no card da vitrine', async () => {
      const withHood = await createSpace(t.db, 'arena-minhas-bairro');
      await t.db
        .update(spaces)
        .set({ addressNeighborhood: 'Savassi' })
        .where(eq(spaces.id, withHood.id));
      const noHood = await createSpace(t.db, 'arena-minhas-sem-bairro');
      const user = await player(withHood, 'Marina Couto');
      await insertBooking(t.db, noHood, user, 180);
      await putReview(t, user, withHood.id, { rating: 5 }).expect(200);
      await putReview(t, user, noHood.id, { rating: 4 }).expect(200);
      // Fora da vitrine continua com bairro e cidade.
      await setSpaceStatus(t.db, noHood.id, 'SUSPENDED');

      const mine = await get('/v1/me/reviews', user).expect(200);
      const bySlug = new Map(
        (mine.body.items as { space: { slug: string } }[]).map((item) => [item.space.slug, item]),
      );
      expect(bySlug.get('arena-minhas-bairro')?.space).toEqual({
        id: withHood.id,
        slug: 'arena-minhas-bairro',
        name: 'Espaço arena-minhas-bairro',
        logoUrl: null,
        neighborhood: 'Savassi',
        city: 'Belo Horizonte',
        inShowcase: true,
      });
      expect(bySlug.get('arena-minhas-sem-bairro')?.space).toMatchObject({
        neighborhood: null,
        city: 'Belo Horizonte',
        inShowcase: false,
      });

      // Os mesmos valores do card da vitrine.
      const search = await t.http().get('/v1/spaces?q=arena-minhas-bairro').expect(200);
      expect(search.body.items[0]).toMatchObject({
        slug: 'arena-minhas-bairro',
        neighborhood: 'Savassi',
        city: 'Belo Horizonte',
      });
    });
  });

  describe('decisões 107 e 108', () => {
    let space: Space;
    let owner: SignedUp;
    let teacher: SignedUp;

    beforeAll(async () => {
      space = await createSpace(t.db, 'arena-decisoes');
      owner = await member(t, 'dono-decisoes@exemplo.com', space.id, 'OWNER');
      teacher = await member(t, 'prof-decisoes@exemplo.com', space.id, 'TEACHER');
    });

    it('107 · o Professor denuncia pela rota pública, sem marca de espaço; pelo painel, 403', async () => {
      const author = await player(space, 'Autor Denunciado');
      const reviewId = (
        await putReview(t, author, space.id, { rating: 1, comment: 'Péssimo professor.' }).expect(
          200,
        )
      ).body.id;
      await t
        .http()
        .post(`/v1/reviews/${reviewId}/reports`)
        .set(...bearer(teacher))
        .send({ reason: 'FALSE_INFO', details: 'Não dei aula para essa pessoa.' })
        .expect(204);
      const [report] = await t.db
        .select()
        .from(spaceReviewReports)
        .where(eq(spaceReviewReports.reviewId, reviewId));
      expect(report).toMatchObject({ reporterUserId: teacher.id, reporterSpaceId: null });
      // A gestão não a vê como denúncia do espaço; o Super vê quem denunciou, sem espaço.
      const list = await get(`/v1/manage/spaces/${space.id}/reviews`, owner).expect(200);
      expect(list.body.items.find((r: { id: string }) => r.id === reviewId)).toMatchObject({
        reportedBySpace: false,
      });
      const queue = await get('/v1/super/reviews/reports?status=OPEN', platform).expect(200);
      expect(queue.body.items.find((r: { id: string }) => r.id === report?.id)).toMatchObject({
        reporter: { userId: teacher.id, spaceId: null },
      });
      // Uma por pessoa, como qualquer denúncia.
      const dup = await t
        .http()
        .post(`/v1/reviews/${reviewId}/reports`)
        .set(...bearer(teacher))
        .send({ reason: 'SPAM' })
        .expect(409);
      expect(dup.body.error.code).toBe('REVIEW_ALREADY_REPORTED');
      // Pelo painel, em nome do espaço, só Dono e Admin.
      const forbidden = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reports`)
        .set(...bearer(teacher))
        .send({ reason: 'SPAM' })
        .expect(403);
      expect(forbidden.body.error.code).toBe('SPACE_FORBIDDEN');
    });

    it('108 · o espaço responde de novo à avaliação anonimizada, sem notificar ninguém', async () => {
      const author = await player(space, 'Rodrigo Saída');
      const reviewId = (
        await putReview(t, author, space.id, { rating: 3, comment: 'Razoável.' }).expect(200)
      ).body.id;
      const replyTo = (body: string) =>
        t
          .http()
          .put(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reply`)
          .set(...bearer(owner))
          .send({ body });
      await replyTo('Obrigado!').expect(200);
      const repliedNotices = () =>
        t.db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.type, 'REVIEW_REPLIED'),
              sql`${notifications.data} ->> 'reviewId' = ${reviewId}`,
            ),
          );
      // A primeira resposta avisou o autor; a anonimização apaga as notificações dele.
      expect(await repliedNotices()).toHaveLength(1);
      expect(await anonymizeUser(t.db, author.id)).toBe(true);
      expect(await repliedNotices()).toHaveLength(0);
      const anon = await get(`/v1/manage/spaces/${space.id}/reviews`, owner).expect(200);
      expect(anon.body.items.find((r: { id: string }) => r.id === reviewId)).toMatchObject({
        author: { name: 'Usuário removido' },
        comment: null,
        reply: null,
      });

      const again = await replyTo('Seguimos à disposição.').expect(200);
      expect(again.body).toMatchObject({
        id: reviewId,
        rating: 3,
        author: { name: 'Usuário removido' },
        reply: { body: 'Seguimos à disposição.' },
      });
      const pub = await t.http().get(`/v1/spaces/${space.id}/reviews`).expect(200);
      expect(pub.body.items.find((r: { id: string }) => r.id === reviewId)).toMatchObject({
        rating: 3,
        reply: { body: 'Seguimos à disposição.' },
      });
      expect(await repliedNotices()).toHaveLength(0);
      // Editar a resposta também funciona.
      await replyTo('Seguimos à disposição, sempre.').expect(200);
      expect(await repliedNotices()).toHaveLength(0);
    });

    it('108 · avaliação anonimizada que nunca teve resposta: responder não gera notificação', async () => {
      const author = await player(space, 'Carla Saída');
      const reviewId = (await putReview(t, author, space.id, { rating: 5 }).expect(200)).body.id;
      expect(await anonymizeUser(t.db, author.id)).toBe(true);
      const total = async () =>
        (await t.db.select({ c: sql<number>`count(*)::int` }).from(notifications))[0]?.c ?? 0;
      const before = await total();
      await t
        .http()
        .put(`/v1/manage/spaces/${space.id}/reviews/${reviewId}/reply`)
        .set(...bearer(owner))
        .send({ body: 'Obrigado pela nota!' })
        .expect(200);
      expect(await total()).toBe(before);
    });
  });
});
