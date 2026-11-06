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
import {
  type Amenity,
  type CreateAmenity,
  type CreateCity,
  type CreateSport,
  createAmenitySchema,
  createCitySchema,
  createSportSchema,
  SPORT_LEVEL_LABELS,
  SPORT_LEVELS,
  type Sport,
  type SuperCity,
  type UpdateAmenity,
  type UpdateCity,
  type UpdateSport,
  updateAmenitySchema,
  updateCitySchema,
  updateSportSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { CatalogService } from './catalog.service.js';
import { amenityNotFound, cityIdNotFound, sportNotFound } from './super.errors.js';
import { superSchemas as schemas } from './super.openapi.js';

const sportId = () => Param('sportId', new UuidParamPipe(sportNotFound));
const amenityId = () => Param('amenityId', new UuidParamPipe(amenityNotFound));
const cityId = () => Param('cityId', new UuidParamPipe(cityIdNotFound));

/**
 * Catálogos (RF-SUPER-06). Exclusão de item em uso responde `CATALOG_IN_USE` (409); para cidades,
 * desative com `active: false`. Os níveis do jogador são um enum do banco: só leitura.
 */
@ApiTags('super-catalog')
@ApiAuth()
@SuperOnly()
@Controller('super/catalog')
export class SuperCatalogController {
  constructor(private readonly service: CatalogService) {}

  @Get('sports')
  @ApiOperation({ operationId: 'superListSports', summary: 'Esportes' })
  @ApiZodResponse(schemas.sportList)
  async listSports(): Promise<{ items: Sport[] }> {
    return { items: await this.service.listSports() };
  }

  @Post('sports')
  @ApiOperation({
    operationId: 'superCreateSport',
    summary: 'Criar esporte',
    description: 'Erro: `CATALOG_SLUG_TAKEN` (409).',
  })
  @ApiZodBody(schemas.createSport)
  @ApiZodResponse(schemas.sportList.shape.items.element, HttpStatus.CREATED)
  createSport(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSportSchema)) body: CreateSport,
  ): Promise<Sport> {
    return this.service.createSport(user.id, body);
  }

  @Patch('sports/:sportId')
  @ApiUuidParam('sportId')
  @ApiOperation({ operationId: 'superUpdateSport', summary: 'Editar esporte' })
  @ApiZodBody(schemas.updateSport)
  @ApiZodResponse(schemas.sportList.shape.items.element)
  updateSport(
    @CurrentUser() user: AuthUser,
    @sportId() id: string,
    @Body(new ZodValidationPipe(updateSportSchema)) body: UpdateSport,
  ): Promise<Sport> {
    return this.service.updateSport(user.id, id, body);
  }

  @Delete('sports/:sportId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('sportId')
  @ApiOperation({ operationId: 'superDeleteSport', summary: 'Excluir esporte sem uso' })
  @ApiNoContentResponse()
  deleteSport(@CurrentUser() user: AuthUser, @sportId() id: string): Promise<void> {
    return this.service.deleteSport(user.id, id);
  }

  @Get('amenities')
  @ApiOperation({ operationId: 'superListAmenities', summary: 'Itens de infraestrutura' })
  @ApiZodResponse(schemas.amenityList)
  async listAmenities(): Promise<{ items: Amenity[] }> {
    return { items: await this.service.listAmenities() };
  }

  @Post('amenities')
  @ApiOperation({
    operationId: 'superCreateAmenity',
    summary: 'Criar item de infraestrutura',
    description: 'Erro: `CATALOG_SLUG_TAKEN` (409).',
  })
  @ApiZodBody(schemas.createAmenity)
  @ApiZodResponse(schemas.amenityList.shape.items.element, HttpStatus.CREATED)
  createAmenity(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createAmenitySchema)) body: CreateAmenity,
  ): Promise<Amenity> {
    return this.service.createAmenity(user.id, body);
  }

  @Patch('amenities/:amenityId')
  @ApiUuidParam('amenityId')
  @ApiOperation({ operationId: 'superUpdateAmenity', summary: 'Editar item de infraestrutura' })
  @ApiZodBody(schemas.updateAmenity)
  @ApiZodResponse(schemas.amenityList.shape.items.element)
  updateAmenity(
    @CurrentUser() user: AuthUser,
    @amenityId() id: string,
    @Body(new ZodValidationPipe(updateAmenitySchema)) body: UpdateAmenity,
  ): Promise<Amenity> {
    return this.service.updateAmenity(user.id, id, body);
  }

  @Delete('amenities/:amenityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('amenityId')
  @ApiOperation({ operationId: 'superDeleteAmenity', summary: 'Excluir item sem uso' })
  @ApiNoContentResponse()
  deleteAmenity(@CurrentUser() user: AuthUser, @amenityId() id: string): Promise<void> {
    return this.service.deleteAmenity(user.id, id);
  }

  @Get('cities')
  @ApiOperation({ operationId: 'superListCities', summary: 'Cidades, ativas e inativas' })
  @ApiZodResponse(schemas.cityList)
  async listCities(): Promise<{ items: SuperCity[] }> {
    return { items: await this.service.listCities() };
  }

  @Post('cities')
  @ApiOperation({
    operationId: 'superCreateCity',
    summary: 'Criar cidade',
    description: 'Erro: `CITY_ALREADY_EXISTS` (409).',
  })
  @ApiZodBody(schemas.createCity)
  @ApiZodResponse(schemas.city, HttpStatus.CREATED)
  createCity(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCitySchema)) body: CreateCity,
  ): Promise<SuperCity> {
    return this.service.createCity(user.id, body);
  }

  @Patch('cities/:cityId')
  @ApiUuidParam('cityId')
  @ApiOperation({ operationId: 'superUpdateCity', summary: 'Editar ou desativar cidade' })
  @ApiZodBody(schemas.updateCity)
  @ApiZodResponse(schemas.city)
  updateCity(
    @CurrentUser() user: AuthUser,
    @cityId() id: string,
    @Body(new ZodValidationPipe(updateCitySchema)) body: UpdateCity,
  ): Promise<SuperCity> {
    return this.service.updateCity(user.id, id, body);
  }

  @Delete('cities/:cityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('cityId')
  @ApiOperation({ operationId: 'superDeleteCity', summary: 'Excluir cidade sem espaços' })
  @ApiNoContentResponse()
  deleteCity(@CurrentUser() user: AuthUser, @cityId() id: string): Promise<void> {
    return this.service.deleteCity(user.id, id);
  }

  @Get('levels')
  @ApiOperation({
    operationId: 'superListLevels',
    summary: 'Níveis do jogador (somente leitura)',
    description:
      'Os níveis são o enum `sport_level` do banco; criar ou renomear níveis exige mudar o modelo de dados.',
  })
  @ApiZodResponse(schemas.levelList)
  listLevels() {
    return { items: SPORT_LEVELS.map((value) => ({ value, label: SPORT_LEVEL_LABELS[value] })) };
  }
}
