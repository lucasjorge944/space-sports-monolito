import { Inject, Injectable } from '@nestjs/common';
import {
  type DismissReviewReport,
  type ModerateReviewInput,
  REVIEW_REMOVED_AUTHOR_NAME,
  type ReviewModerationEntry,
  reviewAverage,
  type SuperReview,
  type SuperReviewDetail,
  type SuperReviewPage,
  type SuperReviewReport,
  type SuperReviewReportPage,
  type SuperReviewReportsQuery,
  type SuperReviewSummary,
  type SuperReviewsQuery,
} from '@space-sports/shared';
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { auditLogs, spaceReviewReports, spaceReviews, spaces, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { visibleInShowcase } from '../spaces/space-queries.js';
import { superAudit } from '../super/super-audit.js';
import { REVIEW_AUDIT_ENTITY } from './manage-reviews.service.js';
import {
  afterCursor,
  cursorText,
  isPublicSummaryVisible,
  pageOf,
  ratingDistribution,
  tagHighlights,
  toReply,
} from './review-views.js';
import {
  reviewCommentHidden,
  reviewCommentNotHidden,
  reviewNoComment,
  reviewNotFound,
  reviewReportNotFound,
  reviewReportResolved,
  spaceNotFound,
} from './reviews.errors.js';

const author = alias(users, 'review_author');
const hider = alias(users, 'review_hider');
const reporter = alias(users, 'review_reporter');
const resolver = alias(users, 'review_resolver');

const openReports = sql<number>`(
  SELECT count(*)::int FROM ${spaceReviewReports}
  WHERE ${spaceReviewReports.reviewId} = ${spaceReviews.id} AND ${spaceReviewReports.status} = 'OPEN'
)`;

/** Colunas da avaliação no Super: autor real, quem ocultou e as denúncias abertas. */
const reviewColumns = {
  review: spaceReviews,
  space: { id: spaces.id, slug: spaces.slug, name: spaces.name },
  authorName: author.name,
  authorStatus: author.status,
  hiderName: hider.name,
  openReports,
};

type ReviewSelection = {
  review: typeof spaceReviews.$inferSelect;
  space: SuperReview['space'];
  authorName: string | null;
  authorStatus: string | null;
  hiderName: string | null;
  openReports: number;
};

function toSuperReview(row: ReviewSelection): SuperReview {
  const { review } = row;
  return {
    id: review.id,
    space: row.space,
    author: {
      userId: review.userId,
      name: review.userId ? (row.authorName ?? '') : REVIEW_REMOVED_AUTHOR_NAME,
      blocked: row.authorStatus === 'BLOCKED',
    },
    rating: review.rating,
    tags: review.tags,
    comment: review.comment,
    authorKind: review.authorKind,
    counted: review.counted,
    hidden: review.commentHiddenAt
      ? {
          at: review.commentHiddenAt.toISOString(),
          byName: row.hiderName,
          reason: review.commentHiddenReason,
        }
      : null,
    reply: toReply(review),
    openReports: row.openReports,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

const reportColumns = {
  report: spaceReviewReports,
  reporterName: reporter.name,
  resolverName: resolver.name,
};

function toReport(row: {
  report: typeof spaceReviewReports.$inferSelect;
  reporterName: string | null;
  resolverName: string | null;
}): SuperReviewReport {
  const { report } = row;
  return {
    id: report.id,
    reviewId: report.reviewId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    reporter: {
      userId: report.reporterUserId,
      name: row.reporterName,
      spaceId: report.reporterSpaceId,
    },
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    resolvedByName: row.resolverName,
    resolutionReason: report.resolutionReason,
  };
}

/**
 * Moderação das avaliações no Super (RF-REVIEW-07, RN-REVIEW-04, decisão 103): a fila de
 * denúncias, as avaliações por espaço, ocultar e reexibir o comentário (com motivo; a nota segue na
 * média) e descartar denúncia. Tudo auditado com a avaliação como entidade, o que forma o
 * histórico de moderação.
 */
@Injectable()
export class SuperReviewsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Fila: as abertas da mais antiga para a mais nova; os demais status, mais recentes primeiro. */
  async reports(query: SuperReviewReportsQuery): Promise<SuperReviewReportPage> {
    const direction = query.status === 'OPEN' ? 'asc' : 'desc';
    const order = direction === 'asc' ? asc : desc;
    const rows = await this.db
      .select({ ...reportColumns, cursorAt: cursorText(spaceReviewReports.createdAt) })
      .from(spaceReviewReports)
      .leftJoin(reporter, eq(reporter.id, spaceReviewReports.reporterUserId))
      .leftJoin(resolver, eq(resolver.id, spaceReviewReports.resolvedBy))
      .where(
        and(
          query.status ? eq(spaceReviewReports.status, query.status) : undefined,
          afterCursor(spaceReviewReports.createdAt, spaceReviewReports.id, query.cursor, direction),
        ),
      )
      .orderBy(order(spaceReviewReports.createdAt), order(spaceReviewReports.id))
      .limit(query.limit + 1);
    const page = pageOf(rows, query.limit, (row) => row.report.id, toReport);
    const reviews = await this.reviewsByIds(page.items.map((item) => item.reviewId));
    return {
      nextCursor: page.nextCursor,
      items: page.items.flatMap((item) => {
        const review = reviews.get(item.reviewId);
        return review ? [{ ...item, review }] : [];
      }),
    };
  }

  /**
   * Resumo de um espaço em qualquer status (inclusive fora da vitrine): o do painel (média mesmo
   * abaixo de 5, distribuição e destaques das que contam) mais quantas estão fora da média
   * (autor bloqueado, RN-REVIEW-03).
   */
  async summary(spaceId: string): Promise<SuperReviewSummary> {
    const [space] = await this.db
      .select({
        count: spaces.ratingCount,
        sum: spaces.ratingSum,
        inShowcase: sql<boolean>`${visibleInShowcase}`,
      })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    if (!space) throw spaceNotFound();
    const [distribution, highlights, uncounted] = await Promise.all([
      ratingDistribution(this.db, spaceId),
      tagHighlights(this.db, spaceId),
      this.db
        .select({ total: count() })
        .from(spaceReviews)
        .where(and(eq(spaceReviews.spaceId, spaceId), eq(spaceReviews.counted, false))),
    ]);
    return {
      count: space.count,
      average: reviewAverage(space.sum, space.count, 1),
      publicSummaryVisible: isPublicSummaryVisible(space),
      uncountedCount: uncounted[0]?.total ?? 0,
      distribution,
      highlights,
    };
  }

  /** Avaliações de um espaço, inclusive as fora da média (autor bloqueado). */
  async reviews(query: SuperReviewsQuery): Promise<SuperReviewPage> {
    const rows = await this.selectReviews()
      .where(
        and(
          eq(spaceReviews.spaceId, query.spaceId),
          query.rating ? eq(spaceReviews.rating, query.rating) : undefined,
          query.hidden === undefined
            ? undefined
            : query.hidden
              ? isNotNull(spaceReviews.commentHiddenAt)
              : sql`${spaceReviews.commentHiddenAt} IS NULL`,
          query.reported === undefined
            ? undefined
            : query.reported
              ? sql`${openReports} > 0`
              : sql`${openReports} = 0`,
          afterCursor(spaceReviews.createdAt, spaceReviews.id, query.cursor),
        ),
      )
      .orderBy(desc(spaceReviews.createdAt), desc(spaceReviews.id))
      .limit(query.limit + 1);
    return pageOf(rows, query.limit, (row) => row.review.id, toSuperReview);
  }

  /** Avaliação com todas as denúncias e o histórico de moderação (auditoria). */
  async detail(reviewId: string): Promise<SuperReviewDetail> {
    const review = (await this.reviewsByIds([reviewId])).get(reviewId);
    if (!review) throw reviewNotFound();
    const [reports, history] = await Promise.all([
      this.db
        .select(reportColumns)
        .from(spaceReviewReports)
        .leftJoin(reporter, eq(reporter.id, spaceReviewReports.reporterUserId))
        .leftJoin(resolver, eq(resolver.id, spaceReviewReports.resolvedBy))
        .where(eq(spaceReviewReports.reviewId, reviewId))
        .orderBy(asc(spaceReviewReports.createdAt), asc(spaceReviewReports.id)),
      this.db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          actorName: users.name,
          actingAsSuper: auditLogs.actingAsSuper,
          diff: auditLogs.diff,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(and(eq(auditLogs.entity, REVIEW_AUDIT_ENTITY), eq(auditLogs.entityId, reviewId)))
        .orderBy(desc(auditLogs.id)),
    ]);
    return {
      ...review,
      reports: reports.map(toReport),
      history: history.map(
        (entry): ReviewModerationEntry => ({
          ...entry,
          createdAt: entry.createdAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * Oculta o comentário (RN-REVIEW-04): a nota continua na média e as denúncias abertas da
   * avaliação são resolvidas, com o motivo da ocultação. Auditado (`review.hide`) com o motivo.
   */
  async hide(
    actorId: string,
    reviewId: string,
    { reason }: ModerateReviewInput,
  ): Promise<SuperReviewDetail> {
    await this.db.transaction(async (tx) => {
      const review = await this.lockReview(tx, reviewId);
      if (review.comment === null) throw reviewNoComment();
      if (review.commentHiddenAt) throw reviewCommentHidden();
      const now = new Date();
      await tx
        .update(spaceReviews)
        .set({
          commentHiddenAt: now,
          commentHiddenBy: actorId,
          commentHiddenReason: reason,
          updatedAt: sql`${spaceReviews.updatedAt}`,
        })
        .where(eq(spaceReviews.id, reviewId));
      const resolved = await tx
        .update(spaceReviewReports)
        .set({
          status: 'RESOLVED',
          resolvedBy: actorId,
          resolvedAt: now,
          resolutionReason: reason,
        })
        .where(
          and(eq(spaceReviewReports.reviewId, reviewId), eq(spaceReviewReports.status, 'OPEN')),
        )
        .returning({ id: spaceReviewReports.id });
      await superAudit(tx, actorId, {
        action: 'review.hide',
        entity: REVIEW_AUDIT_ENTITY,
        entityId: reviewId,
        spaceId: review.spaceId,
        diff: { reason, resolvedReports: resolved.map((report) => report.id) },
      });
    });
    return this.detail(reviewId);
  }

  /** Reexibe o comentário oculto, com motivo (`review.unhide`). */
  async unhide(
    actorId: string,
    reviewId: string,
    { reason }: ModerateReviewInput,
  ): Promise<SuperReviewDetail> {
    await this.db.transaction(async (tx) => {
      const review = await this.lockReview(tx, reviewId);
      if (!review.commentHiddenAt) throw reviewCommentNotHidden();
      await tx
        .update(spaceReviews)
        .set({
          commentHiddenAt: null,
          commentHiddenBy: null,
          commentHiddenReason: null,
          updatedAt: sql`${spaceReviews.updatedAt}`,
        })
        .where(eq(spaceReviews.id, reviewId));
      await superAudit(tx, actorId, {
        action: 'review.unhide',
        entity: REVIEW_AUDIT_ENTITY,
        entityId: reviewId,
        spaceId: review.spaceId,
        diff: { reason },
      });
    });
    return this.detail(reviewId);
  }

  /**
   * Descarta a denúncia aberta, com motivo opcional gravado na denúncia e na auditoria
   * (`review.report_dismiss`); a avaliação não muda.
   */
  async dismissReport(
    actorId: string,
    reportId: string,
    { reason }: DismissReviewReport,
  ): Promise<SuperReviewDetail> {
    // Sem corpo, o campo nem chega: grava e audita nulo.
    const resolutionReason = reason ?? null;
    const reviewId = await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({
          reviewId: spaceReviewReports.reviewId,
          status: spaceReviewReports.status,
          spaceId: spaceReviews.spaceId,
        })
        .from(spaceReviewReports)
        .innerJoin(spaceReviews, eq(spaceReviews.id, spaceReviewReports.reviewId))
        .where(eq(spaceReviewReports.id, reportId))
        .for('update', { of: spaceReviewReports });
      if (!report) throw reviewReportNotFound();
      if (report.status !== 'OPEN') throw reviewReportResolved();
      await tx
        .update(spaceReviewReports)
        .set({
          status: 'DISMISSED',
          resolvedBy: actorId,
          resolvedAt: new Date(),
          resolutionReason,
        })
        .where(eq(spaceReviewReports.id, reportId));
      await superAudit(tx, actorId, {
        action: 'review.report_dismiss',
        entity: REVIEW_AUDIT_ENTITY,
        entityId: report.reviewId,
        spaceId: report.spaceId,
        diff: { reportId, reason: resolutionReason },
      });
      return report.reviewId;
    });
    return this.detail(reviewId);
  }

  private selectReviews() {
    return this.db
      .select({ ...reviewColumns, cursorAt: cursorText(spaceReviews.createdAt) })
      .from(spaceReviews)
      .innerJoin(spaces, eq(spaces.id, spaceReviews.spaceId))
      .leftJoin(author, eq(author.id, spaceReviews.userId))
      .leftJoin(hider, eq(hider.id, spaceReviews.commentHiddenBy))
      .$dynamic();
  }

  private async reviewsByIds(ids: string[]): Promise<Map<string, SuperReview>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.selectReviews().where(inArray(spaceReviews.id, unique));
    return new Map(rows.map((row) => [row.review.id, toSuperReview(row)]));
  }

  private async lockReview(tx: Tx, reviewId: string) {
    const [review] = await tx
      .select()
      .from(spaceReviews)
      .where(eq(spaceReviews.id, reviewId))
      .for('update');
    if (!review) throw reviewNotFound();
    return review;
  }
}
