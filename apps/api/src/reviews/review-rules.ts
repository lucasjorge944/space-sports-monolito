import {
  REVIEW_ELIGIBILITY_MONTHS,
  type ReviewAuthorKind,
  type ReviewIneligibleReason,
} from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../bookings/db-utils.js';
import {
  attendances,
  bookingParticipants,
  bookings,
  classSessions,
  reviewCreatedNotices,
  reviewPrompts,
  spaceMembers,
  spaceReviewReports,
  spaceReviews,
  spaces,
  users,
} from '../db/schema/index.js';
import { visibleInShowcase } from '../spaces/space-queries.js';

// Regras de avaliação que dependem do banco (RN-REVIEW-01, 03 e 06), usadas pelas rotas, pelo job
// de pedidos, pelo bloqueio no Super e pela exclusão da conta.

/** RN-REVIEW-01: reserva terminada que dá direito a avaliar (no-show e cancelada não). */
export const REVIEWABLE_BOOKING_STATUSES = ['CONFIRMED', 'COMPLETED'] as const;
/** RN-REVIEW-01: presença na aula que dá direito a avaliar (falta e espera não). */
export const REVIEWABLE_ATTENDANCE_STATUSES = ['CONFIRMED', 'PRESENT'] as const;

const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
export const reviewableBookingStatuses = sql`(${list(REVIEWABLE_BOOKING_STATUSES)})`;
export const reviewableAttendanceStatuses = sql`(${list(REVIEWABLE_ATTENDANCE_STATUSES)})`;

export type ReviewUse = {
  kind: ReviewAuthorKind;
  sourceType: 'BOOKING' | 'CLASS_SESSION';
  sourceId: string;
  endedAt: Date;
};

/**
 * Uso mais recente que dá direito a avaliar o espaço (RN-REVIEW-01, decisão 99): reserva
 * `CONFIRMED`/`COMPLETED` já terminada em que a pessoa é organizadora ou participante `ACCEPTED`,
 * ou presença `CONFIRMED`/`PRESENT` numa aula já terminada e não cancelada, com o fim nos últimos 6
 * meses. O tipo do uso dá o selo do autor ("Jogou aqui" ou "Aluno").
 */
export async function latestEligibleUse(
  db: DbOrTx,
  userId: string,
  spaceId: string,
  now: Date = new Date(),
): Promise<ReviewUse | null> {
  const since = sql`(${now}::timestamptz - make_interval(months => ${REVIEW_ELIGIBILITY_MONTHS}::int))`;
  const { rows } = await db.execute<{
    kind: ReviewAuthorKind;
    source_type: ReviewUse['sourceType'];
    source_id: string;
    ended_at: Date | string;
  }>(sql`
    SELECT kind, source_type, source_id, ended_at FROM (
      SELECT 'PLAYER' AS kind, 'BOOKING' AS source_type, ${bookings.id} AS source_id,
        ${bookings.endsAt} AS ended_at
      FROM ${bookings}
      WHERE ${bookings.spaceId} = ${spaceId} AND ${bookings.organizerUserId} = ${userId}
        AND ${bookings.status} IN ${reviewableBookingStatuses}
        AND ${bookings.endsAt} <= ${now} AND ${bookings.endsAt} > ${since}
      UNION ALL
      SELECT 'PLAYER', 'BOOKING', ${bookings.id}, ${bookings.endsAt}
      FROM ${bookingParticipants}
      JOIN ${bookings} ON ${bookings.id} = ${bookingParticipants.bookingId}
      WHERE ${bookingParticipants.userId} = ${userId} AND ${bookingParticipants.status} = 'ACCEPTED'
        AND ${bookings.spaceId} = ${spaceId} AND ${bookings.status} IN ${reviewableBookingStatuses}
        AND ${bookings.endsAt} <= ${now} AND ${bookings.endsAt} > ${since}
      UNION ALL
      SELECT 'STUDENT', 'CLASS_SESSION', ${classSessions.id}, ${classSessions.endsAt}
      FROM ${attendances}
      JOIN ${classSessions} ON ${classSessions.id} = ${attendances.sessionId}
      WHERE ${attendances.userId} = ${userId}
        AND ${attendances.status} IN ${reviewableAttendanceStatuses}
        AND ${classSessions.spaceId} = ${spaceId} AND ${classSessions.status} <> 'CANCELLED'
        AND ${classSessions.endsAt} <= ${now} AND ${classSessions.endsAt} > ${since}
    ) uses
    ORDER BY ended_at DESC, source_id DESC
    LIMIT 1
  `);
  const [row] = rows;
  if (!row) return null;
  return {
    kind: row.kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    endedAt: new Date(row.ended_at),
  };
}

