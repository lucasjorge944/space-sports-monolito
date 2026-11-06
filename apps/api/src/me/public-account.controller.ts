import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import {
  type PublicAccountDeletionInput,
  type PublicAccountDeletionResponse,
  publicAccountDeletionSchema,
} from '@space-sports/shared';
import type { Request } from 'express';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import { clientIp } from '../auth/client-ip.js';
import { Public } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { AccountService } from './account.service.js';
import { meSchemas } from './me.openapi.js';

/** Rotas públicas da conta: a página web de exclusão (exigência do Google Play). */
@ApiTags('me')
@Public()
@Controller('public')
export class PublicAccountController {
  constructor(
    private readonly account: AccountService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Post('deletion-request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'requestAccountDeletionPublic',
    summary: 'Pedir a exclusão da conta pela página web (e-mail e senha)',
    description:
      'RF-AUTH-03 (decisão 40): mesmas regras de `POST /v1/me/deletion-request`, com o e-mail e a senha do login por e-mail; vale também para a conta já inativa. A resposta é sempre a mesma (202 com a mensagem genérica): não revela se o e-mail existe, se a senha confere nem se o pedido foi registrado. O titular recebe o resultado por e-mail (pedido recebido com o prazo, ou o motivo de não ter sido registrado). Rate limit por IP e por e-mail: 429 `TOO_MANY_REQUESTS`, com `X-Retry-After`.',
  })
  @ApiZodBody(meSchemas.publicDeletion)
  @ApiZodResponse(meSchemas.publicDeletionResponse, HttpStatus.ACCEPTED)
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  requestDeletion(
    @Req() req: Request,
    @Body(new ZodValidationPipe(publicAccountDeletionSchema)) body: PublicAccountDeletionInput,
  ): Promise<PublicAccountDeletionResponse> {
    return this.account.requestDeletionPublic(body, clientIp(this.auth, req));
  }
}
