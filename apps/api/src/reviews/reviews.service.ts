import { Inject, Injectable } from '@nestjs/common';
import {
  type MyReview,
  type MyReviewPage,
  type MyReviewsQuery,
  type PublicReviewPage,
  type PublicReviewsQuery,
  REVIEW_RECENT_COMMENTS,
  REVIEW_TOP_TAGS,
  type ReportReviewInput,
  type ReviewEligibility,
  type ReviewSummary,
  reviewAverage,
  reviewTagsMatchRating,
  type UpsertReview,
} from '@space-sports/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type DbOrTx, isUniqueViolation } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  cities,
  spaceMembers,
  spaceReviewReports,
  spaceReviews,
  spaces,
  users,
} from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { visibleInShowcase } from '../spaces/space-queries.js';
import {
  adjustSpaceRating,
  isActiveStaff,
  isInShowcase,
  latestEligibleUse,
  lockAuthorForReview,
  lockSpaceRating,
  markFirstReview,
  markPromptsAnswered,
  reviewAccess,
} from './review-rules.js';
import {
  afterCursor,
  countedIn,
  cursorText,
  pageOf,
  publicReviewColumns,
  ratingDistribution,
  recentWithComment,
  toMyReview,
  toPublicReview,
  topTags,
} from './review-views.js';
import {
  reviewAlreadyExists,
  reviewAlreadyReported,
  reviewNotAllowed,
  reviewNotEligible,
  reviewNotFound,
  reviewReportOwn,
  reviewTagsMismatch,
  spaceNotFound,
} from './reviews.errors.js';