/** Decisão 99: vínculo `ACTIVE` com o espaço (Dono, Admin ou Professor) impede avaliar. */
export async function isActiveStaff(db: DbOrTx, userId: string, spaceId: string) {
  const [row] = await db
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * RN-REVIEW-01: sem avaliação, pode criar quem não é da equipe ativa e usou o espaço nos últimos
 * 6 meses; com avaliação, edita a qualquer momento quem não é da equipe ativa (decisão 99). O
 * autor sempre pode excluir. `reason` diz por que não pode a ação que cabe (criar ou editar).
 */
export function reviewAccess(
  staff: boolean,
  hasReview: boolean,
  use: ReviewUse | null,
): { canCreate: boolean; canEdit: boolean; reason: ReviewIneligibleReason | null } {
  const reason: ReviewIneligibleReason | null = staff
    ? 'REVIEW_NOT_ALLOWED'
    : !hasReview && !use
      ? 'REVIEW_NOT_ELIGIBLE'
      : null;
  return { canCreate: !hasReview && reason === null, canEdit: hasReview && !staff, reason };
}

/** O espaço está na vitrine (RN-SPACE-01)? Mesma visibilidade da página pública (RN-REVIEW-07). */
export async function isInShowcase(db: DbOrTx, spaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), visibleInShowcase));
  return Boolean(row);
}

/**
 * Lê o status da conta com `FOR SHARE` antes de travar o espaço, na mesma ordem do bloqueio no
 * Super (`FOR UPDATE` na conta, depois os espaços): criar ou editar espera um bloqueio em curso
 * (e vice-versa), sem deadlock. Devolve se a nota conta na média (RN-REVIEW-03: conta bloqueada
 * não conta).
 */
export async function lockAuthorForReview(tx: Tx, userId: string): Promise<boolean> {
  const [author] = await tx
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .for('share');
  if (!author) throw new Error(`Usuário ${userId} não existe.`);
  return author.status !== 'BLOCKED';
}

/**
 * Marca a primeira avaliação da pessoa no espaço (`review_created_notices`, RF-REVIEW-09).
 * Devolve `true` só na primeira vez: é quando a gestão é avisada.
 */
export async function markFirstReview(tx: Tx, userId: string, spaceId: string): Promise<boolean> {
  const inserted = await tx
    .insert(reviewCreatedNotices)
    .values({ userId, spaceId })
    .onConflictDoNothing()
    .returning({ id: reviewCreatedNotices.id });
  return inserted.length > 0;
}

/** Pedido sem avaliação criada nesse prazo conta como ignorado (RN-REVIEW-02, decisão 101). */
export const REVIEW_PROMPT_ANSWER_DAYS = 7;

/**
 * RN-REVIEW-02 (BUG-AV5-2): a avaliação recém-criada responde aos pedidos daquele (autor, espaço)
 * enviados até 7 dias antes dela; grava `answered_at` com o `created_at` da avaliação. A marca
 * fica mesmo se a avaliação for excluída: o pedido respondido nunca vira "ignorado".
 */
