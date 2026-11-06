import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import {
  type AdDeliveryList,
  type AdEventsInput,
  type AdEventsResult,
  type AdsQuery,
  adEventsInputSchema,
  adsQuerySchema,
} from '@space-sports/shared';
import type { Request } from 'express';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import { clientIp } from '../auth/client-ip.js';
import { Public } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimiter, type RateLimitRule } from '../contacts/rate-limiter.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { adsSchemas as schemas } from './ads.openapi.js';
import { AdDeliveryService } from './delivery.service.js';
import { AdEventsService } from './events.service.js';

// Limites por IP (RN-ADS-04). A folga cobre várias pessoas atrás do mesmo IP (rede da operadora);
// o IP só entra na chave do contador do Redis, nunca no banco.

/**
 * Entregas: cada uma gera tokens novos (e cada token vale uma impressão e um clique), então o
 * teto de entregas limita também o que um IP consegue somar. O app pede as duas vagas a cada
 * abertura do Explorar.
 */
export const AD_DELIVERY_LIMIT: RateLimitRule = { window: 60, max: 60 };
/** Envios de lote: o app manda um a cada ~10 s por pessoa. */
export const AD_EVENTS_LIMIT: RateLimitRule = { window: 60, max: 120 };
/** Eventos: o lote consome o número de eventos que traz (até 50). */
export const AD_EVENT_ITEMS_LIMIT: RateLimitRule = { window: 60, max: 600 };

/** Anúncios no app (RF-ADS-04 a 08; decisão 78): entrega e métricas, também sem login. */
@ApiTags('ads')
@Public()
@Controller('ads')
export class PublicAdsController {
  constructor(
    private readonly delivery: AdDeliveryService,
    private readonly events: AdEventsService,
    private readonly rateLimit: RateLimiter,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'listAds',
    summary: 'Peças no ar para a vaga (sem login)',
    description:
      'RF-ADS-07. Campanhas `ACTIVE` no período, de anunciante ativo, com peça ativa (destino em espaço só com o espaço na vitrine, RN-ADS-05). Cidade: `cityId` ou a do espaço da vitrine mais próximo de `lat`/`lng` (até 50 km); sem nenhum dos dois, só campanhas sem filtro de cidade. Esporte: `sportId` ou o slug em `sport`; sem esporte, só campanhas sem filtro de esporte. Sorteio ponderado pelo peso, uma peça por campanha, até 5 (`EXPLORE_HERO`) ou 10 (`EXPLORE_FEED`), na ordem do sorteio. Cada peça traz um `deliveryToken` (2 h) para `POST /v1/ads/events`. Segmentação sem dado pessoal (RN-ADS-03); resposta com `Cache-Control: no-store`. Rate limit por IP (60 por minuto, RN-ADS-04): 429 `TOO_MANY_REQUESTS`, com `X-Retry-After`.',
  })
  @ApiZodQuery(adsQuerySchema)
  @ApiZodResponse(schemas.deliveryList)
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async list(
    @Req() req: Request,
    @Query(new ZodValidationPipe(adsQuerySchema)) query: AdsQuery,
  ): Promise<AdDeliveryList> {
    await this.rateLimit.consume(`${clientIp(this.auth, req)}|/ads`, AD_DELIVERY_LIMIT);
    return this.delivery.deliver(query);
  }

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'sendAdEvents',
    summary: 'Impressões e cliques em lote (sem login)',
    description:
      'RF-ADS-08. Até 50 eventos, cada um com o `deliveryToken` da peça. Token inválido, adulterado ou vencido é descartado sem erro, e cada token conta no máximo uma impressão e um clique (RN-ADS-04). Clique de entrega sem impressão contada grava a impressão junto, então os cliques nunca passam das impressões. A soma vai para o contador diário da peça (dia de `America/Sao_Paulo`); nada de usuário, aparelho ou IP fica gravado (RN-ADS-03). Responde 202 com quantos eventos do lote foram contados. Rate limit por IP (120 envios e 600 eventos por minuto): 429 `TOO_MANY_REQUESTS`, com `X-Retry-After`.',
  })
  @ApiZodBody(schemas.events)
  @ApiZodResponse(schemas.eventsResult, HttpStatus.ACCEPTED)
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async sendEvents(
    @Req() req: Request,
    @Body(new ZodValidationPipe(adEventsInputSchema)) body: AdEventsInput,
  ): Promise<AdEventsResult> {
    const ip = clientIp(this.auth, req);
    await this.rateLimit.consume(`${ip}|/ads/events`, AD_EVENTS_LIMIT);
    await this.rateLimit.consume(
      `${ip}|/ads/events:items`,
      AD_EVENT_ITEMS_LIMIT,
      body.events.length,
    );
    return this.events.record(body);
  }
}
