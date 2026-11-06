import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  AVATAR_MAX_BYTES,
  type AvatarResponse,
  type AvatarUpload,
  type CreateAvatarUpload,
  type SetAvatar,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { avatarSchemas } from './avatar.openapi.js';
import { AVATAR_UPLOAD_LIMIT, AvatarService } from './avatar.service.js';

const storageUnavailable = ApiServiceUnavailableResponse({
  description: '`STORAGE_UNAVAILABLE`: storage das fotos não configurado.',
  type: ErrorResponseDto,
});

/**
 * Foto de perfil do usuário da sessão (RF-AUTH-02, decisões 67 e 71). Só o próprio usuário: as
 * rotas não recebem id, e a chave enviada precisa ser de um upload dele. Conta inativa ou
 * bloqueada já é barrada pelo guard de autenticação.
 */
@ApiTags('me')
@ApiAuth()
@Controller('me/avatar')
export class AvatarController {
  constructor(private readonly avatar: AvatarService) {}

  @Post('uploads')
  @ApiOperation({
    operationId: 'createMyAvatarUpload',
    summary: 'URL pré-assinada para enviar a foto de perfil ao storage',
    description: `Imagem quadrada (largura = altura), JPEG, PNG ou WebP, até ${AVATAR_MAX_BYTES / 1024 / 1024} MB. Envie o arquivo com \`PUT\` na \`uploadUrl\`, com os \`headers\` devolvidos, antes de \`expiresAt\`, e depois registre a \`key\` em \`PUT /v1/me/avatar\`.`,
  })
  @ApiZodBody(avatarSchemas.createUpload)
  @ApiZodResponse(avatarSchemas.upload, HttpStatus.CREATED)
  @ApiTooManyRequestsResponse({
    description: `\`TOO_MANY_REQUESTS\`: mais de ${AVATAR_UPLOAD_LIMIT.max} pedidos por hora do mesmo usuário, com \`X-Retry-After\`.`,
    type: ErrorResponseDto,
  })
  @storageUnavailable
  createUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(avatarSchemas.createUpload)) body: CreateAvatarUpload,
  ): Promise<AvatarUpload> {
    return this.avatar.createUpload(user.id, body);
  }

  @Put()
  @ApiOperation({
    operationId: 'setMyAvatar',
    summary: 'Registrar a foto de perfil enviada (substitui a atual)',
    description:
      'Copia o upload para a chave publicada e confere o objeto real (tamanho, tipo pelos bytes e imagem quadrada); o arquivo inválido é apagado. Grava `avatarUrl` e apaga do storage a foto anterior, se ela tiver sido enviada por este usuário; uma URL externa, como a foto do Google (decisão 71), só é substituída. Registrar de novo a chave da foto atual não muda nada.',
  })
  @ApiZodBody(avatarSchemas.set)
  @ApiZodResponse(avatarSchemas.response)
  @ApiUnprocessableEntityResponse({
    description:
      '`INVALID_UPLOAD_KEY`: chave fora do formato, expirada ou de outro usuário. `UPLOAD_NOT_FOUND`: o arquivo não foi enviado. `IMAGE_TOO_LARGE`. `INVALID_IMAGE_FILE`: vazio ou não é imagem do tipo pedido. `IMAGE_NOT_SQUARE`: com `details.width`/`height`.',
    type: ErrorResponseDto,
  })
  @storageUnavailable
  set(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(avatarSchemas.set)) body: SetAvatar,
  ): Promise<AvatarResponse> {
    return this.avatar.set(user.id, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'deleteMyAvatar',
    summary: 'Remover a foto de perfil (as telas voltam às iniciais); idempotente',
    description:
      'Zera `avatarUrl` e apaga o arquivo do storage se a foto tiver sido enviada por este usuário (a foto do Google só sai do perfil).',
  })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser): Promise<void> {
    return this.avatar.remove(user.id);
  }
}
