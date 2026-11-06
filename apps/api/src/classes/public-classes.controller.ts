import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { PublicSpaceClasses } from '@space-sports/shared';
import { Public } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { ApiZodResponse } from '../openapi/zod-openapi.js';
import { schemas } from './classes.openapi.js';
import { PlansService } from './plans.service.js';

/** Aba Aulas da página do espaço (RF-CLASS-04, RF-SPACE-08): leitura pública. */
@ApiTags('spaces')
@Controller()
export class PublicClassesController {
  constructor(private readonly plans: PlansService) {}

  @Get('spaces/:slug/classes')
  @Public()
  @ApiParam({ name: 'slug', example: 'arena-7' })
  @ApiOperation({
    operationId: 'getSpaceClasses',
    summary: 'Planos e turmas com vagas do espaço',
    description:
      'Só planos e turmas ativos de espaços ACTIVE (senão 404 `SPACE_NOT_FOUND`). Vagas = capacidade − matrículas ativas. Horários das turmas no fuso do espaço (`space.timeZone`).',
  })
  @ApiZodResponse(schemas.publicClasses)
  @ApiNotFoundResponse({ description: '`SPACE_NOT_FOUND`.', type: ErrorResponseDto })
  get(@Param('slug') slug: string): Promise<PublicSpaceClasses> {
    return this.plans.publicClasses(slug);
  }
}
