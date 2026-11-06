import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  type ManageReview,
  type ManageReviewPage,
  type ManageReviewSummary,
  type ManageReviewsQuery,
  REVIEW_TREND_DAYS,
  type ReplyReviewInput,
  type ReportReviewInput,
  type ReviewTrendGranularity,
  type ReviewTrendPoint,
  reviewAverage,
  utcToZoned,
  weekdayOf,
  zonedToUtc,
} from '@space-sports/shared';
import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { audit, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { cities, spaceReviewReports, spaceReviews, spaces, users } from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { visibleInShowcase } from '../spaces/space-queries.js';
import {
  afterCursor,
  countedIn,
  cursorText,
  isPublicSummaryVisible,
  pageOf,
  publicReviewColumns,
  ratingDistribution,
  tagHighlights,
  toPublicReview,
} from './review-views.js';
import { reviewNotFound, reviewReplyNotFound, reviewReportOwn } from './reviews.errors.js';
import { insertReport } from './reviews.service.js';

/** Auditoria das avaliações: a entidade é sempre a avaliação, para o histórico de moderação. */
export const REVIEW_AUDIT_ENTITY = 'space_review';

/** Alguém da gestão do espaço já denunciou a avaliação. */
const reportedBy = (spaceId: string) => sql<boolean>`EXISTS (
  SELECT 1 FROM ${spaceReviewReports}
  WHERE ${spaceReviewReports.reviewId} = ${spaceReviews.id}
    AND ${spaceReviewReports.reporterSpaceId} = ${spaceId}
)`;

/**
 * Avaliações no painel do espaço (RF-REVIEW-06): Dono, Admin e Professor veem; Dono e Admin (e o
 * Super em modo suporte, como Dono) respondem em público e denunciam (RN-REVIEW-05). Nenhuma rota
 * deixa o espaço apagar ou alterar a avaliação. Só as avaliações que aparecem em público.
 */
@Injectable()
export class ManageReviewsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
  ) {}

  async list(spaceId: string, query: ManageReviewsQuery): Promise<ManageReviewPage> {
    const rows = await this.db
      .select({
        ...publicReviewColumns,
        cursorAt: cursorText(spaceReviews.createdAt),
        reportedBySpace: reportedBy(spaceId),
      })
      .from(spaceReviews)
      .leftJoin(users, eq(users.id, spaceReviews.userId))
      .where(
        and(
          countedIn(spaceId),
          query.rating ? eq(spaceReviews.rating, query.rating) : undefined,
          query.unanswered ? isNull(spaceReviews.reply) : undefined,
          afterCursor(spaceReviews.createdAt, spaceReviews.id, query.cursor),
        ),
      )
      .orderBy(desc(spaceReviews.createdAt), desc(spaceReviews.id))
      .limit(query.limit + 1);
    return pageOf(
      rows,
      query.limit,
      (row) => row.review.id,
      (row): ManageReview => ({ ...toPublicReview(row), reportedBySpace: row.reportedBySpace }),
    );
  }

  /**
   * Média (mesmo abaixo de 5), sem resposta, distribuição, até 5 elogios e 5 críticas mais
   * citados e a tendência de 90 dias (com o total e a média do período).
   */
  async summary(
    spaceId: string,
    granularity: ReviewTrendGranularity,
  ): Promise<ManageReviewSummary> {
    const [space] = await this.db
      .select({
        count: spaces.ratingCount,
        sum: spaces.ratingSum,
        timeZone: cities.timezone,
        inShowcase: sql<boolean>`${visibleInShowcase}`,
      })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(eq(spaces.id, spaceId));
    if (!space) throw reviewNotFound();
    const [distribution, highlights, unanswered, trend] = await Promise.all([
      ratingDistribution(this.db, spaceId),
      tagHighlights(this.db, spaceId),
      this.db
        .select({ total: count() })
        .from(spaceReviews)
        .where(and(countedIn(spaceId), isNull(spaceReviews.reply))),
      this.trend(spaceId, space.timeZone, granularity),
    ]);
    return {
      count: space.count,
      average: reviewAverage(space.sum, space.count, 1),
      publicSummaryVisible: isPublicSummaryVisible(space),
      unansweredCount: unanswered[0]?.total ?? 0,
      distribution,
      highlights,
      trend: { granularity, ...trend },
    };
  }

  /**
   * Últimos 90 dias (no fuso do espaço), do mais antigo para o mais recente: avaliações criadas
   * por dia ou por semana (domingo a sábado; a primeira começa no início da janela), a média delas
   * e a média acumulada de todas as criadas até o fim do período. O total e a média dos 90 dias
   * saem da mesma consulta (linha de total do `GROUPING SETS`), da soma e da contagem, não das
   * médias arredondadas dos pontos.
   */
  private async trend(
    spaceId: string,
    timeZone: string,
    granularity: ReviewTrendGranularity,
    now: Date = new Date(),
  ): Promise<{ count: number; average: number | null; points: ReviewTrendPoint[] }> {
    const today = utcToZoned(now, timeZone).date;
    const firstDay = addDays(today, -(REVIEW_TREND_DAYS - 1));
    const from = zonedToUtc(firstDay, 0, timeZone);
    const [before, days] = await Promise.all([
      this.db
        .select({ count: count(), sum: sql<number>`coalesce(sum(${spaceReviews.rating}), 0)::int` })
        .from(spaceReviews)
        .where(and(countedIn(spaceId), lt(spaceReviews.createdAt, from))),
      // Uma linha por dia e a do total do período (`is_total`).
      this.db.execute<{ day: string | null; is_total: boolean; count: number; sum: number }>(sql`
        SELECT day, GROUPING(day) = 1 AS is_total,
          count(*)::int AS count, coalesce(sum(rating), 0)::int AS sum
        FROM (
          SELECT to_char(${spaceReviews.createdAt} AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
            ${spaceReviews.rating} AS rating
          FROM ${spaceReviews}
          WHERE ${spaceReviews.spaceId} = ${spaceId} AND ${spaceReviews.counted}
            AND ${spaceReviews.createdAt} >= ${from}
        ) period
        GROUP BY GROUPING SETS ((day), ())
      `),
    ]);
    const total = days.rows.find((row) => row.is_total) ?? { count: 0, sum: 0 };
    const byDay = new Map(days.rows.filter((row) => !row.is_total).map((row) => [row.day, row]));
    let cumulativeCount = before[0]?.count ?? 0;
    let cumulativeSum = before[0]?.sum ?? 0;
    const points: ReviewTrendPoint[] = [];
    let current: { date: string; count: number; sum: number } | undefined;
    const close = () => {
      if (!current) return;
      cumulativeCount += current.count;
      cumulativeSum += current.sum;
      points.push({
        date: current.date,
        count: current.count,
        average: reviewAverage(current.sum, current.count, 1),
        cumulativeAverage: reviewAverage(cumulativeSum, cumulativeCount, 1),
      });
    };
    for (let i = 0; i < REVIEW_TREND_DAYS; i++) {
      const day = addDays(firstDay, i);
      // Semana de domingo a sábado (AV.1).
      if (!current || granularity === 'DAY' || weekdayOf(day) === 0) {
        close();
        current = { date: day, count: 0, sum: 0 };
      }
      const row = byDay.get(day);
      current.count += row?.count ?? 0;
      current.sum += row?.sum ?? 0;
    }
    close();
    return {
      count: total.count,
      average: reviewAverage(total.sum, total.count, 1),
      points,
    };
  }

  /**
   * Cria ou edita a resposta pública (uma por avaliação, decisão 104), auditada. O autor é
   * avisado só da primeira resposta da avaliação (`reply_notified_at`): editar, ou remover e
   * responder de novo, não avisa outra vez.
   */
  async reply(
    actorId: string,
    spaceId: string,
    reviewId: string,
    { body }: ReplyReviewInput,
  ): Promise<ManageReview> {
    const notify = await this.db.transaction(async (tx) => {
      const review = await this.lockReview(tx, spaceId, reviewId);
      const now = new Date();
      const firstReply = review.reply === null;
      await tx
        .update(spaceReviews)
        .set({
          reply: body,
          replyBy: actorId,
          repliedAt: review.repliedAt ?? now,
          replyUpdatedAt: firstReply ? null : now,
          // RF-REVIEW-09: o autor é avisado só da primeira resposta desta avaliação.
          replyNotifiedAt: review.replyNotifiedAt ?? now,
          // A resposta não é edição da avaliação: o `updated_at` dela fica.
          updatedAt: sql`${spaceReviews.updatedAt}`,
        })
        .where(eq(spaceReviews.id, reviewId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'review.reply',
        entity: REVIEW_AUDIT_ENTITY,
        entityId: reviewId,
        diff: { edited: !firstReply },
      });
      return review.replyNotifiedAt === null;
    });
    if (notify) await this.events.publish({ type: 'review.replied', reviewId });
    return this.get(spaceId, reviewId);
  }

  async deleteReply(actorId: string, spaceId: string, reviewId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const review = await this.lockReview(tx, spaceId, reviewId);
      if (review.reply === null) throw reviewReplyNotFound();
      await tx
        .update(spaceReviews)
        .set({
          reply: null,
          replyBy: null,
          repliedAt: null,
          replyUpdatedAt: null,
          updatedAt: sql`${spaceReviews.updatedAt}`,
        })
        .where(eq(spaceReviews.id, reviewId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'review.reply_delete',
        entity: REVIEW_AUDIT_ENTITY,
        entityId: reviewId,
      });
    });
  }

  /** Denúncia pela gestão (decisão 103): fica marcada com o espaço; uma por pessoa. */
  async report(
    actorId: string,
    spaceId: string,
    reviewId: string,
    input: ReportReviewInput,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const review = await this.lockReview(tx, spaceId, reviewId);
      if (review.userId === actorId) throw reviewReportOwn();
      const reportId = await insertReport(tx, {
        reviewId,
        reporterUserId: actorId,
        reporterSpaceId: spaceId,
        reason: input.reason,
        details: input.details ?? null,
      });
      await audit(tx, {
        actorId,
        spaceId,
        action: 'review.report',
        entity: REVIEW_AUDIT_ENTITY,
        entityId: reviewId,
        diff: { reportId, reason: input.reason },
      });
    });
  }

  private async lockReview(tx: Tx, spaceId: string, reviewId: string) {
    const [review] = await tx
      .select()
      .from(spaceReviews)
      .where(and(eq(spaceReviews.id, reviewId), countedIn(spaceId)))
      .for('update');
    if (!review) throw reviewNotFound();
    return review;
  }

  private async get(spaceId: string, reviewId: string): Promise<ManageReview> {
    const [row] = await this.db
      .select({
        ...publicReviewColumns,
        reportedBySpace: reportedBy(spaceId),
      })
      .from(spaceReviews)
      .leftJoin(users, eq(users.id, spaceReviews.userId))
      .where(and(eq(spaceReviews.id, reviewId), countedIn(spaceId)));
    if (!row) throw reviewNotFound();
    return { ...toPublicReview(row), reportedBySpace: row.reportedBySpace };
  }
}
