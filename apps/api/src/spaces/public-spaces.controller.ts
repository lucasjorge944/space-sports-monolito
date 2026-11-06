import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  type PublicSpace,
  type SpaceCard,
  type SpaceSearchQuery,
  type SpaceSearchResult,
  spaceSearchQuerySchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, Public } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { PublicSpacesService } from './public-spaces.service.js';
import { spaceNotFound } from './spaces.errors.js';
import { schemas } from './spaces.openapi.js';

/** Vitrine, busca, página pública e favoritos (RF-SPACE-05..09). */
@ApiTags('spaces')
@Controller()
export class PublicSpacesController {
  constructor(private readonly service: PublicSpacesService) {}

  @Get('spaces')
  @Public()
  @ApiOperation({
    operationId: 'searchSpaces',
    summary: 'Buscar espaços na vitrine (raio, esporte, serviço, infraestrutura, nome, nota)',
    description:
      'Só espaços ACTIVE com quadra ativa e preço/hora (RN-SPACE-01). Com `lat`/`lng`: raio (padrão 20 km) e ordem por distância; sem eles, ordem por nome. `minRating` e `sort=rating` (decisão 109) usam só a nota pública (5 ou mais avaliações): o filtro deixa de fora os "Novo" e a ordem `rating` os põe no fim, sem usar a média escondida. O mapa do app usa esta rota (só a primeira página, os mais perto): lá vale só o `minRating`, sem `sort`. Paginação por `cursor` (`nextCursor` da página anterior, com os mesmos filtros e a mesma ordem): cursor malformado ou de outros filtros, 400 `INVALID_CURSOR`; cursor da outra ordem, 400 `CURSOR_SORT_MISMATCH`.',
  })
  @ApiZodQuery(spaceSearchQuerySchema)
  @ApiZodResponse(schemas.searchResult)
  search(
    @Query(new ZodValidationPipe(spaceSearchQuerySchema)) query: SpaceSearchQuery,
  ): Promise<SpaceSearchResult> {
    return this.service.search(query);
  }

  @Get('spaces/:slug')
  @Public()
  @ApiParam({ name: 'slug', example: 'arena-7' })
  @ApiOperation({
    operationId: 'getSpaceBySlug',
    summary: 'Página pública do espaço (RF-SPACE-08)',
  })
  @ApiZodResponse(schemas.publicSpace)
  getBySlug(@Param('slug') slug: string): Promise<PublicSpace> {
    return this.service.getBySlug(slug);
  }

  @Put('spaces/:spaceId/favorite')
  @ApiAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('spaceId')
  @ApiOperation({ operationId: 'favoriteSpace', summary: 'Favoritar espaço (RF-SPACE-09)' })
  @ApiNoContentResponse()
  favorite(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new UuidParamPipe(spaceNotFound)) spaceId: string,
  ): Promise<void> {
    return this.service.favorite(user.id, spaceId);
  }

  @Delete('spaces/:spaceId/favorite')
  @ApiAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('spaceId')
  @ApiOperation({ operationId: 'unfavoriteSpace', summary: 'Desfavoritar espaço' })
  @ApiNoContentResponse()
  unfavorite(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new UuidParamPipe(spaceNotFound)) spaceId: string,
  ): Promise<void> {
    return this.service.unfavorite(user.id, spaceId);
  }

  @Get('me/recent-spaces')
  @ApiAuth()
  @ApiOperation({
    operationId: 'listRecentSpaces',
    summary: 'Espaços recentes do usuário (RF-SPACE-12)',
    description:
      'Até 10 espaços da vitrine em que o usuário reservou (organizador ou participante que aceitou), tem aula (presença confirmada, presente ou falta) ou assinatura não recusada, da interação mais recente para a mais antiga. A interação vale pela data da reserva ou da aula quando já passou e pela data em que foi feita quando ainda vai acontecer; a assinatura, pela data do pedido. Canceladas não contam; espaço fora da vitrine some. No formato do card de `GET /v1/spaces`, sem distância. As páginas só abertas ficam no histórico do aparelho.',
  })
  @ApiZodResponse(schemas.recentSpaceList)
  async recentSpaces(@CurrentUser() user: AuthUser): Promise<{ items: SpaceCard[] }> {
    return { items: await this.service.recentForUser(user.id) };
  }

  @Get('me/favorites')
  @ApiAuth()
  @ApiOperation({
    operationId: 'listFavoriteSpaces',
    summary: 'Espaços favoritos do usuário (mais recentes primeiro)',
  })
  @ApiZodResponse(schemas.favoriteList)
  async favorites(@CurrentUser() user: AuthUser): Promise<{ items: SpaceCard[] }> {
    return { items: await this.service.listFavorites(user.id) };
  }
}
