import type { ReviewAuthorKind, ReviewTag } from '@space-sports/shared';
import { adjustSpaceRating, lockSpaceRating, markFirstReview } from '../reviews/review-rules.js';
import type { Database } from './client.js';
import { spaceReviews } from './schema/index.js';

/** Avaliação de demonstração: sempre de usuário fictício, nunca em espaço parceiro real. */
export type DemoReview = {
  userId: string;
  rating: number;
  tags?: ReviewTag[];
  comment?: string | null;
  authorKind?: ReviewAuthorKind;
  /** Dias antes de `now` em que a avaliação foi criada. */
  daysAgo: number;
  /** Resposta pública do espaço (Dono ou Admin). */
  reply?: { body: string; byUserId: string };
  /** Comentário oculto pela moderação (Super). */
  hidden?: { reason: string; byUserId: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Grava avaliações de demonstração (seed do e2e; RF-REVIEW) e soma a contagem e a nota no espaço
 * na mesma transação, como a API faz (RN-REVIEW-03). Idempotente: quem já avaliou o espaço fica
 * como está. Devolve quantas avaliações foram criadas.
 */
export async function seedDemoReviews(
  db: Database,
  spaceId: string,
  reviews: DemoReview[],
  now: Date = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    if (!(await lockSpaceRating(tx, spaceId))) throw new Error(`Espaço ${spaceId} não existe.`);
    let count = 0;
    let sum = 0;
    for (const review of reviews) {
      const createdAt = new Date(now.getTime() - review.daysAgo * DAY_MS);
      const [inserted] = await tx
        .insert(spaceReviews)
        .values({
          spaceId,
          userId: review.userId,
          rating: review.rating,
          tags: review.tags ?? [],
          comment: review.comment ?? null,
          authorKind: review.authorKind ?? 'PLAYER',
          createdAt,
          updatedAt: createdAt,
          ...(review.reply
            ? {
                reply: review.reply.body,
                replyBy: review.reply.byUserId,
                repliedAt: new Date(createdAt.getTime() + DAY_MS / 2),
              }
            : {}),
          ...(review.hidden
            ? {
                commentHiddenAt: new Date(createdAt.getTime() + DAY_MS / 4),
                commentHiddenBy: review.hidden.byUserId,
                commentHiddenReason: review.hidden.reason,
              }
            : {}),
        })
        .onConflictDoNothing()
        .returning({ rating: spaceReviews.rating });
      if (!inserted) continue;
      // Como a API: a avaliação já existiu, então recriá-la não avisa a gestão.
      await markFirstReview(tx, review.userId, spaceId);
      count += 1;
      sum += inserted.rating;
    }
    await adjustSpaceRating(tx, spaceId, count, sum);
    return count;
  });
}
