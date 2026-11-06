import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type DismissReviewReport,
  dismissReviewReportSchema,
  type ManageReview,
  type ManageReviewPage,
  type ManageReviewSummary,
  type ManageReviewSummaryQuery,
  type ManageReviewsQuery,
  type ModerateReviewInput,
  type MyReview,
  type MyReviewPage,
  type MyReviewsQuery,
  manageReviewSummaryQuerySchema,
  manageReviewsQuerySchema,
  moderateReviewSchema,
  myReviewsQuerySchema,
  type PublicReviewPage,
  type PublicReviewsQuery,
  publicReviewsQuerySchema,
  type ReplyReviewInput,
  type ReportReviewInput,
  type ReviewEligibility,
  type ReviewSummary,
  replyReviewSchema,
  reportReviewSchema,
  type SuperReviewDetail,
  type SuperReviewPage,
  type SuperReviewReportPage,
  type SuperReviewReportsQuery,
  type SuperReviewSummary,
  type SuperReviewSummaryQuery,
  type SuperReviewsQuery,
  superReviewReportsQuerySchema,
  superReviewSummaryQuerySchema,
  superReviewsQuerySchema,
  type UpsertReview,
  type UpsertReviewQuery,
  upsertReviewQuerySchema,
  upsertReviewSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, Public, SpacePermission, SuperOnly } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { optionalBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { ManageReviewsService } from './manage-reviews.service.js';
import { reviewNotFound, reviewReportNotFound, spaceNotFound } from './reviews.errors.js';
import { reviewSchemas as schemas } from './reviews.openapi.js';
import { ReviewsService } from './reviews.service.js';
import { SuperReviewsService } from './super-reviews.service.js';

const spaceIdParam = () => Param('spaceId', new UuidParamPipe(spaceNotFound));
const reviewIdParam = () => Param('reviewId', new UuidParamPipe(reviewNotFound));

const NOT_FOUND_SPACE = {
  description: '`SPACE_NOT_FOUND`: espaço inexistente ou fora da vitrine (RN-REVIEW-07).',
  type: ErrorResponseDto,
};
const INVALID_CURSOR = { description: '`INVALID_CURSOR`.', type: ErrorResponseDto };

/**
 * Avaliações do espaço vistas pelo público e pelo jogador (RF-REVIEW-01 a 04 e 08). As rotas
 * públicas seguem a visibilidade da página do espaço (RN-REVIEW-07).
 */
@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get('spaces/:spaceId/reviews/summary')
  @Public()
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'getSpaceReviewSummary',
    summary: 'Resumo das avaliações do espaço (RF-REVIEW-03)',
    description:
      'Total, média com uma casa (nula com menos de 5 avaliações: selo "Novo", RN-REVIEW-03), distribuição de 5 a 1, os 3 chips mais citados e as 3 avaliações mais recentes com comentário visível. Avaliações de autores bloqueados ficam de fora.',
  })
  @ApiZodResponse(schemas.summary)
  @ApiNotFoundResponse(NOT_FOUND_SPACE)
  summary(@spaceIdParam() spaceId: string): Promise<ReviewSummary> {
    return this.service.summary(spaceId);
  }

  @Get('spaces/:spaceId/reviews/eligibility')
  @ApiAuth()
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'getReviewEligibility',
    summary: 'Posso avaliar este espaço? (RN-REVIEW-01)',
    description:
      'Para o botão "Avaliar"/"Editar minha avaliação" e o card da reserva ou aula passada, com a mesma regra do `PUT`. `canReview`: pode criar (sem avaliação, fora da equipe ativa e com uma reserva terminada, como organizador ou participante que aceitou, sem cancelamento nem no-show, ou presença numa aula terminada, nos últimos 6 meses). `canEdit`: tem avaliação (`myReview`) e pode editá-la, a qualquer momento, salvo se for da equipe ativa do espaço (decisão 99). Os dois falsos = só leitura, com `reason` (`REVIEW_NOT_ALLOWED` ou `REVIEW_NOT_ELIGIBLE`). O autor sempre pode excluir.',
  })
  @ApiZodResponse(schemas.eligibility)
  @ApiNotFoundResponse(NOT_FOUND_SPACE)
  eligibility(
    @CurrentUser() user: AuthUser,
    @spaceIdParam() spaceId: string,
  ): Promise<ReviewEligibility> {
    return this.service.eligibility(user.id, spaceId);
  }

  @Put('spaces/:spaceId/reviews/me')
  @ApiAuth()
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'upsertMyReview',
    summary: 'Avaliar o espaço ou editar a minha avaliação (RF-REVIEW-01)',
    description:
      'Uma avaliação por pessoa e espaço: a segunda chamada substitui a primeira (nota, chips e comentário), salvo com `createOnly=true` (409 `REVIEW_ALREADY_EXISTS`, para o card de um toque). Chips positivos só com nota 4–5 e negativos só com 1–3 (400 `REVIEW_TAGS_MISMATCH`). A regra é a de `GET .../reviews/eligibility` (RN-REVIEW-01): equipe ativa não cria nem edita → 403 `REVIEW_NOT_ALLOWED`; criar exige uso nos últimos 6 meses → 403 `REVIEW_NOT_ELIGIBLE`; editar, não; espaço fora da vitrine → 404 `SPACE_NOT_FOUND`. O comentário oculto pela moderação continua oculto depois da edição (RN-REVIEW-04). A avaliação nova avisa Dono e Admin (`REVIEW_CREATED`).',
  })
  @ApiZodQuery(upsertReviewQuerySchema)
  @ApiZodBody(schemas.upsert)
  @ApiZodResponse(schemas.myReview)
  @ApiBadRequestResponse({
    description: '`VALIDATION_ERROR`, `REVIEW_TAGS_MISMATCH`.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: '`REVIEW_NOT_ALLOWED`, `REVIEW_NOT_ELIGIBLE`.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse(NOT_FOUND_SPACE)
  @ApiConflictResponse({ description: '`REVIEW_ALREADY_EXISTS`.', type: ErrorResponseDto })
  upsert(
    @CurrentUser() user: AuthUser,
    @spaceIdParam() spaceId: string,
    @Query(new ZodValidationPipe(upsertReviewQuerySchema)) query: UpsertReviewQuery,
    @Body(new ZodValidationPipe(upsertReviewSchema)) body: UpsertReview,
  ): Promise<MyReview> {
    return this.service.upsert(user.id, spaceId, body, { createOnly: query.createOnly });
  }

  @Delete('spaces/:spaceId/reviews/me')
  @ApiAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'deleteMyReview',
    summary: 'Excluir a minha avaliação (RF-REVIEW-01)',
    description:
      'O autor exclui a qualquer momento, mesmo com o espaço fora da vitrine; a nota sai da média. `REVIEW_NOT_FOUND` se não há avaliação.',
  })
  @ApiNoContentResponse({ description: 'Avaliação excluída.' })
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  remove(@CurrentUser() user: AuthUser, @spaceIdParam() spaceId: string): Promise<void> {
    return this.service.remove(user.id, spaceId);
  }

  @Get('spaces/:spaceId/reviews')
  @Public()
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'listSpaceReviews',
    summary: 'Avaliações do espaço (RF-REVIEW-04)',
    description:
      'Mais recentes primeiro, com filtro por nota e paginação por `cursor`. Autor como "Ana S." (ou "Usuário removido"), com foto e selo, sem id de usuário. Comentário oculto pela moderação vem nulo, com `commentHidden: true`. Avaliações de autores bloqueados ficam de fora.',
  })
  @ApiZodQuery(publicReviewsQuerySchema)
  @ApiZodResponse(schemas.publicPage)
  @ApiNotFoundResponse(NOT_FOUND_SPACE)
  @ApiBadRequestResponse(INVALID_CURSOR)
  list(
    @spaceIdParam() spaceId: string,
    @Query(new ZodValidationPipe(publicReviewsQuerySchema)) query: PublicReviewsQuery,
  ): Promise<PublicReviewPage> {
    return this.service.list(spaceId, query);
  }

  @Get('me/reviews')
  @ApiAuth()
  @ApiOperation({
    operationId: 'listMyReviews',
    summary: 'Minhas avaliações (RF-REVIEW-08)',
    description:
      'Todas as avaliações da pessoa, mais recentes primeiro, com o espaço (nome, logo, bairro e cidade, como no card da vitrine) e o comentário inteiro, mesmo oculto (`commentHidden`). `canEdit` falso = só leitura (espaço fora da vitrine ou a pessoa é da equipe ativa dele); excluir é sempre permitido.',
  })
  @ApiZodQuery(myReviewsQuerySchema)
  @ApiZodResponse(schemas.myReviewPage)
  @ApiBadRequestResponse(INVALID_CURSOR)
  listMine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(myReviewsQuerySchema)) query: MyReviewsQuery,
  ): Promise<MyReviewPage> {
    return this.service.listMine(user.id, query);
  }

  @Post('reviews/:reviewId/reports')
  @ApiAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'reportReview',
    summary: 'Denunciar uma avaliação (RN-REVIEW-04)',
    description:
      'Motivo `SPAM`, `OFFENSIVE`, `FALSE_INFO`, `PERSONAL_DATA` ou `OTHER`, com texto opcional. Uma denúncia por pessoa e avaliação (409 `REVIEW_ALREADY_REPORTED`); a própria não (403 `REVIEW_REPORT_OWN`). A avaliação continua publicada até a moderação do Super.',
  })
  @ApiZodBody(schemas.report)
  @ApiNoContentResponse({ description: 'Denúncia registrada.' })
  @ApiForbiddenResponse({ description: '`REVIEW_REPORT_OWN`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`REVIEW_ALREADY_REPORTED`.', type: ErrorResponseDto })
  report(
    @CurrentUser() user: AuthUser,
    @reviewIdParam() reviewId: string,
    @Body(new ZodValidationPipe(reportReviewSchema)) body: ReportReviewInput,
  ): Promise<void> {
    return this.service.report(user.id, reviewId, body);
  }
}

