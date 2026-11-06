import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import { spaceReviews, spaces } from '../../src/db/schema/index.js';
import { first } from '../db/helpers.js';

// Fixtures da QA das avaliações (AV.5): avaliações gravadas direto no banco, para os testes que
// precisam de muitas avaliações sem passar pela elegibilidade (já coberta em eligibility).

type ReviewValues = typeof spaceReviews.$inferInsert;

/**
 * Grava uma avaliação e ajusta `rating_count`/`rating_sum` do espaço como a API faria (só conta
 * se `counted`). Sem `userId` a avaliação nasce anônima ("Usuário removido"), o que dispensa um
 * autor por avaliação (o índice único é parcial: só vale com `user_id`).
 */
export async function insertReviewRow(
  db: Database,
  spaceId: string,
  overrides: Partial<ReviewValues> = {},
) {
  const row = first(
    await db
      .insert(spaceReviews)
      .values({
        spaceId,
        userId: null,
        rating: 4,
        authorKind: 'PLAYER',
        comment: 'Comentário de teste',
        ...overrides,
      })
      .returning(),
  );
  if (row.counted) {
    await db
      .update(spaces)
      .set({
        ratingCount: sql`${spaces.ratingCount} + 1`,
        ratingSum: sql`${spaces.ratingSum} + ${row.rating}`,
      })
      .where(eq(spaces.id, spaceId));
  }
  return row;
}
