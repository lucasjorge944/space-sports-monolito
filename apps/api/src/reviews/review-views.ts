import {
  formatReviewAuthorName,
  isPositiveReviewTag,
  type MyReview,
  type PublicReview,
  REVIEW_HIGHLIGHTS_PER_GROUP,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_SUMMARY_MIN_COUNT,
  type ReviewDistribution,
  type ReviewHighlights,
  type ReviewReply,
  type ReviewTagCount,
} from '@space-sports/shared';
import { and, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '../bookings/db-utils.js';
import { spaceReviews, users } from '../db/schema/index.js';
import { invalidCursor } from './reviews.errors.js';

// Leitura das avaliações: formatos de resposta e paginação, comuns às rotas públicas, da pessoa,
// da gestão e do Super.

export type ReviewRow = typeof spaceReviews.$inferSelect;

export function toReply(row: ReviewRow): ReviewReply | null {
  if (row.reply === null || !row.repliedAt) return null;
  return {
    body: row.reply,
    repliedAt: row.repliedAt.toISOString(),
    updatedAt: row.replyUpdatedAt?.toISOString() ?? null,
  };
}

/** A avaliação para o próprio autor: o comentário inteiro, mesmo oculto. */
export function toMyReview(row: ReviewRow): MyReview {
  return {
    id: row.id,
    spaceId: row.spaceId,
    rating: row.rating,
    tags: row.tags,
    comment: row.comment,
    commentHidden: row.commentHiddenAt !== null,
    authorKind: row.authorKind,
    reply: toReply(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Colunas da lista pública: a avaliação e o nome/foto do autor (sem o id dele). */
export const publicReviewColumns = {
  review: spaceReviews,
  authorName: users.name,
  authorAvatarUrl: users.avatarUrl,
};

export type PublicReviewRow = {
  review: ReviewRow;
  authorName: string | null;
  authorAvatarUrl: string | null;
};

/** RF-REVIEW-04: autor formatado, comentário nulo quando oculto (decisão 102, RN-REVIEW-04). */
export function toPublicReview({
  review,
  authorName,
  authorAvatarUrl,
}: PublicReviewRow): PublicReview {
  const hidden = review.commentHiddenAt !== null;
  const removed = review.userId === null;
  return {
    id: review.id,
    author: {
      name: formatReviewAuthorName(removed ? null : authorName),
      avatarUrl: removed ? null : authorAvatarUrl,
      kind: review.authorKind,
    },
    rating: review.rating,
    tags: review.tags,
    comment: hidden ? null : review.comment,
    commentHidden: hidden,
    reply: toReply(review),
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Paginação por (created_at, id)

/**
 * O `created_at` vai no cursor como texto com microssegundos: o `Date` do JS só guarda
 * milissegundos e pularia avaliações criadas no mesmo milissegundo.
 */
export const cursorText = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export type ReviewCursor = { at: string; id: string };

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeReviewCursor = (cursor: ReviewCursor) =>
  Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString('base64url');

export function decodeReviewCursor(value: string): ReviewCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      AT.test(parsed[0]) &&
      UUID.test(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // cai no erro abaixo
  }
  throw invalidCursor();
}

/** Linhas depois do cursor, na ordem (`created_at`, `id`) descendente ou ascendente. */
export function afterCursor(
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
  cursor: string | undefined,
  direction: 'desc' | 'asc' = 'desc',
): SQL | undefined {
  if (!cursor) return undefined;
  const { at, id: lastId } = decodeReviewCursor(cursor);
  return direction === 'desc'
    ? sql`(${createdAt}, ${id}) < (${at}::timestamptz, ${lastId}::uuid)`
    : sql`(${createdAt}, ${id}) > (${at}::timestamptz, ${lastId}::uuid)`;
}

/** Página com `limit` itens a partir de `limit + 1` linhas que trazem `cursorAt`. */
export function pageOf<Row extends { cursorAt: string }, Item>(
  rows: Row[],
  limit: number,
  idOf: (row: Row) => string,
  map: (row: Row) => Item,
): { items: Item[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(map),
    nextCursor:
      rows.length > limit && last
        ? encodeReviewCursor({ at: last.cursorAt, id: idOf(last) })
        : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Resumo

/** Avaliações que contam na média (autor não bloqueado, RN-REVIEW-03). */
export const countedIn = (spaceId: string) =>
  and(eq(spaceReviews.spaceId, spaceId), eq(spaceReviews.counted, true));

/**
 * `publicSummaryVisible` do painel e do Super: o público só vê a média do espaço na vitrine
 * (RN-REVIEW-07) e com ao menos `REVIEW_SUMMARY_MIN_COUNT` avaliações que contam (RF-REVIEW-03).
 * Suspenso ou encerrado, falso mesmo com 5 ou mais.
 */
export const isPublicSummaryVisible = (space: { inShowcase: boolean; count: number }): boolean =>
  space.inShowcase && space.count >= REVIEW_SUMMARY_MIN_COUNT;

/**
 * A média que o card mostra (`reviewAverage` de `packages/shared`), vezes 10, calculada no banco
 * (decisão 109): 49 é "★ 4,9". `Math.round(soma × 10 ÷ total)`, com soma e total inteiros e
 * positivos, é `⌊(20 × soma + total) ÷ (2 × total)⌋` na divisão inteira, com o meio para cima
 * como no `Math.round`: 3,95 dá 40 ("★ 4,0") e 3,94 dá 39. Sem avaliação, nula (sem divisão
 * por zero, qualquer que seja a ordem em que o banco avalia a condição).
 */
export const displayedAverageTenths = (sum: SQL | AnyPgColumn, count: SQL | AnyPgColumn) =>
  sql<number>`((20 * ${sum} + ${count}) / (2 * NULLIF(${count}, 0)))`;

/** Quantas avaliações têm cada nota, de 5 a 1 (as notas sem avaliação com zero). */
export async function ratingDistribution(db: DbOrTx, spaceId: string): Promise<ReviewDistribution> {
  const rows = await db
    .select({ rating: spaceReviews.rating, count: sql<number>`count(*)::int` })
    .from(spaceReviews)
    .where(countedIn(spaceId))
    .groupBy(spaceReviews.rating);
  const byRating = new Map(rows.map((row) => [row.rating, row.count]));
  const result: ReviewDistribution = [];
  for (let rating = REVIEW_RATING_MAX; rating >= REVIEW_RATING_MIN; rating--) {
    result.push({ rating, count: byRating.get(rating) ?? 0 });
  }
  return result;
}

/**
 * Chips mais citados nas avaliações que contam; empate na ordem do catálogo (a do enum). Sem
 * `limit`, todos os citados.
 */
export async function topTags(
  db: DbOrTx,
  spaceId: string,
  limit?: number,
): Promise<ReviewTagCount[]> {
  const { rows } = await db.execute<{ tag: ReviewTagCount['tag']; count: number }>(sql`
    SELECT tag, count(*)::int AS count
    FROM ${spaceReviews}, unnest(${spaceReviews.tags}) AS tag
    WHERE ${spaceReviews.spaceId} = ${spaceId} AND ${spaceReviews.counted}
    GROUP BY tag
    ORDER BY count DESC, tag
    ${limit === undefined ? sql`` : sql`LIMIT ${limit}`}
  `);
  return rows.map((row) => ({ tag: row.tag, count: row.count }));
}

/**
 * Painel e Super (RF-REVIEW-06 e 07): os mais citados de cada grupo, até 5 elogios e até 5
 * críticas, na ordem de `topTags` (o catálogo tem 8 de cada, então a consulta traz todos).
 */
export async function tagHighlights(db: DbOrTx, spaceId: string): Promise<ReviewHighlights> {
  const tags = await topTags(db, spaceId);
  return {
    positive: tags.filter((t) => isPositiveReviewTag(t.tag)).slice(0, REVIEW_HIGHLIGHTS_PER_GROUP),
    negative: tags.filter((t) => !isPositiveReviewTag(t.tag)).slice(0, REVIEW_HIGHLIGHTS_PER_GROUP),
  };
}

/** As avaliações recentes com comentário visível (bloco da página do espaço). */
export async function recentWithComment(
  db: DbOrTx,
  spaceId: string,
  limit: number,
): Promise<PublicReview[]> {
  const rows = await db
    .select(publicReviewColumns)
    .from(spaceReviews)
    .leftJoin(users, eq(users.id, spaceReviews.userId))
    .where(
      and(
        countedIn(spaceId),
        isNotNull(spaceReviews.comment),
        isNull(spaceReviews.commentHiddenAt),
      ),
    )
    .orderBy(desc(spaceReviews.createdAt), desc(spaceReviews.id))
    .limit(limit);
  return rows.map(toPublicReview);
}
