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
  Put,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateLogoUpload,
  type CreatePhoto,
  type CreatePhotoUpload,
  LOGO_MAX_BYTES,
  type LogoUpload,
  type ManagedSpace,
  type Photo,
  type PhotoUpload,
  type ReorderPhotos,
  type ReplaceAmenities,
  type ReplaceOpeningHours,
  type SetLogo,
  type SpaceSettings,
  type UpdateSpace,
  type UpdateSpaceSettings,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { ManageSpacesService } from './manage-spaces.service.js';
import { SpaceLogoService } from './space-logo.service.js';
import { photoNotFound } from './spaces.errors.js';
import { schemas } from './spaces.openapi.js';

/**
 * Painel do espaço (RN-AUTH-03: tudo no contexto do `:spaceId`). Leitura para toda a equipe
 * (RN-AUTH-04); edição conforme a matriz de docs/02. Espaço suspenso: só leitura.
 */
@ApiTags('space-management')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId')
export class ManageSpacesController {
  constructor(
    private readonly service: ManageSpacesService,
    private readonly logo: SpaceLogoService,
  ) {}

  @Get()
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'getManagedSpace',
    summary: 'Dados do espaço no painel, com o que falta para aparecer na vitrine',
  })
  @ApiZodResponse(schemas.managedSpace)
  get(@Param('spaceId') spaceId: string): Promise<ManagedSpace> {
    return this.service.get(spaceId);
  }

  @Patch()
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'updateManagedSpace',
    summary: 'Editar descrição, endereço (geocodificado), contatos e cidade (RF-SPACE-01)',
    description:
      'Mudar o endereço ou a cidade refaz a geocodificação, a menos que `location` venha junto. Erros: `ADDRESS_NOT_FOUND` (422), `GEOCODING_UNAVAILABLE` (503), `CITY_NOT_FOUND` (422).',
  })
  @ApiZodBody(schemas.updateSpace)
  @ApiZodResponse(schemas.managedSpace)
  update(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.updateSpace)) body: UpdateSpace,
  ): Promise<ManagedSpace> {
    return this.service.update(spaceId, body);
  }

  @Put('amenities')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'replaceSpaceAmenities',
    summary: 'Substituir a infraestrutura do espaço (RF-SPACE-02)',
  })
  @ApiZodBody(schemas.replaceAmenities)
  @ApiZodResponse(schemas.managedSpace)
  replaceAmenities(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.replaceAmenities)) body: ReplaceAmenities,
  ): Promise<ManagedSpace> {
    return this.service.replaceAmenities(spaceId, body);
  }

  @Put('opening-hours')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'replaceSpaceOpeningHours',
    summary: 'Substituir o horário de funcionamento',
  })
  @ApiZodBody(schemas.replaceOpeningHours)
  @ApiZodResponse(schemas.managedSpace)
  replaceOpeningHours(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.replaceOpeningHours)) body: ReplaceOpeningHours,
  ): Promise<ManagedSpace> {
    return this.service.replaceOpeningHours(spaceId, body);
  }

  @Get('settings')
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'getSpaceSettings',
    summary: 'Configurações do espaço (valores salvos ou os padrões de docs/02 seção 2.1)',
  })
  @ApiZodResponse(schemas.settings)
  getSettings(@Param('spaceId') spaceId: string): Promise<SpaceSettings> {
    return this.service.getSettings(spaceId);
  }

  @Patch('settings')
  @SpacePermission('settings.manage')
  @ApiOperation({
    operationId: 'updateSpaceSettings',
    summary: 'Editar as configurações (RF-SPACE-04)',
    description:
      'Só os campos enviados mudam; o resultado é validado inteiro (durações em múltiplos de 30 min, mínimo ≤ máximo, etc.).',
  })
  @ApiZodBody(schemas.updateSettings)
  @ApiZodResponse(schemas.settings)
  updateSettings(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.updateSettings)) body: UpdateSpaceSettings,
  ): Promise<SpaceSettings> {
    return this.service.updateSettings(spaceId, body);
  }

  @Post('photos/uploads')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'createSpacePhotoUpload',
    summary: 'URL pré-assinada para enviar uma foto ao storage',
    description:
      'Envie o arquivo com `PUT` na `uploadUrl`, com os `headers` devolvidos, e depois registre a `key` em `POST .../photos`. Erros: `STORAGE_UNAVAILABLE` (503), `PHOTO_LIMIT_REACHED` (409).',
  })
  @ApiZodBody(schemas.createPhotoUpload)
  @ApiZodResponse(schemas.photoUpload, HttpStatus.CREATED)
  createPhotoUpload(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.createPhotoUpload)) body: CreatePhotoUpload,
  ): Promise<PhotoUpload> {
    return this.service.createPhotoUpload(spaceId, body);
  }

  @Post('photos')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'addSpacePhoto',
    summary: 'Registrar a foto enviada (entra no fim da galeria; a primeira é a capa)',
    description:
      'Confere o objeto real no storage antes de gravar; o arquivo inválido é apagado. Erros: `PHOTO_NOT_UPLOADED`, `PHOTO_TOO_LARGE`, `INVALID_PHOTO_FILE` (vazio ou tipo diferente do pedido), `INVALID_PHOTO_KEY` (422); `PHOTO_ALREADY_ADDED`, `PHOTO_LIMIT_REACHED` (409).',
  })
  @ApiZodBody(schemas.createPhoto)
  @ApiZodResponse(schemas.photo, HttpStatus.CREATED)
  addPhoto(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.createPhoto)) body: CreatePhoto,
  ): Promise<Photo> {
    return this.service.addPhoto(spaceId, body);
  }

  @Put('photos/order')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'reorderSpacePhotos',
    summary: 'Reordenar a galeria (todas as fotos; a primeira vira a capa)',
  })
  @ApiZodBody(schemas.reorderPhotos)
  @ApiZodResponse(schemas.photoList)
  async reorderPhotos(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.reorderPhotos)) body: ReorderPhotos,
  ): Promise<{ items: Photo[] }> {
    return { items: await this.service.reorderPhotos(spaceId, body) };
  }

  @Delete('photos/:photoId')
  @SpacePermission('space.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('photoId')
  @ApiOperation({ operationId: 'deleteSpacePhoto', summary: 'Remover uma foto da galeria' })
  @ApiNoContentResponse()
  deletePhoto(
    @Param('spaceId') spaceId: string,
    @Param('photoId', new UuidParamPipe(photoNotFound)) photoId: string,
  ): Promise<void> {
    return this.service.deletePhoto(spaceId, photoId);
  }

  // Logo (RF-SPACE-11): Dono e Admin, no mesmo fluxo pré-assinado das fotos.

  @Post('logo/uploads')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'createSpaceLogoUpload',
    summary: 'URL pré-assinada para enviar a logo ao storage (RF-SPACE-11)',
    description: `Imagem quadrada (largura = altura), JPEG, PNG ou WebP, até ${LOGO_MAX_BYTES / 1024 / 1024} MB. Envie o arquivo com \`PUT\` na \`uploadUrl\`, com os \`headers\` devolvidos, e depois registre a \`key\` em \`PUT .../logo\`. Erros: \`STORAGE_UNAVAILABLE\` (503).`,
  })
  @ApiZodBody(schemas.createLogoUpload)
  @ApiZodResponse(schemas.logoUpload, HttpStatus.CREATED)
  createLogoUpload(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(schemas.createLogoUpload)) body: CreateLogoUpload,
  ): Promise<LogoUpload> {
    return this.logo.createUpload(spaceId, body);
  }

  @Put('logo')
  @SpacePermission('space.edit')
  @ApiOperation({
    operationId: 'setSpaceLogo',
    summary: 'Registrar a logo enviada (substitui a atual e apaga o arquivo anterior)',
    description:
      'Confere o objeto real no storage antes de gravar (tamanho, tipo pelos bytes e imagem quadrada); o arquivo inválido é apagado. Erros: `LOGO_NOT_UPLOADED`, `LOGO_TOO_LARGE`, `INVALID_LOGO_FILE` (vazio, tipo diferente do pedido ou não quadrada, com `details.width`/`height`), `INVALID_LOGO_KEY` (422); `STORAGE_UNAVAILABLE` (503).',
  })
  @ApiZodBody(schemas.setLogo)
  @ApiZodResponse(schemas.managedSpace)
  async setLogo(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(schemas.setLogo)) body: SetLogo,
  ): Promise<ManagedSpace> {
    await this.logo.set(spaceId, user.id, body);
    return this.service.get(spaceId);
  }

  @Delete('logo')
  @SpacePermission('space.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'deleteSpaceLogo',
    summary: 'Remover a logo (as telas voltam às iniciais do nome); idempotente',
  })
  @ApiNoContentResponse()
  deleteLogo(@Param('spaceId') spaceId: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.logo.remove(spaceId, user.id);
  }
}
