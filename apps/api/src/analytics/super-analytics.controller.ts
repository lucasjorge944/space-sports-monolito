import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type PlatformAnalytics,
  type PlatformAnalyticsQuery,
  platformAnalyticsQuerySchema,
  type SpacesAnalytics,
  type SpacesAnalyticsQuery,
  spacesAnalyticsQuerySchema,
} from '@space-sports/shared';
import { ApiAuth, OAuthScopes, OAuthView, SuperOnly } from '../auth/decorators.js';
import { mcpViews } from '../auth/mcp-views.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { analyticsSchemas as schemas } from './analytics.openapi.js';
import { ANALYTICS_COMMON, periodErrors } from './manage-analytics.controller.js';
import { PlatformAnalyticsService } from './platform-analytics.service.js';

/**
 * Métricas da plataforma para o Super (decisão 124; RF-SUPER-09; docs/14-mcp.md 8.4). Pelo MCP:
 * `super:read`, com a visão de campos permitidos e a auditoria de toda leitura (decisão 123).
 */
@ApiTags('super-analytics')
@ApiAuth()
@SuperOnly()
@Controller('super/analytics')
export class SuperAnalyticsController {
  constructor(private readonly service: PlatformAnalyticsService) {}

  @Get('platform')
  @OAuthScopes('super:read')
  @OAuthView(mcpViews.platformAnalytics)
  @ApiOperation({
    operationId: 'superGetPlatformAnalytics',
    summary: 'Métricas da plataforma',
    description: `Reservas que contam e horas (data de início), usuários e espaços novos (data do cadastro), espaços com movimento (reserva que conta ou aula dada no grupo) e pagamentos online: cobranças pagas, volume e receita líquida da plataforma, com a regra do relatório de receita (data do lançamento). Agrupamento: \`week\` (padrão), \`day\` ou \`month\`. ${ANALYTICS_COMMON}`,
  })
  @ApiZodQuery(platformAnalyticsQuerySchema)
  @ApiZodResponse(schemas.platform)
  @periodErrors()
  platform(
    @Query(new ZodValidationPipe(platformAnalyticsQuerySchema)) query: PlatformAnalyticsQuery,
  ): Promise<PlatformAnalytics> {
    return this.service.platform(query);
  }

  @Get('spaces')
  @OAuthScopes('super:read')
  @OAuthView(mcpViews.spacesAnalytics)
  @ApiOperation({
    operationId: 'superGetSpacesAnalytics',
    summary: 'Comparação entre espaços com o período anterior',
    description: `Uma linha por espaço (filtro \`status\`): reservas que contam, presenças em aulas dadas e recebido (regra do extrato), no período e no anterior de mesma duração (\`previousPeriod\`), com a variação absoluta (\`*Delta\`, pode ser negativa); mensalistas e alunos ativos são o retrato de hoje. Ordem: \`sort\` (\`bookingsDelta\` padrão, \`presencesDelta\`, \`receivedDeltaCents\`, \`bookings\`, \`presences\`, \`receivedCents\` ou \`name\`) e \`order\` (\`asc\` padrão: quem mais caiu primeiro; ou \`desc\`), com empate pelo nome; \`limit\` espaços (padrão 50, máximo 200). \`spacesCount\` diz quantos espaços há no filtro, e os totais somam todos eles. ${ANALYTICS_COMMON}`,
  })
  @ApiZodQuery(spacesAnalyticsQuerySchema)
  @ApiZodResponse(schemas.spaces)
  @periodErrors()
  spaces(
    @Query(new ZodValidationPipe(spacesAnalyticsQuerySchema)) query: SpacesAnalyticsQuery,
  ): Promise<SpacesAnalytics> {
    return this.service.spaces(query);
  }
}