/**
 * Avaliações do jogador (RF-REVIEW-01, 02, 04 e 08) e as leituras públicas (RF-REVIEW-03 e 04).
 * A elegibilidade é conferida no servidor com a mesma consulta da rota de elegibilidade
 * (RN-REVIEW-01); a contagem e a soma do espaço mudam na mesma transação, com a linha do espaço
 * travada (RN-REVIEW-03).
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Jogador

  /** O botão "Avaliar"/"Editar minha avaliação" e o card da reserva/aula passada. */
  async eligibility(userId: string, spaceId: string): Promise<ReviewEligibility> {
    if (!(await isInShowcase(this.db, spaceId))) throw spaceNotFound();
    const [mine, staff, use] = await Promise.all([
      this.findMine(userId, spaceId),
      isActiveStaff(this.db, userId, spaceId),
      latestEligibleUse(this.db, userId, spaceId),
    ]);
    const access = reviewAccess(staff, Boolean(mine), use);
    return {
      canReview: access.canCreate,
      canEdit: access.canEdit,
      reason: access.reason,
      myReview: mine ? toMyReview(mine) : null,
    };
  }

  /**
   * Cria ou substitui a avaliação (uma por pessoa e espaço). Ordem dos erros: chips x nota (400),
   * espaço fora da vitrine (404), `createOnly` com avaliação existente (409
   * `REVIEW_ALREADY_EXISTS`), equipe ativa (403 `REVIEW_NOT_ALLOWED`) e, só ao criar, sem uso
   * (403 `REVIEW_NOT_ELIGIBLE`). O selo do autor acompanha o uso mais recente; o comentário oculto
   * pela moderação continua oculto depois da edição (RN-REVIEW-04).
   */
  async upsert(
    userId: string,
    spaceId: string,
    input: UpsertReview,
    { createOnly = false }: { createOnly?: boolean } = {},
  ): Promise<MyReview> {
    if (!reviewTagsMatchRating(input.rating, input.tags)) throw reviewTagsMismatch();
    const { row, notify } = await this.db.transaction(async (tx) => {
      // Mesma ordem do bloqueio no Super (a conta, depois os espaços): um bloqueio em curso
      // termina antes, e a nota nasce fora da média se a conta acabou de ser bloqueada.
      const counted = await lockAuthorForReview(tx, userId);
      const space = await lockSpaceRating(tx, spaceId);
      if (!space?.inShowcase) throw spaceNotFound();
      const [existing] = await tx
        .select()
        .from(spaceReviews)
        .where(and(eq(spaceReviews.spaceId, spaceId), eq(spaceReviews.userId, userId)));
      if (existing && createOnly) throw reviewAlreadyExists();
      const [staff, use] = await Promise.all([
        isActiveStaff(tx, userId, spaceId),
        latestEligibleUse(tx, userId, spaceId),
      ]);
      const { reason } = reviewAccess(staff, Boolean(existing), use);
      if (reason === 'REVIEW_NOT_ALLOWED') throw reviewNotAllowed();
      if (reason === 'REVIEW_NOT_ELIGIBLE') throw reviewNotEligible();

      const values = { rating: input.rating, tags: input.tags, comment: input.comment, counted };
      const weight = (review: { counted: boolean; rating: number }) =>
        review.counted ? { count: 1, sum: review.rating } : { count: 0, sum: 0 };
      if (existing) {
        const [updated] = await tx
          .update(spaceReviews)
          .set({ ...values, authorKind: use?.kind ?? existing.authorKind })
          .where(eq(spaceReviews.id, existing.id))
          .returning();
        if (!updated) throw reviewNotFound();
        const before = weight(existing);
        const after = weight(updated);
        await adjustSpaceRating(tx, spaceId, after.count - before.count, after.sum - before.sum);
        return { row: updated, notify: false };
      }
      if (!use) throw reviewNotEligible();
      const [inserted] = await tx
        .insert(spaceReviews)
        .values({ ...values, spaceId, userId, authorKind: use.kind })
        .returning();
      if (!inserted) throw new Error('Avaliação não gravada.');
      const added = weight(inserted);
      await adjustSpaceRating(tx, spaceId, added.count, added.sum);
      // RN-REVIEW-02: o pedido dos últimos 7 dias foi respondido (não conta como ignorado).
      await markPromptsAnswered(tx, inserted.id);
      // RF-REVIEW-09: a gestão é avisada só na primeira avaliação desta pessoa neste espaço
      // (excluir e avaliar de novo não repete), e não da nota que nasce fora da média.
      return { row: inserted, notify: counted && (await markFirstReview(tx, userId, spaceId)) };
    });
    if (notify) await this.events.publish({ type: 'review.created', reviewId: row.id });
    return toMyReview(row);
  }

  /** O autor exclui a avaliação a qualquer momento, mesmo com o espaço fora da vitrine. */
  async remove(userId: string, spaceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (!(await lockSpaceRating(tx, spaceId))) throw reviewNotFound();
      const [deleted] = await tx
        .delete(spaceReviews)
        .where(and(eq(spaceReviews.spaceId, spaceId), eq(spaceReviews.userId, userId)))
        .returning({ rating: spaceReviews.rating, counted: spaceReviews.counted });
      if (!deleted) throw reviewNotFound();
      if (deleted.counted) await adjustSpaceRating(tx, spaceId, -1, -deleted.rating);
    });
  }

  /**
   * "Minhas avaliações" (RF-REVIEW-08): mais recentes primeiro, em qualquer espaço (com bairro e
   * cidade, como no card da vitrine), com `canEdit`
   * (espaço na vitrine e a pessoa fora da equipe ativa) para o app mostrar só leitura sem esperar
   * o 403.
   */
  async listMine(userId: string, query: MyReviewsQuery): Promise<MyReviewPage> {
    const rows = await this.db
      .select({
        review: spaceReviews,
        cursorAt: cursorText(spaceReviews.createdAt),
        space: {
          id: spaces.id,
          slug: spaces.slug,
          name: spaces.name,
          logoUrl: spaces.logoUrl,
          // Os mesmos campos do card da vitrine ("bairro · cidade").
          neighborhood: spaces.addressNeighborhood,
          city: cities.name,
          inShowcase: sql<boolean>`${visibleInShowcase}`,
        },
        staff: sql<boolean>`EXISTS (
          SELECT 1 FROM ${spaceMembers}
          WHERE ${spaceMembers.userId} = ${userId} AND ${spaceMembers.spaceId} = ${spaces.id}
            AND ${spaceMembers.status} = 'ACTIVE'
        )`,
      })
      .from(spaceReviews)
      .innerJoin(spaces, eq(spaces.id, spaceReviews.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(
        and(
          eq(spaceReviews.userId, userId),
          afterCursor(spaceReviews.createdAt, spaceReviews.id, query.cursor),
        ),
      )
      .orderBy(desc(spaceReviews.createdAt), desc(spaceReviews.id))
      .limit(query.limit + 1);
    return pageOf(
      rows,
      query.limit,
      (row) => row.review.id,
      (row) => ({
        ...toMyReview(row.review),
        space: row.space,
        canEdit: row.space.inShowcase && !row.staff,
      }),
    );
  }

  /**
   * Denúncia (RN-REVIEW-04): de quem está logado, uma por pessoa e avaliação, nunca da própria.
   * Só avaliações que aparecem em público (espaço na vitrine, autor não bloqueado).
   */
  async report(userId: string, reviewId: string, input: ReportReviewInput): Promise<void> {
    const [review] = await this.db
      .select({ userId: spaceReviews.userId })
      .from(spaceReviews)
      .innerJoin(spaces, eq(spaces.id, spaceReviews.spaceId))
      .where(and(eq(spaceReviews.id, reviewId), eq(spaceReviews.counted, true), visibleInShowcase));
    if (!review) throw reviewNotFound();
    if (review.userId === userId) throw reviewReportOwn();
    await insertReport(this.db, {
      reviewId,
      reporterUserId: userId,
      reason: input.reason,
      details: input.details ?? null,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Público (mesma visibilidade da página do espaço, RN-REVIEW-07)

  /** RF-REVIEW-03: total, média (a partir de 5), distribuição, chips mais citados e recentes. */
  async summary(spaceId: string): Promise<ReviewSummary> {
    const [space] = await this.db
      .select({ count: spaces.ratingCount, sum: spaces.ratingSum })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), visibleInShowcase));
    if (!space) throw spaceNotFound();
    const [distribution, tags, recent] = await Promise.all([
      ratingDistribution(this.db, spaceId),
      topTags(this.db, spaceId, REVIEW_TOP_TAGS),
      recentWithComment(this.db, spaceId, REVIEW_RECENT_COMMENTS),
    ]);
    return {
      count: space.count,
      average: reviewAverage(space.sum, space.count),
      distribution,
      topTags: tags,
      recent,
    };
  }

  /** RF-REVIEW-04: lista paginada, mais recentes primeiro, com filtro por nota. */
  async list(spaceId: string, query: PublicReviewsQuery): Promise<PublicReviewPage> {
    if (!(await isInShowcase(this.db, spaceId))) throw spaceNotFound();
    const rows = await this.db
      .select({ ...publicReviewColumns, cursorAt: cursorText(spaceReviews.createdAt) })
      .from(spaceReviews)
      .leftJoin(users, eq(users.id, spaceReviews.userId))
      .where(
        and(
          countedIn(spaceId),
          query.rating ? eq(spaceReviews.rating, query.rating) : undefined,
          afterCursor(spaceReviews.createdAt, spaceReviews.id, query.cursor),
        ),
      )
      .orderBy(desc(spaceReviews.createdAt), desc(spaceReviews.id))
      .limit(query.limit + 1);
    return pageOf(rows, query.limit, (row) => row.review.id, toPublicReview);
  }

  private async findMine(userId: string, spaceId: string) {
    const [row] = await this.db
      .select()
      .from(spaceReviews)
      .where(and(eq(spaceReviews.spaceId, spaceId), eq(spaceReviews.userId, userId)));
    return row;
  }
}

/** Grava a denúncia; a segunda da mesma pessoa responde 409 `REVIEW_ALREADY_REPORTED`. */
export async function insertReport(
  db: DbOrTx,
  values: typeof spaceReviewReports.$inferInsert,
): Promise<string> {
  try {
    const [row] = await db
      .insert(spaceReviewReports)
      .values(values)
      .returning({ id: spaceReviewReports.id });
    if (!row) throw new Error('Denúncia não gravada.');
    return row.id;
  } catch (err) {
    if (isUniqueViolation(err, 'space_review_reports_review_reporter_unique')) {
      throw reviewAlreadyReported();
    }
    throw err;
  }
}
