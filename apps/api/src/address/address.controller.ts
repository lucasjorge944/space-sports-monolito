import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { CepAddress } from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { ApiZodResponse } from '../openapi/zod-openapi.js';
import { schemas } from './address.openapi.js';
import { CepLookupService } from './cep-lookup.service.js';

/** Endereços: busca por CEP para os formulários do painel, do Super e do app (decisão 52). */
@ApiTags('address')
@ApiAuth()
@Controller('address')
export class AddressController {
  constructor(private readonly cep: CepLookupService) {}

  @Get('cep/:cep')
  @ApiParam({ name: 'cep', description: 'Com ou sem hífen.', example: '30130-010' })
  @ApiOperation({
    operationId: 'lookupCep',
    summary: 'Buscar logradouro, bairro, cidade e UF pelo CEP',
    description:
      'Decisão 52: consulta ViaCEP e, se indisponível, BrasilAPI, com cache de 30 dias (1 dia para CEP não encontrado). `street` e `neighborhood` vêm nulos no CEP geral de um município. A falha na busca nunca impede preencher à mão.',
  })
  @ApiZodResponse(schemas.cepAddress)
  @ApiUnprocessableEntityResponse({
    description: '`CEP_INVALID`: não tem 8 dígitos.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: '`CEP_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: '`TOO_MANY_REQUESTS`, com `details.retryAfter` em segundos.',
    type: ErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: '`CEP_LOOKUP_UNAVAILABLE`: os dois provedores falharam.',
    type: ErrorResponseDto,
  })
  lookup(@CurrentUser() user: AuthUser, @Param('cep') cep: string): Promise<CepAddress> {
    return this.cep.lookup(user.id, cep);
  }
}
