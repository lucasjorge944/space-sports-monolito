import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  type ConfirmPublicInviteInput,
  confirmPublicInviteSchema,
  type PublicInvitePreview,
} from '@space-sports/shared';
import type { Request } from 'express';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import { clientIp } from '../auth/client-ip.js';
import { Public } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimiter, type RateLimitRule } from '../contacts/rate-limiter.js';
import { ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { tokenParam } from './bookings.controller.js';
import { bookingSchemas as schemas } from './bookings.openapi.js';
import { InvitesService } from './invites.service.js';

/** Por IP (adivinhar tokens) e por token (o mesmo link aberto de muitos lugares). */
export const PUBLIC_INVITE_LIMITS = {
  read: { ip: { window: 60, max: 30 }, token: { window: 60, max: 30 } },
  answer: { ip: { window: 10 * 60, max: 10 }, token: { window: 10 * 60, max: 5 } },
} as const satisfies Record<string, Record<string, RateLimitRule>>;

const RATE_LIMIT_DESCRIPTION =
  'Rate limit por IP e por token: 429 `TOO_MANY_REQUESTS`, com `X-Retry-After`.';

/** Página pública do convite (`/r/<token>`): quem tem o link responde sem conta (RF-CONTACT-02). */
@ApiTags('bookings')
@Public()
@Controller('public/invites')
export class PublicInvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly rateLimit: RateLimiter,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Get(':token')
  @ApiOperation({
    operationId: 'getPublicInvite',
    summary: 'Prévia pública do convite',
    description: `RF-CONTACT-02: espaço, quadra, esporte, data e hora, primeiro nome do organizador, parte do valor, status e \`slotTaken\` (alguém já ficou com a vaga). Nunca traz telefone, e-mail, dados de outros convidados nem ids internos. ${RATE_LIMIT_DESCRIPTION}`,
  })
  @ApiZodResponse(schemas.publicInvite)
  @ApiNotFoundResponse({ description: '`INVITE_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async preview(
    @Req() req: Request,
    @Param('token', tokenParam) token: string,
  ): Promise<PublicInvitePreview> {
    await this.limit(req, token, PUBLIC_INVITE_LIMITS.read);
    return this.invites.publicPreview(token);
  }

  @Post(':token/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'confirmPublicInvite',
    summary: 'Confirmar presença sem conta',
    description: `RF-CONTACT-02: exige nome e WhatsApp ou e-mail; o consentimento de marketing é opcional. O participante fica ACCEPTED sem conta, ligado ao contato, e o organizador é avisado. O e-mail informado aqui não vincula conta. Cada link é uma vaga: repetir com o mesmo telefone ou e-mail responde a mesma prévia, sem mudar nada. ${RATE_LIMIT_DESCRIPTION}`,
  })
  @ApiZodBody(schemas.confirmPublicInvite)
  @ApiZodResponse(schemas.publicInvite)
  @ApiForbiddenResponse({ description: '`SPACE_READ_ONLY`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`INVITE_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({
    description:
      '`INVITE_SLOT_TAKEN`: a vaga já é de outro contato. `INVITE_UNAVAILABLE`: recusado, convite direto a uma conta ou reserva terminada ou cancelada.',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async confirm(
    @Req() req: Request,
    @Param('token', tokenParam) token: string,
    @Body(new ZodValidationPipe(confirmPublicInviteSchema)) body: ConfirmPublicInviteInput,
  ): Promise<PublicInvitePreview> {
    await this.limit(req, token, PUBLIC_INVITE_LIMITS.answer);
    return this.invites.confirmPublic(token, body);
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'declinePublicInvite',
    summary: 'Recusar o convite sem conta',
    description: `RF-CONTACT-02: não pede dados; o organizador é avisado. ${RATE_LIMIT_DESCRIPTION}`,
  })
  @ApiZodResponse(schemas.publicInvite)
  @ApiForbiddenResponse({ description: '`SPACE_READ_ONLY`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`INVITE_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`INVITE_UNAVAILABLE`.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async decline(
    @Req() req: Request,
    @Param('token', tokenParam) token: string,
  ): Promise<PublicInvitePreview> {
    await this.limit(req, token, PUBLIC_INVITE_LIMITS.answer);
    return this.invites.declinePublic(token);
  }

  /** O token vale como credencial: no Redis, só o hash. */
  private async limit(
    req: Request,
    token: string,
    rules: { ip: RateLimitRule; token: RateLimitRule },
  ): Promise<void> {
    const hash = createHash('sha256').update(token).digest('hex');
    await this.rateLimit.consume(`${clientIp(this.auth, req)}|/public/invites`, rules.ip);
    await this.rateLimit.consume(`token:${hash}|/public/invites`, rules.token);
  }
}