/** Avaliações no painel do espaço (RF-REVIEW-06): Dono, Admin e Professor veem. */
@ApiTags('space-reviews')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId/reviews')
export class ManageReviewsController {
  constructor(private readonly service: ManageReviewsService) {}

  @Get()
  @SpacePermission('review.view')
  @ApiOperation({
    operationId: 'listManageReviews',
    summary: 'Avaliações do espaço no painel',
    description:
      'As mesmas da lista pública (comentário oculto vem nulo), mais recentes primeiro, com filtro por nota e `unanswered=true` (sem resposta) e `reportedBySpace`.',
  })
  @ApiZodQuery(manageReviewsQuerySchema)
  @ApiZodResponse(schemas.managePage)
  @ApiBadRequestResponse(INVALID_CURSOR)
  list(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(manageReviewsQuerySchema)) query: ManageReviewsQuery,
  ): Promise<ManageReviewPage> {
    return this.service.list(spaceId, query);
  }

  @Get('summary')
  @SpacePermission('review.view')
  @ApiOperation({
    operationId: 'getManageReviewSummary',
    summary: 'Resumo das avaliações com a tendência de 90 dias',
    description:
      'Média (mesmo abaixo de 5; `publicSummaryVisible` diz se o público já a vê), total, sem resposta, distribuição, `highlights` (até 5 elogios e até 5 críticas mais citados, com a contagem) e a tendência dos últimos 90 dias por dia ou semana, no fuso do espaço, com o total (`trend.count`) e a média (`trend.average`, da soma e da contagem no banco) do período.',
  })
  @ApiZodQuery(manageReviewSummaryQuerySchema)
  @ApiZodResponse(schemas.manageSummary)
  summary(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(manageReviewSummaryQuerySchema)) query: ManageReviewSummaryQuery,
  ): Promise<ManageReviewSummary> {
    return this.service.summary(spaceId, query.trend);
  }

  @Put(':reviewId/reply')
  @SpacePermission('review.reply')
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'replyToReview',
    summary: 'Responder em público ou editar a resposta (RN-REVIEW-05)',
    description:
      'Dono e Admin (e o Super em modo suporte). Uma resposta por avaliação, até 500 caracteres; a primeira avisa o autor (`REVIEW_REPLIED`). Auditado (`review.reply`).',
  })
  @ApiZodBody(schemas.reply)
  @ApiZodResponse(schemas.manageReview)
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  reply(
    @CurrentUser() user: AuthUser,
    @Param('spaceId') spaceId: string,
    @reviewIdParam() reviewId: string,
    @Body(new ZodValidationPipe(replyReviewSchema)) body: ReplyReviewInput,
  ): Promise<ManageReview> {
    return this.service.reply(user.id, spaceId, reviewId, body);
  }

  @Delete(':reviewId/reply')
  @SpacePermission('review.reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'deleteReviewReply',
    summary: 'Remover a resposta (RN-REVIEW-05)',
    description: 'Auditado (`review.reply_delete`). A avaliação não muda.',
  })
  @ApiNoContentResponse({ description: 'Resposta removida.' })
  @ApiNotFoundResponse({
    description: '`REVIEW_NOT_FOUND`, `REVIEW_REPLY_NOT_FOUND`.',
    type: ErrorResponseDto,
  })
  deleteReply(
    @CurrentUser() user: AuthUser,
    @Param('spaceId') spaceId: string,
    @reviewIdParam() reviewId: string,
  ): Promise<void> {
    return this.service.deleteReply(user.id, spaceId, reviewId);
  }

  @Post(':reviewId/reports')
  @SpacePermission('review.reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'reportReviewAsSpace',
    summary: 'Denunciar uma avaliação pela gestão (decisão 103)',
    description:
      'Dono e Admin. Fica marcada com o espaço para o Super; uma por pessoa e avaliação (409 `REVIEW_ALREADY_REPORTED`). O espaço não apaga nem altera a avaliação. Auditado (`review.report`).',
  })
  @ApiZodBody(schemas.report)
  @ApiNoContentResponse({ description: 'Denúncia registrada.' })
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`REVIEW_ALREADY_REPORTED`.', type: ErrorResponseDto })
  report(
    @CurrentUser() user: AuthUser,
    @Param('spaceId') spaceId: string,
    @reviewIdParam() reviewId: string,
    @Body(new ZodValidationPipe(reportReviewSchema)) body: ReportReviewInput,
  ): Promise<void> {
    return this.service.report(user.id, spaceId, reviewId, body);
  }
}