export async function markPromptsAnswered(tx: Tx, reviewId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE ${reviewPrompts} AS p
    SET answered_at = r.created_at, updated_at = now()
    FROM ${spaceReviews} AS r
    WHERE r.id = ${reviewId}
      AND p.user_id = r.user_id AND p.space_id = r.space_id
      AND p.answered_at IS NULL
      AND p.sent_at <= r.created_at
      AND r.created_at < p.sent_at + make_interval(days => ${REVIEW_PROMPT_ANSWER_DAYS}::int)
  `);
}

/**
 * Trava a linha do espaço (RN-REVIEW-03): criar, editar, excluir e tirar da média passam por
 * aqui, então a contagem e a soma nunca se perdem entre duas transações. `null` se o espaço não
 * existe.
 */
export async function lockSpaceRating(
  tx: Tx,
  spaceId: string,
): Promise<{ inShowcase: boolean } | null> {
  const { rows } = await tx.execute<{ in_showcase: boolean }>(sql`
    SELECT ${visibleInShowcase} AS in_showcase FROM ${spaces}
    WHERE ${spaces.id} = ${spaceId}
    FOR UPDATE OF ${spaces}
  `);
  const [row] = rows;
  return row ? { inShowcase: row.in_showcase } : null;
}

/**
 * Soma à contagem e à soma das notas do espaço (linha já travada). Sem o Drizzle: a nota não é
 * edição do espaço e não renova o `updated_at`.
 */
export async function adjustSpaceRating(
  tx: Tx,
  spaceId: string,
  deltaCount: number,
  deltaSum: number,
): Promise<void> {
  if (!deltaCount && !deltaSum) return;
  await tx.execute(sql`
    UPDATE ${spaces}
    SET rating_count = rating_count + ${deltaCount}::int, rating_sum = rating_sum + ${deltaSum}::int
    WHERE ${spaces.id} = ${spaceId}
  `);
}

/**
 * Bloqueio e desbloqueio no Super (RN-REVIEW-03): as avaliações do autor saem da média (e da
 * lista pública) enquanto durar o bloqueio e voltam no desbloqueio. Trava os espaços em ordem de id
 * para não haver deadlock com quem avalia ao mesmo tempo.
 */
export async function setUserReviewsCounted(
  tx: Tx,
  userId: string,
  counted: boolean,
): Promise<void> {
  const affected = await tx
    .selectDistinct({ spaceId: spaceReviews.spaceId })
    .from(spaceReviews)
    .where(and(eq(spaceReviews.userId, userId), eq(spaceReviews.counted, !counted)))
    .orderBy(spaceReviews.spaceId);
  const sign = counted ? 1 : -1;
  for (const { spaceId } of affected) {
    await lockSpaceRating(tx, spaceId);
    // A nota é lida com o espaço travado: uma edição concorrente pode tê-la mudado.
    const reviews = await tx
      .update(spaceReviews)
      // Não é edição da avaliação: o `updated_at` (marca "editada" na lista) fica.
      .set({ counted, updatedAt: sql`${spaceReviews.updatedAt}` })
      .where(
        and(
          eq(spaceReviews.userId, userId),
          eq(spaceReviews.spaceId, spaceId),
          eq(spaceReviews.counted, !counted),
        ),
      )
      .returning({ rating: spaceReviews.rating });
    const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
    await adjustSpaceRating(tx, spaceId, sign * reviews.length, sign * sum);
  }
}

/**
 * Exclusão da conta (RN-REVIEW-06, decisão 105): a nota e os chips ficam, sem autor ("Usuário
 * removido") e na média como antes; o comentário, a resposta do espaço, a moderação daquele
 * comentário, as denúncias feitas pela pessoa, os pedidos de avaliação dela e as marcas de
 * primeira avaliação (`review_created_notices`) são apagados.
 */
export async function anonymizeUserReviews(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(spaceReviews)
    .set({
      userId: null,
      comment: null,
      commentHiddenAt: null,
      commentHiddenBy: null,
      commentHiddenReason: null,
      reply: null,
      replyBy: null,
      repliedAt: null,
      replyUpdatedAt: null,
      updatedAt: sql`${spaceReviews.updatedAt}`,
    })
    .where(eq(spaceReviews.userId, userId));
  await tx.delete(spaceReviewReports).where(eq(spaceReviewReports.reporterUserId, userId));
  await tx.delete(reviewPrompts).where(eq(reviewPrompts.userId, userId));
  await tx.delete(reviewCreatedNotices).where(eq(reviewCreatedNotices.userId, userId));
}
