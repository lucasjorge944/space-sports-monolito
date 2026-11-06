import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Court, CreateCourt, UpdateCourt } from '@space-sports/shared';
import { ApiAuth, SpacePermission } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { CourtsService } from './courts.service.js';
import { courtNotFound } from './spaces.errors.js';
import { schemas } from './spaces.openapi.js';

const courtId = () => Param('courtId', new UuidParamPipe(courtNotFound));

/** Quadras do espaço no painel (RF-SPACE-03). Leitura: equipe; escrita: Dono/Admin. */
@ApiTags('courts')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId/courts')
export class CourtsController {
  constructor(private readonly service: CourtsService) {}

  @Get()
  @SpacePermission('schedule.view')
  @ApiOperation({ operationId: 'listCourts', summary: 'Quadras do espaço' })
  @ApiZodResponse(schemas.courtList)
  async list(@Param('spaceId') spaceId: string): Promise<{ items: Court[] }> {
    return { items: await this.service.list(spaceId) };
  }

  @Post()
  @SpacePermission('settings.manage')
  @ApiOperation({
    operationId: 'createCourt',
    summary: 'Cadastrar quadra',
    description:
      'Esportes com capacidade (até 20, decisão 18). Erros: `COURT_NAME_TAKEN` (409), `UNKNOWN_SPORT` (422).',
  })
  @ApiZodBody(schemas.createCourt)
  @ApiZodResponse(schemas.court, HttpStatus.CREATED)
  create(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.createCourt)) body: CreateCourt,
  ): Promise<Court> {
    return this.service.create(spaceId, body);
  }

  @Get(':courtId')
  @SpacePermission('schedule.view')
  @ApiUuidParam('courtId')
  @ApiOperation({ operationId: 'getCourt', summary: 'Detalhe da quadra' })
  @ApiZodResponse(schemas.court)
  get(@Param('spaceId') spaceId: string, @courtId() id: string): Promise<Court> {
    return this.service.get(spaceId, id);
  }

  @Patch(':courtId')
  @SpacePermission('settings.manage')
  @ApiUuidParam('courtId')
  @ApiOperation({
    operationId: 'updateCourt',
    summary: 'Editar quadra (nome, coberta, status, esportes)',
    description:
      '`sports`, quando enviado, substitui a lista inteira. Inativar a quadra com turmas ativas → 409 `COURT_HAS_CLASS_GROUPS` (`details.classGroups` lista as turmas).',
  })
  @ApiZodBody(schemas.updateCourt)
  @ApiZodResponse(schemas.court)
  update(
    @Param('spaceId') spaceId: string,
    @courtId() id: string,
    @Body(new ZodValidationPipe(schemas.updateCourt)) body: UpdateCourt,
  ): Promise<Court> {
    return this.service.update(spaceId, id, body);
  }

  @Delete(':courtId')
  @SpacePermission('settings.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('courtId')
  @ApiOperation({
    operationId: 'deleteCourt',
    summary: 'Excluir quadra',
    description:
      'Com turmas, responde `COURT_HAS_CLASS_GROUPS` (409, `details.classGroups` lista as turmas); com reservas ou mensalistas, `COURT_HAS_BOOKINGS` (409): use o status INACTIVE.',
  })
  @ApiNoContentResponse()
  delete(@Param('spaceId') spaceId: string, @courtId() id: string): Promise<void> {
    return this.service.delete(spaceId, id);
  }
}
