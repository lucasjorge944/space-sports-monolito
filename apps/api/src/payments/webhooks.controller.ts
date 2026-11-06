import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { WebhooksService } from './webhooks.service.js';

/** Corpo bruto guardado pelo body parser (a assinatura é sobre os bytes recebidos). */
type RawRequest = Request & { rawBody?: Buffer };

/** Webhooks do gateway de pagamento (RN-ONPAY-07). Público: a autenticação é a assinatura. */
@ApiTags('payments-webhooks')
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':provider')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'receivePaymentWebhook',
    summary: 'Webhook do gateway de pagamento',
    description:
      'RN-ONPAY-07: a assinatura do provedor é conferida; cada evento é gravado uma vez (único por provedor e id) e processado na fila. Duplicado responde 200 sem processar de novo. Provedor diferente do configurado: 404 `WEBHOOK_PROVIDER_NOT_FOUND`; assinatura inválida: 401 `WEBHOOK_SIGNATURE_INVALID`; assinatura válida com corpo ilegível (não é JSON, vazio): 400 `INVALID_WEBHOOK_PAYLOAD`. JSON válido sem o formato de evento responde 200 com `received: 0`.',
  })
  @ApiOkResponse({
    schema: { type: 'object', properties: { received: { type: 'integer' } } },
  })
  @ApiBadRequestResponse({ description: '`INVALID_WEBHOOK_PAYLOAD`.', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: '`WEBHOOK_SIGNATURE_INVALID`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`WEBHOOK_PROVIDER_NOT_FOUND`.', type: ErrorResponseDto })
  receive(
    @Param('provider') provider: string,
    @Req() req: RawRequest,
  ): Promise<{ received: number }> {
    return this.webhooks.receive(provider, {
      headers: req.headers,
      rawBody: req.rawBody ?? Buffer.from(''),
    });
  }
}
