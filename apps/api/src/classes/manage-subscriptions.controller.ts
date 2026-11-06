import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type AddEnrollmentInput,
  type ApproveSubscriptionInput,
  addEnrollmentSchema,
  approveSubscriptionSchema,
  type DelinquentsResponse,
  type SpaceSubscriptionChargePage,
  type StaffSubscriptionCharge,
  type StaffSubscriptionDetail,
  type SubscriptionChargesQuery,
  type SubscriptionPage,
  type SubscriptionReasonInput,
  type SubscriptionsQuery,
  type SwapClassGroupInput,
  subscriptionChargesQuerySchema,
  subscriptionReasonSchema,
  subscriptionsQuerySchema,
  swapClassGroupSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { optionalBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { SubscriptionChargesService } from './subscription-charges.service.js';
import {
  enrollmentNotFound,
  subscriptionChargeNotFound,
  subscriptionNotFound,
} from './subscriptions.errors.js';
import { subscriptionSchemas as schemas } from './subscriptions.openapi.js';
import { SubscriptionsService } from './subscriptions.service.js';

const idPipe = new UuidParamPipe(subscriptionNotFound);
const chargeIdPipe = new UuidParamPipe(subscriptionChargeNotFound);
const enrollmentIdPipe = new UuidParamPipe(enrollmentNotFound);

const error = (decorator: typeof ApiConflictResponse, description: string) =>
  decorator({ description, type: ErrorResponseDto });

const notFound = error(ApiNotFoundResponse, '`SUBSCRIPTION_NOT_FOUND`.');
const invalidStatus = error(ApiConflictResponse, '`INVALID_SUBSCRIPTION_STATUS`.');
const groupInvalid = error(
  ApiUnprocessableEntityResponse,
  '`CLASS_GROUP_COUNT_MISMATCH`, `CLASS_GROUP_NOT_ELIGIBLE`, `CLASS_GROUPS_OVERLAP`.',
);

/**
 * Assinaturas e mensalidades no painel do espaço (RF-CLASS-05, RF-CLASS-11; matriz de docs/02):
 * matricular, aprovar, trocar de turma e desmatricular é de Dono e Admin (`enrollment.manage`),
 * assim como a lista de mensalidades e inadimplentes (`payment.record`) e a dispensa de
 * mensalidade (`charge.waive`). O pagamento e o estorno usam `POST …/payments` com
 * `payableType: SUBSCRIPTION_CHARGE`. Espaço suspenso: só leitura (guard).
 */
@ApiTags('subscriptions')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId')
export class ManageSubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly charges: SubscriptionChargesService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Assinaturas

  @Get('subscriptions')
  @SpacePermission('enrollment.manage')
  @ApiOperation({
    operationId: 'listSpaceSubscriptions',
    summary: 'Assinaturas do espaço (pedidos, ativas, em atraso…)',
    description:
      'Mais recentes primeiro. `classGroupId`: com matrícula pendente ou ativa na turma.',
  })
  @ApiZodQuery(subscriptionsQuerySchema)
  @ApiZodResponse(schemas.page)
  list(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(subscriptionsQuerySchema)) query: SubscriptionsQuery,
  ): Promise<SubscriptionPage> {
    return this.subscriptions.listForSpace(spaceId, query);
  }

  @Get('subscriptions/:subscriptionId')
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({ operationId: 'getSpaceSubscription', summary: 'Detalhe com as mensalidades' })
  @ApiZodResponse(schemas.staffDetail)
  @notFound
  get(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.getForSpace(spaceId, id);
  }

  @Post('subscriptions/:subscriptionId/approve')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'approveSubscription',
    summary: 'Aprovar o pedido (RF-CLASS-05)',
    description:
      'As matrículas viram `ACTIVE` a partir de hoje, conferindo a vaga de cada turma sob trava (RN-CLASS-02). `classGroupIds` substitui as turmas pedidas. Gera a mensalidade do mês se a aprovação é até o vencimento (sem pró-rata; depois do vencimento, a cobrança começa no mês seguinte). Avisa o aluno.',
  })
  @ApiZodBody(schemas.approve)
  @ApiZodResponse(schemas.staffDetail)
  @notFound
  @error(
    ApiConflictResponse,
    '`INVALID_SUBSCRIPTION_STATUS`, `CLASS_GROUP_FULL`, `CLASS_SCHEDULE_OVERLAP` (a turma coincide no horário com outra turma do aluno em outra assinatura em aberto, de qualquer espaço; `details.conflict`).',
  )
  @groupInvalid
  approve(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(optionalBody(approveSubscriptionSchema)))
    body: ApproveSubscriptionInput,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.approve(spaceId, user.id, id, body);
  }

  @Post('subscriptions/:subscriptionId/reject')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'rejectSubscription',
    summary: 'Recusar o pedido',
    description: 'Fica `CANCELLED` com `rejected: true` e o motivo. Avisa o aluno.',
  })
  @ApiZodBody(schemas.reason)
  @ApiZodResponse(schemas.staffDetail)
  @notFound
  @invalidStatus
  reject(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(optionalBody(subscriptionReasonSchema)))
    body: SubscriptionReasonInput,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.reject(spaceId, user.id, id, body);
  }

  @Post('subscriptions/:subscriptionId/cancel')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'cancelSpaceSubscription',
    summary: 'Cancelar a assinatura (RN-CLASS-08)',
    description:
      'Decisão 45, as mesmas regras do aluno. Em curso: o acesso vai até o fim do último mês com mensalidade paga ou dispensada, corrente ou futuro (`endsOn` = `accessUntil`); nada é gerado depois dessa data, o aluno sai das aulas posteriores a ela, com promoção da espera, e as matrículas acabam nesse dia. Sem esse mês, o acesso termina no ato: a mensalidade corrente não vencida é dispensada e a vencida segue devida. Pedido pendente: cancelado na hora. Avisa o aluno.',
  })
  @ApiZodBody(schemas.reason)
  @ApiZodResponse(schemas.staffDetail)
  @notFound
  @invalidStatus
  cancel(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(optionalBody(subscriptionReasonSchema)))
    body: SubscriptionReasonInput,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.cancelForSpace(spaceId, user.id, id, body);
  }

  @Post('subscriptions/:subscriptionId/resume-cancel')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'resumeSpaceSubscriptionCancel',
    summary: 'Desfazer o cancelamento (RN-CLASS-08)',
    description:
      'Enquanto `endsOn` não passou, a assinatura volta ao ciclo normal e o aluno é avisado. As aulas de que ele saiu ao cancelar não voltam.',
  })
  @ApiZodResponse(schemas.staffDetail)
  @notFound
  @invalidStatus
  resumeCancel(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.resumeCancelForSpace(spaceId, user.id, id);
  }

  @Post('subscriptions/:subscriptionId/swap-class-group')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'swapSpaceSubscriptionClassGroup',
    summary: 'Trocar o aluno de turma (RF-CLASS-05)',
  })
  @ApiZodBody(schemas.swap)
  @ApiZodResponse(schemas.staffDetail)
  @error(ApiNotFoundResponse, '`SUBSCRIPTION_NOT_FOUND`, `ENROLLMENT_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`INVALID_SUBSCRIPTION_STATUS`, `CLASS_GROUP_FULL`, `ALREADY_ENROLLED`, `CLASS_SCHEDULE_OVERLAP` (a turma coincide no horário com outra turma do aluno em outra assinatura em aberto, de qualquer espaço; `details.conflict`).',
  )
  @error(ApiUnprocessableEntityResponse, '`CLASS_GROUP_NOT_ELIGIBLE`, `CLASS_GROUPS_OVERLAP`.')
  swap(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(swapClassGroupSchema)) body: SwapClassGroupInput,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.swapForSpace(spaceId, user.id, id, body);
  }

  @Post('subscriptions/:subscriptionId/enrollments')
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'addSubscriptionEnrollment',
    summary: 'Matricular em mais uma turma',
    description:
      'Plano ilimitado: quantas turmas o espaço quiser; Nx/semana: até N matrículas ativas (RN-CLASS-01). Confere a vaga (RN-CLASS-02).',
  })
  @ApiZodBody(schemas.addEnrollment)
  @ApiZodResponse(schemas.staffDetail, HttpStatus.CREATED)
  @notFound
  @error(
    ApiConflictResponse,
    '`INVALID_SUBSCRIPTION_STATUS`, `PLAN_FREQUENCY_REACHED`, `ALREADY_ENROLLED`, `CLASS_GROUP_FULL`, `CLASS_SCHEDULE_OVERLAP` (a turma coincide no horário com outra turma do aluno em outra assinatura em aberto, de qualquer espaço; `details.conflict`).',
  )
  @error(ApiUnprocessableEntityResponse, '`CLASS_GROUP_NOT_ELIGIBLE`, `CLASS_GROUPS_OVERLAP`.')
  addEnrollment(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addEnrollmentSchema)) body: AddEnrollmentInput,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.addEnrollment(spaceId, user.id, id, body);
  }

  @Delete('subscriptions/:subscriptionId/enrollments/:enrollmentId')
  @SpacePermission('enrollment.manage')
  @ApiUuidParam('subscriptionId')
  @ApiUuidParam('enrollmentId')
  @ApiOperation({
    operationId: 'endSubscriptionEnrollment',
    summary: 'Desmatricular da turma',
    description:
      'Encerra hoje a matrícula ativa e libera a vaga; a assinatura e as mensalidades continuam (para encerrar tudo, cancele a assinatura).',
  })
  @ApiZodResponse(schemas.staffDetail)
  @error(ApiNotFoundResponse, '`SUBSCRIPTION_NOT_FOUND`, `ENROLLMENT_NOT_FOUND`.')
  endEnrollment(
    @Param('spaceId') spaceId: string,
    @Param('subscriptionId', idPipe) id: string,
    @Param('enrollmentId', enrollmentIdPipe) enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StaffSubscriptionDetail> {
    return this.subscriptions.endEnrollment(spaceId, user.id, id, enrollmentId);
  }

  // -------------------------------------------------------------------------------------------
  // Mensalidades

  @Get('subscription-charges')
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'listSubscriptionCharges',
    summary: 'Mensalidades de aula a receber, vencidas e pagas (RF-CLASS-11)',
    description:
      'Por vencimento. `overdue=true`: em aberto e vencidas (inadimplência). `totalDueCents` soma o que falta receber com os filtros. Para receber: `POST …/payments` com `payableType: SUBSCRIPTION_CHARGE`.',
  })
  @ApiZodQuery(subscriptionChargesQuerySchema)
  @ApiZodResponse(schemas.spaceCharges)
  listCharges(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(subscriptionChargesQuerySchema)) query: SubscriptionChargesQuery,
  ): Promise<SpaceSubscriptionChargePage> {
    return this.charges.listForSpace(spaceId, query);
  }

  @Get('subscription-charges/delinquents')
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'listDelinquents',
    summary: 'Inadimplentes (RF-CLASS-11)',
    description:
      'Uma linha por assinatura com mensalidade vencida em aberto, do atraso mais antigo para o mais novo.',
  })
  @ApiZodResponse(schemas.delinquents)
  delinquents(@Param('spaceId') spaceId: string): Promise<DelinquentsResponse> {
    return this.charges.delinquents(spaceId);
  }

  @Post('subscription-charges/:chargeId/waive')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('charge.waive')
  @ApiUuidParam('chargeId')
  @ApiOperation({
    operationId: 'waiveSubscriptionCharge',
    summary: 'Dispensar a mensalidade (WAIVED)',
    description:
      'Só Dono e Admin. Perdoa a mensalidade em aberto: deixa de ser cobrada, não aceita pagamento e a assinatura em atraso é reavaliada. O motivo fica em `waiveReason`. Idempotente.',
  })
  @ApiZodBody(schemas.reason)
  @ApiZodResponse(schemas.staffCharge)
  @error(ApiNotFoundResponse, '`SUBSCRIPTION_CHARGE_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`CHARGE_NOT_WAIVABLE` (paga), `CHARGE_HAS_PAYMENTS` (estorne antes).',
  )
  waive(
    @Param('spaceId') spaceId: string,
    @Param('chargeId', chargeIdPipe) chargeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(optionalBody(subscriptionReasonSchema)))
    body: SubscriptionReasonInput,
  ): Promise<StaffSubscriptionCharge> {
    return this.charges.waive(spaceId, user.id, chargeId, body);
  }
}
