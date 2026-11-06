import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import {
  reviewAuthorKind,
  reviewPromptSource,
  reviewReportReason,
  reviewReportStatus,
  reviewTag,
} from './enums.js';
import { users } from './identity.js';
import { notifications } from './platform.js';
import { spaces } from './spaces.js';

/**
 * Avaliações de espaços (RF-REVIEW-01, decisões 99 a 105). Uma por pessoa e espaço; na exclusão
 * da conta (decisão 105) `user_id`, comentário e resposta viram nulos e a nota e os chips ficam.
 * `counted` = entra na média e na lista pública: falso enquanto o autor está bloqueado
 * (RN-REVIEW-03). `spaces.rating_count`/`rating_sum` somam só as `counted`.
 */
export const spaceReviews = pgTable(
  'space_reviews',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    /** Nulo depois da anonimização da conta. */
    userId: uuid().references(() => users.id),
    rating: smallint().notNull(),
    tags: reviewTag().array().notNull().default(sql`'{}'`),
    comment: text(),
    authorKind: reviewAuthorKind().notNull(),
    counted: boolean().notNull().default(true),
    /** Comentário oculto pelo Super (RN-REVIEW-04); a nota continua na média. */
    commentHiddenAt: tstz(),
    commentHiddenBy: uuid().references(() => users.id),
    commentHiddenReason: text(),
    /** Resposta pública do espaço (decisão 104). */
    reply: text(),
    replyBy: uuid().references(() => users.id),
    repliedAt: tstz(),
    replyUpdatedAt: tstz(),
    /**
     * Quando o autor foi avisado da primeira resposta (`REVIEW_REPLIED`). Fica mesmo se a resposta
     * for removida: editar, ou remover e responder de novo, não avisa outra vez.
     */
    replyNotifiedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('space_reviews_space_user_unique')
      .on(t.spaceId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    // Lista pública e do painel: mais recentes primeiro.
    index('space_reviews_space_id_created_at_idx').on(t.spaceId, t.createdAt.desc(), t.id.desc()),
    index('space_reviews_user_id_idx').on(t.userId),
    check('space_reviews_rating_range', sql`${t.rating} BETWEEN 1 AND 5`),
    check('space_reviews_tags_max', sql`cardinality(${t.tags}) <= 5`),
    check('space_reviews_comment_length', sql`char_length(${t.comment}) <= 500`),
    check('space_reviews_reply_length', sql`char_length(${t.reply}) <= 500`),
    check('space_reviews_reply_consistent', sql`(${t.reply} IS NULL) = (${t.repliedAt} IS NULL)`),
  ],
);

/**
 * Denúncias de avaliações (RN-REVIEW-04): uma por denunciante e avaliação. `reporter_space_id`
 * marca a denúncia feita pela gestão do espaço. Apagadas na exclusão da conta de quem denunciou.
 */
export const spaceReviewReports = pgTable(
  'space_review_reports',
  {
    id: id(),
    reviewId: uuid()
      .notNull()
      .references(() => spaceReviews.id, { onDelete: 'cascade' }),
    reporterUserId: uuid()
      .notNull()
      .references(() => users.id),
    reporterSpaceId: uuid().references(() => spaces.id),
    reason: reviewReportReason().notNull(),
    details: text(),
    status: reviewReportStatus().notNull().default('OPEN'),
    resolvedBy: uuid().references(() => users.id),
    resolvedAt: tstz(),
    /** Motivo opcional do descarte ou o motivo da ocultação do comentário que a resolveu. */
    resolutionReason: text(),
    ...timestamps,
  },
  (t) => [
    unique('space_review_reports_review_reporter_unique').on(t.reviewId, t.reporterUserId),
    // Fila do Super, por status e data.
    index('space_review_reports_status_created_at_idx').on(t.status, t.createdAt, t.id),
    index('space_review_reports_reporter_user_id_idx').on(t.reporterUserId),
    check('space_review_reports_details_length', sql`char_length(${t.details}) <= 500`),
    check(
      'space_review_reports_resolution_reason_length',
      sql`char_length(${t.resolutionReason}) <= 500`,
    ),
  ],
);

/**
 * Pedidos de avaliação enviados (RN-REVIEW-02). Gravado antes da notificação: o mesmo uso nunca
 * gera dois pedidos. Os últimos 30 dias e os ignorados (sem `answered_at` e com mais de 7 dias)
 * saem daqui.
 */
export const reviewPrompts = pgTable(
  'review_prompts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    sourceType: reviewPromptSource().notNull(),
    /** `bookings.id` ou `class_sessions.id`. */
    sourceId: uuid().notNull(),
    sentAt: tstz().notNull(),
    /**
     * A pessoa avaliou o espaço até 7 dias depois do pedido (o `created_at` da avaliação). Fica
     * mesmo se ela excluir a avaliação depois: o pedido respondido nunca conta como ignorado.
     */
    answeredAt: tstz(),
    /** Item da central; nulo com a central desligada nas preferências. */
    notificationId: uuid().references(() => notifications.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('review_prompts_user_source_unique').on(t.userId, t.sourceType, t.sourceId),
    index('review_prompts_user_id_space_id_sent_at_idx').on(t.userId, t.spaceId, t.sentAt),
  ],
);

/**
 * A pessoa já avaliou o espaço alguma vez (RF-REVIEW-09): a gestão é avisada (`REVIEW_CREATED`)
 * só na primeira avaliação de cada (autor, espaço). Sobrevive à exclusão da avaliação, para
 * excluir e avaliar de novo não repetir o aviso. Só o `user_id`; apagada na exclusão da conta.
 */
export const reviewCreatedNotices = pgTable(
  'review_created_notices',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    ...timestamps,
  },
  (t) => [unique('review_created_notices_user_space_unique').on(t.userId, t.spaceId)],
);
