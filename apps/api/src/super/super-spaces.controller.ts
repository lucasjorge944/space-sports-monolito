import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateSuperSpace,
  createSuperSpaceSchema,
  type InviteOwner,
  inviteOwnerSchema,
  type ManagedSpace,
  type OwnerInviteResult,
  type ReplaceAmenities,
  type ReplaceOpeningHours,
  type SpaceSettings,
  type SpaceStatusChange,
  type StartSupportSession,
  type SuperSpace,
  type SuperSpacesQuery,
  type SupportSession,
  spaceStatusChangeSchema,
  startSupportSessionSchema,
  superSpacesQuerySchema,
  type UpdateSpaceSettings,
  type UpdateSuperSpace,
  updateSuperSpaceSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { optionalBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { spaceNotFound } from '../spaces/spaces.errors.js';
import { superSchemas as schemas } from './super.openapi.js';
import { SuperSpacesService } from './super-spaces.service.js';
import { SupportService } from './support.service.js';

const spaceId = () => Param('spaceId', new UuidParamPipe(spaceNotFound));

/** Gestão de espaços pela plataforma (RF-SUPER-01..04; RN-AUTH-02). */
@ApiTags('super-spaces')
@ApiAuth()
@SuperOnly()
@Controller('super/spaces')
export class SuperSpacesController {
  constructor(
    private readonly service: SuperSpacesService,
    private readonly support: SupportService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'superListSpaces',
    summary: 'Listar, buscar e filtrar espaços (RF-SUPER-01)',
    description:
      'Filtros: `q` (nome ou slug), `status`, `cityId` e `sports` (slugs separados por vírgula). Inclui espaços suspensos e encerrados. Paginação por `page`/`pageSize`.',
  })
  @ApiZodQuery(superSpacesQuerySchema)
  @ApiZodResponse(schemas.spaceList)
  list(@Query(new ZodValidationPipe(superSpacesQuerySchema)) query: SuperSpacesQuery) {
    return this.service.list(query);
  }

  @Post()
  @ApiOperation({
    operationId: 'superCreateSpace',
    summary: 'Criar espaço já ativo e convidar o Dono (RF-SUPER-02, RN-SPACE-01)',
    description:
      'O espaço nasce `ACTIVE`. Sem `slug`, é gerado a partir do nome. Com `ownerEmail`, convida o Dono (`ownerInvite.status`: `LINKED` = conta existente virou Dono; `AWAITING_SIGNUP` = ainda sem conta; `AWAITING_VERIFICATION` = conta com e-mail ainda não verificado, nada é vinculado; repita o convite depois). Erros: `CITY_NOT_FOUND` (422), `SLUG_TAKEN` (409), `ADDRESS_NOT_FOUND` (422), `GEOCODING_UNAVAILABLE` (503).',
  })
  @ApiZodBody(schemas.createSpace)
  @ApiZodResponse(schemas.createdSpace, HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSuperSpaceSchema)) body: CreateSuperSpace,
  ) {
    return this.service.create(user.id, body);
  }

  @Get(':spaceId')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superGetSpace',
    summary: 'Espaço com o checklist de implantação (RF-SUPER-02)',
    description:
      'Checklist calculado: dados (descrição, endereço, localização, contato, horário), fotos, quadras (ativa com esporte), preço/hora e equipe (Dono ativo). `rating`: total e média das avaliações que contam, como no card da vitrine (média nula com menos de 5); o resumo completo é `superGetSpaceReviewSummary`.',
  })
  @ApiZodResponse(schemas.space)
  async get(@spaceId() id: string): Promise<SuperSpace> {
    return this.service.get(id);
  }

  @Patch(':spaceId')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superUpdateSpace',
    summary: 'Editar nome, slug e dados do espaço (RF-SUPER-04)',
    description:
      'Funciona em qualquer status do espaço. Mesmas regras de endereço do painel (geocodificação). Erros: `SLUG_TAKEN` (409), `CITY_NOT_FOUND` (422).',
  })
  @ApiZodBody(schemas.updateSpace)
  @ApiZodResponse(schemas.space)
  update(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(updateSuperSpaceSchema)) body: UpdateSuperSpace,
  ): Promise<SuperSpace> {
    return this.service.update(user.id, id, body);
  }

  @Post(':spaceId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superSuspendSpace',
    summary: 'Suspender o espaço (RF-SUPER-03)',
    description:
      'Só a partir de `ACTIVE`. O espaço some da vitrine e o painel dele fica em modo leitura (`SPACE_READ_ONLY`). Erro: `INVALID_STATUS_TRANSITION` (409).',
  })
  @ApiZodBody(schemas.statusChange)
  @ApiZodResponse(schemas.space)
  suspend(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(optionalBody(spaceStatusChangeSchema))) body: SpaceStatusChange,
  ) {
    return this.service.changeStatus(user.id, id, 'suspend', body.reason);
  }

  @Post(':spaceId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superReactivateSpace',
    summary: 'Reativar o espaço (RF-SUPER-03)',
    description:
      'A partir de `SUSPENDED` ou `CLOSED`. Erro: `INVALID_STATUS_TRANSITION` (409) se já está `ACTIVE`.',
  })
  @ApiZodBody(schemas.statusChange)
  @ApiZodResponse(schemas.space)
  reactivate(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(optionalBody(spaceStatusChangeSchema))) body: SpaceStatusChange,
  ) {
    return this.service.changeStatus(user.id, id, 'reactivate', body.reason);
  }

  @Post(':spaceId/close')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superCloseSpace',
    summary: 'Encerrar o espaço (RF-SUPER-03)',
    description:
      'A partir de `ACTIVE` ou `SUSPENDED`. Fica sem vitrine e em modo leitura; só o Super reativa.',
  })
  @ApiZodBody(schemas.statusChange)
  @ApiZodResponse(schemas.space)
  close(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(optionalBody(spaceStatusChangeSchema))) body: SpaceStatusChange,
  ) {
    return this.service.changeStatus(user.id, id, 'close', body.reason);
  }

  @Post(':spaceId/owner-invites')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superInviteOwner',
    summary: 'Convidar o Dono do espaço (RF-SUPER-02)',
    description:
      '`LINKED`: a conta já existia, com e-mail verificado, e virou Dono; `AWAITING_SIGNUP`: não há conta com o e-mail (repita depois do cadastro); `AWAITING_VERIFICATION`: há conta, mas o e-mail não foi verificado, então nada é vinculado (repita depois da verificação). A tarefa de equipe (1.4) troca isto por convite com token (`INVITED`).',
  })
  @ApiZodBody(schemas.inviteOwner)
  @ApiZodResponse(schemas.ownerInvite, HttpStatus.CREATED)
  inviteOwner(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(inviteOwnerSchema)) body: InviteOwner,
  ): Promise<OwnerInviteResult> {
    return this.service.inviteOwner(user.id, id, body.email);
  }

  @Put(':spaceId/amenities')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superReplaceSpaceAmenities',
    summary: 'Substituir a infraestrutura do espaço (RF-SUPER-04)',
  })
  @ApiZodBody(schemas.replaceAmenities)
  @ApiZodResponse(schemas.managedSpace)
  replaceAmenities(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(schemas.replaceAmenities)) body: ReplaceAmenities,
  ): Promise<ManagedSpace> {
    return this.service.replaceAmenities(user.id, id, body);
  }

  @Put(':spaceId/opening-hours')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superReplaceSpaceOpeningHours',
    summary: 'Substituir o horário de funcionamento (RF-SUPER-04)',
  })
  @ApiZodBody(schemas.replaceOpeningHours)
  @ApiZodResponse(schemas.managedSpace)
  replaceOpeningHours(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(schemas.replaceOpeningHours)) body: ReplaceOpeningHours,
  ): Promise<ManagedSpace> {
    return this.service.replaceOpeningHours(user.id, id, body);
  }

  @Get(':spaceId/settings')
  @ApiUuidParam('spaceId')
  @ApiOperation({ operationId: 'superGetSpaceSettings', summary: 'Configurações do espaço' })
  @ApiZodResponse(schemas.settings)
  getSettings(@spaceId() id: string): Promise<SpaceSettings> {
    return this.service.getSettings(id);
  }

  @Patch(':spaceId/settings')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superUpdateSpaceSettings',
    summary: 'Editar as configurações do espaço (RF-SUPER-04)',
  })
  @ApiZodBody(schemas.updateSettings)
  @ApiZodResponse(schemas.settings)
  updateSettings(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(schemas.updateSettings)) body: UpdateSpaceSettings,
  ): Promise<SpaceSettings> {
    return this.service.updateSettings(user.id, id, body);
  }

  @Post(':spaceId/support-sessions')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superStartSupportSession',
    summary: 'Abrir o modo suporte no espaço (RF-SUPER-04, RN-SUPER-01)',
    description:
      'Registra o início (com o motivo) e devolve a sessão. Para agir como Dono nas rotas `/v1/manage/spaces/:spaceId/...` deste espaço, envie o header `X-Support-Session: <id>`; toda requisição assim é auditada e as respostas trazem `X-Support-Mode: true`. Vale 2 h ou até `POST /v1/super/support-sessions/:id/end`. Cada Super tem uma sessão ativa por vez.',
  })
  @ApiZodBody(schemas.startSupport)
  @ApiZodResponse(schemas.supportSession, HttpStatus.CREATED)
  startSupport(
    @CurrentUser() user: AuthUser,
    @spaceId() id: string,
    @Body(new ZodValidationPipe(startSupportSessionSchema)) body: StartSupportSession,
  ): Promise<SupportSession> {
    return this.support.start(user.id, id, body);
  }
}
