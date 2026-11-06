import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type MySubscriptionsQuery,
  mySubscriptionsQuerySchema,
  type RequestSubscriptionInput,
  requestSubscriptionSchema,
  type Subscription,
  type SubscriptionCharge,
  type SubscriptionDetail,
  type SubscriptionReasonInput,
  type SwapClassGroupInput,
  subscriptionReasonSchema,
  swapClassGroupSchema,
  type UpdateMySubscriptionInput,
  updateMySubscriptionSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { optionalBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { SubscriptionChargesService } from './subscription-charges.service.js';
import { subscriptionNotFound } from './subscriptions.errors.js';
import { subscriptionSchemas as schemas } from './subscriptions.openapi.js';
import { SubscriptionsService } from './subscriptions.service.js';

const idPipe = new UuidParamPipe(subscriptionNotFound);

const error = (decorator: typeof ApiConflictResponse, description: string) =>
  decorator({ description, type: ErrorResponseDto });

const notFound = error(ApiNotFoundResponse, '`SUBSCRIPTION_NOT_FOUND`.');
const readOnly = error(ApiForbiddenResponse, '`SPACE_READ_ONLY` (espaço suspenso).');

/**
 * Meu plano de aulas no app (RF-CLASS-04, RF-CLASS-06): contratar escolhendo as turmas, ver as
 * turmas e as mensalidades, cancelar, desistir do cancelamento, trocar de turma e definir a forma
 * de pagamento. Só as assinaturas do usuário da sessão; escrever exige o espaço ativo.
 */
@ApiTags('subscriptions')
@ApiAuth()
@Controller('me/subscriptions')
export class MeSubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly chargesService: SubscriptionChargesService,
  ) {}

  @Post()
  @ApiOperation({
    operationId: 'requestSubscription',
    summary: 'Contratar um plano escolhendo as turmas fixas',
    description:
      'Nasce `PENDING_APPROVAL` com as turmas em matrícula `PENDING` (não ocupam vaga até a aprovação). Plano Nx/semana: exatamente N turmas do esporte do plano; ilimitado: uma ou mais (RN-CLASS-01). Preço do plano guardado na assinatura. Uma assinatura em aberto por plano.',
  })
  @ApiZodBody(schemas.request)
  @ApiZodResponse(schemas.detail, HttpStatus.CREATED)
  @error(ApiNotFoundResponse, '`PLAN_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`PLAN_INACTIVE`, `SUBSCRIPTION_ALREADY_EXISTS`, `CLASS_GROUP_FULL` (sem vaga agora), `CLASS_SCHEDULE_OVERLAP` (a turma coincide no horário com outra turma do aluno em qualquer assinatura em aberto, pedido pendente e outro espaço inclusive; `details.conflict`: nome da turma, espaço, dia, horário, duração e fuso).',
  )
  @error(
    ApiUnprocessableEntityResponse,
    '`CLASS_GROUP_COUNT_MISMATCH`, `CLASS_GROUP_NOT_ELIGIBLE`, `CLASS_GROUPS_OVERLAP`.',
  )
  @readOnly
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestSubscriptionSchema)) body: RequestSubscriptionInput,
  ): Promise<SubscriptionDetail> {
    return this.subscriptions.request(user.id, body);
  }

  @Get()
  @ApiOperation({
    operationId: 'listMySubscriptions',
    summary: 'Minhas assinaturas de aula',
    description: 'Mais recentes primeiro, com turmas, próxima mensalidade e valor em atraso.',
  })
  @ApiZodQuery(mySubscriptionsQuerySchema)
  @ApiZodResponse(schemas.list)
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(mySubscriptionsQuerySchema)) query: MySubscriptionsQuery,
  ): Promise<{ items: Subscription[] }> {
    return { items: await this.subscriptions.listMine(user.id, query) };
  }

  @Get(':subscriptionId')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'getMySubscription',
    summary: 'Detalhe da assinatura, com o histórico de mensalidades',
  })
  @ApiZodResponse(schemas.detail)
  @notFound
  get(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', idPipe) id: string,
  ): Promise<SubscriptionDetail> {
    return this.subscriptions.getMine(user.id, id);
  }

  @Get(':subscriptionId/charges')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'listMySubscriptionCharges',
    summary: 'Mensalidades da assinatura (pagas, em aberto, vencidas)',
  })
  @ApiZodResponse(schemas.charges)
  @notFound
  async charges(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', idPipe) id: string,
  ): Promise<{ items: SubscriptionCharge[] }> {
    return { items: await this.chargesService.listMine(user.id, id) };
  }

  @Patch(':subscriptionId')
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'updateMySubscription',
    summary: 'Definir a forma de pagamento preferida',
    description: 'Informativa (RF-PAY-02): o pagamento é feito no espaço.',
  })
  @ApiZodBody(schemas.updateMine)
  @ApiZodResponse(schemas.detail)
  @notFound
  @error(ApiConflictResponse, '`INVALID_SUBSCRIPTION_STATUS` (cancelada).')
  @readOnly
  update(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', idPipe) id: string,
    @Body(new ZodValidationPipe(updateMySubscriptionSchema)) body: UpdateMySubscriptionInput,
  ): Promise<SubscriptionDetail> {
    return this.subscriptions.updateMine(user.id, id, body);
  }

  @Post(':subscriptionId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'cancelMySubscription',
    summary: 'Cancelar (ou retirar o pedido pendente)',
    description:
      'RN-CLASS-08 (decisão 45). Pendente: retirado na hora. Em curso: o acesso vai até o fim do último mês com mensalidade paga ou dispensada, corrente ou futuro (`endsOn` = `accessUntil`, com `cancelAtPeriodEnd`); nada é gerado depois dessa data e o aluno sai das aulas posteriores a ela, com promoção da espera. Sem esse mês, o acesso termina no ato (`CANCELLED`, `endsOn` = hoje, matrículas encerradas): a mensalidade corrente não vencida é dispensada e a vencida segue devida. Avisa o aluno. Repetir não muda nada.',
  })
  @ApiZodBody(schemas.reason)
  @ApiZodResponse(schemas.detail)
  @notFound
  @error(ApiConflictResponse, '`INVALID_SUBSCRIPTION_STATUS` (já cancelada).')
  @readOnly
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', idPipe) id: string,
    @Body(new ZodValidationPipe(optionalBody(subscriptionReasonSchema)))
    body: SubscriptionReasonInput,
  ): Promise<SubscriptionDetail> {
    return this.subscriptions.cancelMine(user.id, id, body);
  }

  @Post(':subscriptionId/resume-cancel')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'resumeMySubscriptionCancel',
    summary: 'Desistir do cancelamento',
    description:
      'RN-CLASS-08: enquanto `endsOn` não passou, a assinatura volta ao ciclo normal. As aulas de que o aluno saiu ao cancelar não voltam: ele confirma de novo.',
  })
  @ApiZodResponse(schemas.detail)
  @notFound
  @error(
    ApiConflictResponse,
    '`INVALID_SUBSCRIPTION_STATUS` (sem cancelamento pedido, encerrada ou `endsOn` já passou).',
  )
  @readOnly
  resumeCancel(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', idPipe) id: string,
  ): Promise<SubscriptionDetail> {
    return this.subscriptions.resumeCancelMine(user.id, id);
  }

  @Post(':subscriptionId/swap-class-group')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('subscriptionId')
  @ApiOperation({
    operationId: 'swapMyClassGroup',
    summary: 'Trocar de turma',
    description:
      'Encerra hoje a matrícula da turma de origem e abre na de destino, se houver vaga (RN-CLASS-02). A turma de destino é do esporte do plano e não pode coincidir no horário com as outras da assinatura nem com turma de outra assinatura do aluno, em qualquer espaço (decisão 37). Com o cancelamento pedido, desista dele antes (RN-CLASS-08).',
  })
  @ApiZodBody(schemas.swap)
  @ApiZodResponse(schemas.detail)
  @error(ApiNotFoundResponse, '`SUBSCRIPTION_NOT_FOUND`, `ENROLLMENT_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`INVALID_SUBSCRIPTION_STATUS`, `SUBSCRIPTION_CANCEL_REQUESTED` (`details.endsOn`), `CLASS_GROUP_FULL`, `ALREADY_ENROLLED`, `CLASS_SCHEDULE_OVERLAP` (`details.conflict`: nome da turma, espaço, dia, horário, duração e fuso).',
  )
  @error(ApiUnprocessableEntityResponse, '`CLASS_GROUP_NOT_ELIGIBLE`, `CLASS_GROUPS_OVERLAP`.')
  @readOnly
  swap(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId', idPipe) id: string,
    @Body(new ZodValidationPipe(swapClassGroupSchema)) body: SwapClassGroupInput,
  ): Promise<SubscriptionDetail> {
    return this.subscriptions.swapMine(user.id, id, body);
  }
}