/** Moderação das avaliações (RF-REVIEW-07, RN-REVIEW-04). */
@ApiTags('super-reviews')
@ApiAuth()
@SuperOnly()
@Controller('super/reviews')
export class SuperReviewsController {
  constructor(private readonly service: SuperReviewsService) {}

  // `reports` antes de `:reviewId`: as rotas são registradas na ordem da classe.
  @Get('reports')
  @ApiOperation({
    operationId: 'superListReviewReports',
    summary: 'Fila de denúncias de avaliações',
    description:
      'Com a avaliação denunciada (comentário inteiro e autor). `status=OPEN`: da mais antiga para a mais nova; sem filtro ou com os demais status, mais recentes primeiro. Paginação por `cursor`.',
  })
  @ApiZodQuery(superReviewReportsQuerySchema)
  @ApiZodResponse(schemas.superReportPage)
  @ApiBadRequestResponse(INVALID_CURSOR)
  reports(
    @Query(new ZodValidationPipe(superReviewReportsQuerySchema)) query: SuperReviewReportsQuery,
  ): Promise<SuperReviewReportPage> {
    return this.service.reports(query);
  }

  @Post('reports/:reportId/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('reportId')
  @ApiOperation({
    operationId: 'superDismissReviewReport',
    summary: 'Descartar a denúncia',
    description:
      'Só denúncia `OPEN` (409 `REVIEW_REPORT_RESOLVED`). Corpo opcional `{ reason }` (até 500 caracteres), gravado na denúncia (`resolutionReason`) e na auditoria. A avaliação não muda. Auditado (`review.report_dismiss`). Devolve a avaliação com as denúncias e o histórico.',
  })
  @ApiZodBody(schemas.dismiss)
  @ApiZodResponse(schemas.superDetail)
  @ApiBadRequestResponse({ description: '`VALIDATION_ERROR`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`REVIEW_REPORT_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`REVIEW_REPORT_RESOLVED`.', type: ErrorResponseDto })
  dismiss(
    @CurrentUser() user: AuthUser,
    @Param('reportId', new UuidParamPipe(reviewReportNotFound)) reportId: string,
    @Body(new ZodValidationPipe(optionalBody(dismissReviewReportSchema)))
    body: DismissReviewReport,
  ): Promise<SuperReviewDetail> {
    return this.service.dismissReport(user.id, reportId, body);
  }

  // `summary` antes de `:reviewId`, pelo mesmo motivo.
  @Get('summary')
  @ApiOperation({
    operationId: 'superGetSpaceReviewSummary',
    summary: 'Resumo das avaliações de um espaço (RF-REVIEW-07)',
    description:
      'Para qualquer espaço, inclusive fora da vitrine: total e média das que contam (mesmo abaixo de 5; `publicSummaryVisible` diz se o público já a vê), `uncountedCount` (fora da média: autor bloqueado, RN-REVIEW-03), distribuição e `highlights` (até 5 elogios e até 5 críticas). `SPACE_NOT_FOUND` se o espaço não existe.',
  })
  @ApiZodQuery(superReviewSummaryQuerySchema)
  @ApiZodResponse(schemas.superSummary)
  @ApiBadRequestResponse({ description: '`VALIDATION_ERROR`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`SPACE_NOT_FOUND`.', type: ErrorResponseDto })
  summary(
    @Query(new ZodValidationPipe(superReviewSummaryQuerySchema)) query: SuperReviewSummaryQuery,
  ): Promise<SuperReviewSummary> {
    return this.service.summary(query.spaceId);
  }

  @Get()
  @ApiOperation({
    operationId: 'superListReviews',
    summary: 'Avaliações de um espaço',
    description:
      'Todas, inclusive as de autores bloqueados (`counted` falso), com o comentário inteiro, o autor real, a moderação e as denúncias abertas. Filtros: nota, `hidden`, `reported`.',
  })
  @ApiZodQuery(superReviewsQuerySchema)
  @ApiZodResponse(schemas.superPage)
  @ApiBadRequestResponse(INVALID_CURSOR)
  list(
    @Query(new ZodValidationPipe(superReviewsQuerySchema)) query: SuperReviewsQuery,
  ): Promise<SuperReviewPage> {
    return this.service.reviews(query);
  }

  @Get(':reviewId')
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'superGetReview',
    summary: 'Avaliação com as denúncias e o histórico de moderação',
  })
  @ApiZodResponse(schemas.superDetail)
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  get(@reviewIdParam() reviewId: string): Promise<SuperReviewDetail> {
    return this.service.detail(reviewId);
  }

  @Post(':reviewId/hide')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'superHideReviewComment',
    summary: 'Ocultar o comentário (RN-REVIEW-04)',
    description:
      'Com motivo. A nota continua na média; as denúncias abertas da avaliação ficam `RESOLVED`. Auditado (`review.hide`). 409 `REVIEW_NO_COMMENT` ou `REVIEW_COMMENT_HIDDEN`.',
  })
  @ApiZodBody(schemas.moderate)
  @ApiZodResponse(schemas.superDetail)
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: '`REVIEW_NO_COMMENT`, `REVIEW_COMMENT_HIDDEN`.',
    type: ErrorResponseDto,
  })
  hide(
    @CurrentUser() user: AuthUser,
    @reviewIdParam() reviewId: string,
    @Body(new ZodValidationPipe(moderateReviewSchema)) body: ModerateReviewInput,
  ): Promise<SuperReviewDetail> {
    return this.service.hide(user.id, reviewId, body);
  }

  @Post(':reviewId/unhide')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('reviewId')
  @ApiOperation({
    operationId: 'superUnhideReviewComment',
    summary: 'Reexibir o comentário (RN-REVIEW-04)',
    description: 'Com motivo. Auditado (`review.unhide`). 409 `REVIEW_COMMENT_NOT_HIDDEN`.',
  })
  @ApiZodBody(schemas.moderate)
  @ApiZodResponse(schemas.superDetail)
  @ApiNotFoundResponse({ description: '`REVIEW_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`REVIEW_COMMENT_NOT_HIDDEN`.', type: ErrorResponseDto })
  unhide(
    @CurrentUser() user: AuthUser,
    @reviewIdParam() reviewId: string,
    @Body(new ZodValidationPipe(moderateReviewSchema)) body: ModerateReviewInput,
  ): Promise<SuperReviewDetail> {
    return this.service.unhide(user.id, reviewId, body);
  }
}
