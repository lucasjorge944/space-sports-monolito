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
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type BlockUser,
  blockUserSchema,
  type CancelDeletionRequest,
  type CreateDeletionRequest,
  cancelDeletionRequestSchema,
  createDeletionRequestSchema,
  type DeletionRequest,
  type DeletionRequestsQuery,
  deletionRequestsQuerySchema,
  type PromoteSuper,
  promoteSuperSchema,
  type RejectDeletionRequest,
  type ResolveDeletionRequest,
  rejectDeletionRequestSchema,
  resolveDeletionRequestSchema,
  type SuperUser,
  type SuperUsersQuery,
  superUsersQuerySchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { optionalBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { deletionRequestNotFound, userNotFound } from './super.errors.js';
import { superSchemas as schemas } from './super.openapi.js';
import { SuperUsersService } from './users.service.js';

const userId = () => Param('userId', new UuidParamPipe(userNotFound));
const requestId = () => Param('requestId', new UuidParamPipe(deletionRequestNotFound));

/** Usuários da plataforma (RF-SUPER-07): busca, vínculos, bloqueio. */
@ApiTags('super-users')
@ApiAuth()
@SuperOnly()
@Controller('super/users')
export class SuperUsersController {
  constructor(private readonly service: SuperUsersService) {}

  @Get()
  @ApiOperation({
    operationId: 'superListUsers',
    summary: 'Buscar usuários (nome, e-mail ou telefone)',
  })
  @ApiZodQuery(superUsersQuerySchema)
  @ApiZodResponse(schemas.userList)
  list(@Query(new ZodValidationPipe(superUsersQuerySchema)) query: SuperUsersQuery) {
    return this.service.list(query);
  }

  @Get(':userId')
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'superGetUser',
    summary: 'Usuário com vínculos e papéis nos espaços',
  })
  @ApiZodResponse(schemas.user)
  get(@userId() id: string): Promise<SuperUser> {
    return this.service.get(id);
  }

  @Post(':userId/block')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'superBlockUser',
    summary: 'Bloquear a conta e encerrar todas as sessões',
    description: 'Erros: `CANNOT_ACT_ON_SELF` (409), `USER_DELETED` (409).',
  })
  @ApiZodBody(schemas.blockUser)
  @ApiZodResponse(schemas.user)
  block(
    @CurrentUser() actor: AuthUser,
    @userId() id: string,
    @Body(new ZodValidationPipe(optionalBody(blockUserSchema))) body: BlockUser,
  ): Promise<SuperUser> {
    return this.service.block(actor.id, id, body);
  }

  @Post(':userId/unblock')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'superUnblockUser',
    summary: 'Desbloquear a conta ou reativar a inativada pelo titular',
    description:
      'A conta BLOCKED ou INACTIVE volta a ACTIVE (RF-AUTH-03, RF-SUPER-07). Erro: `USER_DELETED` (409).',
  })
  @ApiZodResponse(schemas.user)
  unblock(@CurrentUser() actor: AuthUser, @userId() id: string): Promise<SuperUser> {
    return this.service.unblock(actor.id, id);
  }

  @Post(':userId/deletion-requests')
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'superCreateDeletionRequest',
    summary: 'Registrar um pedido de exclusão recebido fora do app (LGPD)',
    description: 'Erro: `DELETION_REQUEST_PENDING` (409).',
  })
  @ApiZodBody(schemas.createDeletionRequest)
  @ApiZodResponse(schemas.deletionRequest, HttpStatus.CREATED)
  createDeletionRequest(
    @CurrentUser() actor: AuthUser,
    @userId() id: string,
    @Body(new ZodValidationPipe(optionalBody(createDeletionRequestSchema)))
    body: CreateDeletionRequest,
  ): Promise<DeletionRequest> {
    return this.service.createDeletionRequest(actor.id, id, body);
  }
}

/** Pedidos de exclusão de conta (LGPD, RF-SUPER-07). */
@ApiTags('super-users')
@ApiAuth()
@SuperOnly()
@Controller('super/deletion-requests')
export class SuperDeletionRequestsController {
  constructor(private readonly service: SuperUsersService) {}

  @Get()
  @ApiOperation({
    operationId: 'superListDeletionRequests',
    summary: 'Pedidos de exclusão',
    description:
      'Decisão 40: pendentes primeiro, do mais antigo (prazo `dueAt` vencido no topo, `overdue`), depois os resolvidos do mais recente. Os pendentes trazem as pendências da conta por espaço (`pending`).',
  })
  @ApiZodQuery(deletionRequestsQuerySchema)
  @ApiZodResponse(schemas.deletionRequestList)
  list(@Query(new ZodValidationPipe(deletionRequestsQuerySchema)) query: DeletionRequestsQuery) {
    return this.service.listDeletionRequests(query);
  }

