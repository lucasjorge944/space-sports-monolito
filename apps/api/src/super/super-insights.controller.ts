import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuditLogPage,
  type AuditLogQuery,
  auditLogQuerySchema,
  type SuperMetrics,
  type SuperMetricsQuery,
  superMetricsQuerySchema,
} from '@space-sports/shared';
import { ApiAuth, SuperOnly } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { InsightsService } from './insights.service.js';
import { superSchemas as schemas } from './super.openapi.js';

/** Métricas por espaço (RF-SUPER-09) e log de auditoria global (RF-SUPER-10). */
@ApiTags('super-insights')
@ApiAuth()
@SuperOnly()
@Controller('super')
export class SuperInsightsController {
  constructor(private readonly service: InsightsService) {}

  @Get('metrics/spaces')
  @ApiOperation({
    operationId: 'superSpaceMetrics',
    summary: 'Métricas de uso por espaço',
    description:
      'Reservas (início no período, sem canceladas), mensalistas ativos hoje e último acesso da equipe (sessão mais recente de um membro ativo). `activeStudents`, `attendances` e `tournaments` são 0 até os módulos da Fase 2. Período padrão: 30 dias até hoje (datas locais).',
  })
  @ApiZodQuery(superMetricsQuerySchema)
  @ApiZodResponse(schemas.metrics)
  metrics(
    @Query(new ZodValidationPipe(superMetricsQuerySchema)) query: SuperMetricsQuery,
  ): Promise<SuperMetrics> {
    return this.service.metrics(query);
  }

  @Get('audit-logs')
  @ApiOperation({
    operationId: 'superListAuditLogs',
    summary: 'Log de auditoria global, mais recente primeiro',
    description:
      'Filtros: `actorId`, `spaceId`, `entity`, `action` (prefixo, ex.: `support.`), `actingAsSuper`, `from`/`to`. Paginação por `cursor` (`nextCursor` da página anterior). Erro: `INVALID_CURSOR` (400).',
  })
  @ApiZodQuery(auditLogQuerySchema)
  @ApiZodResponse(schemas.auditLog)
  auditLogs(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<AuditLogPage> {
    return this.service.auditLog(query);
  }
}
