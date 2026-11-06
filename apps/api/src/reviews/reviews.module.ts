import { Module } from '@nestjs/common';
import { ManageReviewsService } from './manage-reviews.service.js';
import {
  ManageReviewsController,
  ReviewsController,
  SuperReviewsController,
} from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';
import { SuperReviewsService } from './super-reviews.service.js';

/**
 * Avaliações de espaços (RF-REVIEW-01 a 09, RN-REVIEW-01 a 07; decisões 99 a 106): o jogador
 * avalia, o público lê, a gestão responde e o Super modera. As notificações (avaliação nova,
 * resposta e o job de pedidos) ficam no módulo de notificações; o bloqueio de conta e a exclusão
 * usam `review-rules`.
 */
@Module({
  controllers: [ReviewsController, ManageReviewsController, SuperReviewsController],
  providers: [ReviewsService, ManageReviewsService, SuperReviewsService],
})
export class ReviewsModule {}