  @Post(':requestId/fulfill')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('requestId')
  @ApiOperation({
    operationId: 'superFulfillDeletionRequest',
    summary: 'Atender o pedido: cancela os compromissos futuros e anonimiza a conta',
    description:
      'RF-AUTH-03 (decisão 40): na mesma transação, encerra os mensalistas e cancela as reservas futuras do titular (liberando a quadra), encerra as assinaturas de aula, tira-o das aulas que ainda não começaram (promovendo a espera), anonimiza a conta e encerra os vínculos. Pagamentos e mensalidades já devidas ficam no espaço. A gestão dos espaços não é avisada (a exclusão é só do Super); manda o e-mail de concluído ao titular. Auditado (`super.deletion_request.fulfill`). Erros: `DELETION_REQUEST_RESOLVED` (409), `LAST_OWNER` (409: único Dono de um espaço), `LAST_SUPER` (409), `CANNOT_ACT_ON_SELF` (409).',
  })
  @ApiZodBody(schemas.resolveDeletionRequest)
  @ApiZodResponse(schemas.deletionRequest)
  fulfill(
    @CurrentUser() actor: AuthUser,
    @requestId() id: string,
    @Body(new ZodValidationPipe(optionalBody(resolveDeletionRequestSchema)))
    body: ResolveDeletionRequest,
  ): Promise<DeletionRequest> {
    return this.service.fulfillDeletionRequest(actor.id, id, body.note);
  }

  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('requestId')
  @ApiOperation({
    operationId: 'superRejectDeletionRequest',
    summary: 'Recusar o pedido, com a justificativa',
    description:
      'Decisão 40: só por fraude ou exigência legal; a conta continua inativa e o titular recebe o motivo por e-mail. Auditado (`super.deletion_request.reject`). Erro: `DELETION_REQUEST_RESOLVED` (409).',
  })
  @ApiZodBody(schemas.rejectDeletionRequest)
  @ApiZodResponse(schemas.deletionRequest)
  reject(
    @CurrentUser() actor: AuthUser,
    @requestId() id: string,
    @Body(new ZodValidationPipe(rejectDeletionRequestSchema)) body: RejectDeletionRequest,
  ): Promise<DeletionRequest> {
    return this.service.rejectDeletionRequest(actor.id, id, body.note);
  }

  @Post(':requestId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('requestId')
  @ApiOperation({
    operationId: 'superCancelDeletionRequest',
    summary: 'Cancelar o pedido (desistência do titular) e reativar a conta',
    description:
      'Decisão 40: o titular desistiu pelo atendimento. O pedido fica `CANCELLED` e a conta inativada volta a ACTIVE (bloqueada continua bloqueada). Auditado (`super.deletion_request.cancel`). Erro: `DELETION_REQUEST_RESOLVED` (409).',
  })
  @ApiZodBody(schemas.resolveDeletionRequest)
  @ApiZodResponse(schemas.deletionRequest)
  cancel(
    @CurrentUser() actor: AuthUser,
    @requestId() id: string,
    @Body(new ZodValidationPipe(optionalBody(cancelDeletionRequestSchema)))
    body: CancelDeletionRequest,
  ): Promise<DeletionRequest> {
    return this.service.cancelDeletionRequest(actor.id, id, body.note);
  }
}

/** Usuários Super: quem acessa o painel da plataforma (RF-SUPER-08). */
@ApiTags('super-users')
@ApiAuth()
@SuperOnly()
@Controller('super/admins')
export class SuperAdminsController {
  constructor(private readonly service: SuperUsersService) {}

  @Get()
  @ApiOperation({ operationId: 'superListAdmins', summary: 'Usuários Super' })
  @ApiZodResponse(schemas.adminList)
  list() {
    return this.service.listSupers();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'superPromoteAdmin',
    summary: 'Promover uma conta existente a Super, por e-mail',
    description:
      'A conta precisa existir, estar ativa e ter o e-mail verificado. Erros: `USER_NOT_FOUND` (404), `EMAIL_NOT_VERIFIED` (422), `USER_IS_BLOCKED` (409), `USER_IS_INACTIVE` (409). Idempotente.',
  })
  @ApiZodBody(schemas.promote)
  @ApiZodResponse(schemas.admin)
  promote(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(promoteSuperSchema)) body: PromoteSuper,
  ) {
    return this.service.promote(actor.id, body);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'superDemoteAdmin',
    summary: 'Remover o acesso Super de um usuário',
    description: 'Erros: `CANNOT_ACT_ON_SELF`, `NOT_SUPER`, `LAST_SUPER` (409).',
  })
  @ApiNoContentResponse()
  demote(@CurrentUser() actor: AuthUser, @userId() id: string): Promise<void> {
    return this.service.demote(actor.id, id);
  }
}
