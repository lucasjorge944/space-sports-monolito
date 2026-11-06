import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPACE_PERMISSIONS, type SpaceRole } from '@space-sports/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { reviewPrompts, spaceMembers, spaceReviews, spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notificações das avaliações (RF-REVIEW-02, RF-REVIEW-09): o pedido ao jogador, a avaliação
 * nova para Dono e Admin ativos do espaço e a resposta do espaço para o autor. Lê o que precisa
 * do banco; o módulo de avaliações só publica os eventos. **Sem texto escrito por usuário** no
 * título ou no corpo (nem comentário, nem resposta, nem nome do autor): a notificação fica
 * gravada e escaparia da moderação e da anonimização. Só a nota e o nome do espaço.
 */
@Injectable()
export class ReviewNotifier {
  private readonly logger = new Logger(ReviewNotifier.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Pedido de avaliação (RN-REVIEW-02), já gravado em `review_prompts`. Os dados abrem a tela de
   * avaliar do espaço no app. Guarda o id do item da central no pedido.
   */
  async request(promptId: string): Promise<void> {
    const [row] = await this.db
      .select({
        userId: reviewPrompts.userId,
        spaceId: reviewPrompts.spaceId,
        source: reviewPrompts.sourceType,
        sourceId: reviewPrompts.sourceId,
        slug: spaces.slug,
        spaceName: spaces.name,
      })
      .from(reviewPrompts)
      .innerJoin(spaces, eq(spaces.id, reviewPrompts.spaceId))
      .where(eq(reviewPrompts.id, promptId));
    if (!row) return;
    const notificationId = await this.notifications.notify({
      userId: row.userId,
      type: 'REVIEW_REQUEST',
      title: `Como foi no ${row.spaceName}?`,
      body: 'Dê sua nota em poucos segundos.',
      data: {
        spaceId: row.spaceId,
        slug: row.slug,
        source: row.source,
        sourceId: row.sourceId,
        promptId,
      },
    });
    if (notificationId) {
      await this.db
        .update(reviewPrompts)
        .set({ notificationId })
        .where(eq(reviewPrompts.id, promptId));
    }
  }

  /** Avaliação nova: Dono e Admin ativos do espaço (`REVIEW_CREATED`). */
  async created(reviewId: string): Promise<void> {
    const review = await this.load(reviewId);
    if (!review) return;
    const roles = SPACE_PERMISSIONS['review.reply'] as readonly SpaceRole[];
    const staff = await this.db
      .selectDistinct({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, review.spaceId),
          eq(spaceMembers.status, 'ACTIVE'),
          inArray(spaceMembers.role, [...roles]),
          isNotNull(spaceMembers.userId),
        ),
      );
    for (const { userId } of staff) {
      if (!userId || userId === review.userId) continue;
      await this.send({
        userId,
        type: 'REVIEW_CREATED',
        title: `Nova avaliação: ★ ${review.rating}`,
        body: `O ${review.spaceName} recebeu uma avaliação. Toque para ver e responder.`,
        data: { spaceId: review.spaceId, reviewId },
      });
    }
  }

  /** Primeira resposta do espaço: o autor (`REVIEW_REPLIED`). */
  async replied(reviewId: string): Promise<void> {
    const review = await this.load(reviewId);
    if (!review?.userId || !review.hasReply) return;
    await this.send({
      userId: review.userId,
      type: 'REVIEW_REPLIED',
      title: 'Resposta à sua avaliação',
      body: `O ${review.spaceName} respondeu sua avaliação. Toque para ver a resposta.`,
      data: { spaceId: review.spaceId, slug: review.slug, reviewId },
    });
  }

  private async load(reviewId: string) {
    const [row] = await this.db
      .select({
        spaceId: spaceReviews.spaceId,
        userId: spaceReviews.userId,
        rating: spaceReviews.rating,
        hasReply: sql<boolean>`${spaceReviews.reply} IS NOT NULL`,
        spaceName: spaces.name,
        slug: spaces.slug,
      })
      .from(spaceReviews)
      .innerJoin(spaces, eq(spaces.id, spaceReviews.spaceId))
      .where(eq(spaceReviews.id, reviewId));
    return row;
  }

  private async send(input: Parameters<NotificationsService['notify']>[0]): Promise<void> {
    try {
      await this.notifications.notify(input);
    } catch (err) {
      this.logger.error({ err, userId: input.userId }, 'Falha ao notificar destinatário');
    }
  }
}
