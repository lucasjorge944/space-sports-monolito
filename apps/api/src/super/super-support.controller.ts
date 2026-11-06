import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type SupportSession,
  type SupportSessionQuery,
  supportSessionQuerySchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { supportSessionNotFound } from './super.errors.js';
import { superSchemas as schemas } from './super.openapi.js';
import { SupportService } from './support.service.js';

/** Sessões do modo suporte (RF-SUPER-04, RN-SUPER-01). A abertura é em `super/spaces/:id/support-sessions`. */
@ApiTags('super-support')
@ApiAuth()
@SuperOnly()
@Controller('super/support-sessions')
export class SuperSupportController {
  constructor(private readonly service: SupportService) {}

  @Get()
  @ApiOperation({
    operationId: 'superListSupportSessions',
    summary: 'Sessões de suporte (de todos os Supers), mais recentes primeiro',
  })
  @ApiZodQuery(supportSessionQuerySchema)
  @ApiZodResponse(schemas.supportSessionList)
  async list(
    @Query(new ZodValidationPipe(supportSessionQuerySchema)) query: SupportSessionQuery,
  ): Promise<{ items: SupportSession[] }> {
    return { items: await this.service.list(query) };
  }

  @Get(':sessionId')
  @ApiUuidParam('sessionId')
  @ApiOperation({ operationId: 'superGetSupportSession', summary: 'Sessão de suporte' })
  @ApiZodResponse(schemas.supportSession)
  get(
    @Param('sessionId', new UuidParamPipe(supportSessionNotFound)) sessionId: string,
  ): Promise<SupportSession> {
    return this.service.get(sessionId);
  }

  @Post(':sessionId/end')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'superEndSupportSession',
    summary: 'Encerrar a própria sessão de suporte (registra o fim)',
    description:
      'Idempotente. Só encerra sessões do próprio Super (`SUPPORT_SESSION_NOT_FOUND` nas demais).',
  })
  @ApiZodResponse(schemas.supportSession)
  end(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', new UuidParamPipe(supportSessionNotFound)) sessionId: string,
  ): Promise<SupportSession> {
    return this.service.end(user.id, sessionId);
  }
}
