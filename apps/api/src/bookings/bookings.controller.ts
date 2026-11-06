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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  availabilityQuerySchema,
  type ConfirmSuggestedUserInput,
  cancelBookingSchema,
  confirmSuggestedUserSchema,
  createBookingSchema,
  createInvitesSchema,
  myBookingsQuerySchema,
  updateBookingSchema,
} from '@space-sports/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, Public } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { uuidParam } from '../common/uuid-param.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ContactLinksService } from '../contacts/contact-links.service.js';
import { ApiZodBody } from '../openapi/zod-openapi.js';
import { ApiIdempotencyKey, IdempotencyKey } from '../payments/idempotency-key.js';
import { AvailabilityService } from './availability.service.js';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
  CancelBookingDto,
  CreateBookingDto,
  CreateInvitesDto,
  InvitePreviewDto,
  MyBookingsQueryDto,
  PlayerBookingDetailDto,
  PlayerBookingPageDto,
  UpdateBookingDto,
} from './bookings.dto.js';
import { bookingSchemas } from './bookings.openapi.js';
import { BookingsService } from './bookings.service.js';
import { InvitesService } from './invites.service.js';

@ApiTags('bookings')
@Controller('spaces/:spaceId/availability')
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    operationId: 'getSpaceAvailability',
    summary: 'Grade de horários livres por quadra (público)',
    description:
      'RF-BOOK-01/RF-BOOK-02: slots de 30 em 30 min na data local do espaço para a duração e o esporte, respeitando funcionamento, duração mín./máx., antecedência mínima e janela (RN-BOOK-02, RN-BOOK-06). Pública, salvo com `excludeBookingId` (RN-BOOK-12), que exige a sessão do organizador da reserva.',
  })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiUnauthorizedResponse({
    description: '`UNAUTHENTICATED`: `excludeBookingId` sem sessão válida.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      '`USER_BLOCKED` ou `ACCOUNT_INACTIVE`: `excludeBookingId` com conta bloqueada pelo Super ou inativada pelo titular.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      '`SPACE_NOT_FOUND`. `BOOKING_NOT_FOUND`: `excludeBookingId` não é uma reserva sua neste espaço.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '`SPACE_NOT_BOOKABLE` ou `DURATION_OUT_OF_RANGE`.',
    type: ErrorResponseDto,
  })
  async get(
    @Param('spaceId', uuidParam) spaceId: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AvailabilityResponseDto> {
    // A rota não lê a sessão (`@Public`); só ignorar uma reserva depende de quem pede.
    const auth = query.excludeBookingId ? await this.auth.requireSession(req, res) : undefined;
    return this.availability.forDate(spaceId, query, auth?.user.id);
  }
}

@ApiTags('bookings')
@ApiAuth()
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly invites: InvitesService,
    private readonly links: ContactLinksService,
  ) {}

  @Post()
  @ApiIdempotencyKey()
  @ApiOperation({
    operationId: 'createBooking',
    summary: 'Reservar um horário',
    description:
      'RF-BOOK-01, RN-BOOK-01..07. Preço recalculado pela API. Conflito de horário (inclusive concorrente) responde 409 `SLOT_UNAVAILABLE`. Pagamento online (RF-ONPAY-03, RN-ONPAY-02): `paymentOption` conforme o modo do espaço; em `ONLINE_REQUIRED` a reserva nasce `PENDING_PAYMENT` com `paymentDueAt` (15 min) e `ON_SITE` responde 422 `ONLINE_PAYMENT_REQUIRED`; nos outros modos nasce confirmada. Forma online sem o modo permitir: 422 `ONLINE_PAYMENT_UNAVAILABLE`. A cobrança vem em `onlinePayment` (Pix com QR e copia e cola; cartão aprovado já confirma; recusado deixa a reserva aguardando e a nova tentativa vai para `POST /v1/bookings/{id}/payment`). A mesma `Idempotency-Key` com o mesmo pedido devolve a reserva já criada (decisão 96); com outro pedido (quadra, esporte, horário, duração, pessoas, forma pretendida ou `paymentOption`; o `cardToken` não conta), 422 `IDEMPOTENCY_KEY_REUSED`.',
  })
  @ApiCreatedResponse({ type: PlayerBookingDetailDto })
  @ApiNotFoundResponse({
    description: '`SPACE_NOT_FOUND`, `COURT_NOT_FOUND`.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({ description: '`SLOT_UNAVAILABLE`.', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      '`SPACE_NOT_BOOKABLE`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `PEOPLE_EXCEED_CAPACITY`, `INVALID_DURATION`, `DURATION_OUT_OF_RANGE`, `MISALIGNED_START`, `OUTSIDE_OPENING_HOURS`, `BOOKING_IN_THE_PAST`, `BOOKING_TOO_SOON`, `BOOKING_BEYOND_WINDOW`.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingDto,
  ): Promise<PlayerBookingDetailDto> {
    return this.bookings.createForPlayer(user.id, body, idempotencyKey);
  }

  @Get()
  @ApiOperation({
    operationId: 'listMyBookings',
    summary: 'Minhas reservas (próximas ou passadas)',
    description: 'RF-BOOK-03: reservas que organizo ou em que aceitei o convite.',
  })
  @ApiOkResponse({ type: PlayerBookingPageDto })
  listMine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(myBookingsQuerySchema)) query: MyBookingsQueryDto,
  ): Promise<PlayerBookingPageDto> {
    return this.bookings.listMine(user.id, query);
  }

  @Get(':bookingId')
  @ApiOperation({ operationId: 'getMyBooking', summary: 'Detalhe de uma reserva minha' })
  @ApiOkResponse({ type: PlayerBookingDetailDto })
  @ApiNotFoundResponse({ description: '`BOOKING_NOT_FOUND`.', type: ErrorResponseDto })
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', uuidParam) bookingId: string,
  ): Promise<PlayerBookingDetailDto> {
    return this.bookings.getMine(user.id, bookingId);
  }

  @Patch(':bookingId')
  @ApiOperation({
    operationId: 'updateMyBooking',
    summary: 'Editar minha reserva (pessoas, data, horário e duração)',
    description:
      'RF-BOOK-03, RN-BOOK-10 a RN-BOOK-13: só o organizador, em reserva confirmada do app; a quadra não muda. Pessoas até o início; data, horário e duração até `cancellableUntil` e sem pagamento registrado. O preço recalcula pelo valor/hora guardado e as partes por RN-BOOK-09. Enviar os valores atuais não muda nada. Os motivos de recusa são os mesmos de `peopleEditBlock` e `scheduleEditBlock` no detalhe.',
  })
  @ApiOkResponse({ type: PlayerBookingDetailDto })
  @ApiForbiddenResponse({
    description:
      '`SPACE_READ_ONLY`: espaço suspenso ou encerrado. `USER_BLOCKED`: conta bloqueada pelo Super. `ACCOUNT_INACTIVE`: conta inativada pelo titular (RF-AUTH-03).',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: '`BOOKING_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: '`INVALID_BOOKING_STATUS`, `SLOT_UNAVAILABLE`.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`BOOKING_ENDED`, `BOOKING_NOT_EDITABLE`, `BOOKING_STARTED`, `BOOKING_EDIT_DEADLINE_PASSED`, `BOOKING_HAS_PAYMENT` ("fale com o espaço"), `PEOPLE_EXCEED_CAPACITY`, `PEOPLE_BELOW_PARTICIPANTS`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `INVALID_DURATION`, `DURATION_OUT_OF_RANGE`, `MISALIGNED_START`, `OUTSIDE_OPENING_HOURS`, `BOOKING_IN_THE_PAST`, `BOOKING_TOO_SOON`, `BOOKING_BEYOND_WINDOW`.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', uuidParam) bookingId: string,
    @Body(new ZodValidationPipe(updateBookingSchema)) body: UpdateBookingDto,
  ): Promise<PlayerBookingDetailDto> {
    return this.bookings.updateByPlayer(user.id, bookingId, body);
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'cancelMyBooking',
    summary: 'Cancelar minha reserva dentro do prazo',
    description: 'RN-BOOK-05: só o organizador, até `cancellableUntil`. Libera a quadra.',
  })
  @ApiOkResponse({ type: PlayerBookingDetailDto })
  @ApiNotFoundResponse({ description: '`BOOKING_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`INVALID_BOOKING_STATUS`.', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: '`CANCELLATION_DEADLINE_PASSED` ("fale com o espaço").',
    type: ErrorResponseDto,
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', uuidParam) bookingId: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingDto,
  ): Promise<PlayerBookingDetailDto> {
    return this.bookings.cancelByPlayer(user.id, bookingId, body);
  }

  @Post(':bookingId/invites')
  @ApiOperation({
    operationId: 'createBookingInvites',
    summary: 'Dividir a conta: convidar jogadores',
    description:
      'RF-BOOK-04, RN-BOOK-09, RF-CONTACT-01: cria convites com a parte de cada um; o organizador fica com a diferença do arredondamento. `names` gera convites por link; `items` aceita também WhatsApp ou e-mail, que vão para a base de contatos, e item sem nome vira vaga aberta; `userIds` convida usuários do app (eles recebem a notificação e só eles aceitam).',
  })
  @ApiCreatedResponse({ type: PlayerBookingDetailDto })
  @ApiNotFoundResponse({
    description: '`BOOKING_NOT_FOUND`, `INVITEE_NOT_FOUND`.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '`BOOKING_NOT_SPLITTABLE`, `TOO_MANY_INVITES`.',
    type: ErrorResponseDto,
  })
  createInvites(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', uuidParam) bookingId: string,
    @Body(new ZodValidationPipe(createInvitesSchema)) body: CreateInvitesDto,
  ): Promise<PlayerBookingDetailDto> {
    return this.invites.create(user.id, bookingId, body);
  }

  @Post(':bookingId/invites/:participantId/confirm-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'confirmInviteLink',
    summary: 'Vincular o convidado à conta sugerida',
    description:
      'RF-CONTACT-05: telefone não vincula sozinho; o organizador confirma o `suggestedUser` do participante. Convite pendente vira convite direto à conta; confirmado entra em Minhas reservas. Em reserva terminada ou cancelada, só o contato é vinculado. Rate limit por usuário: 429 `TOO_MANY_REQUESTS`.',
  })
  @ApiZodBody(bookingSchemas.confirmSuggestedUser)
  @ApiOkResponse({ type: PlayerBookingDetailDto })
  @ApiNotFoundResponse({
    description: '`BOOKING_NOT_FOUND`, `INVITE_NOT_FOUND`.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({ description: '`SUGGESTED_USER_MISMATCH`.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async confirmInviteLink(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', uuidParam) bookingId: string,
    @Param('participantId', uuidParam) participantId: string,
    @Body(new ZodValidationPipe(confirmSuggestedUserSchema)) body: ConfirmSuggestedUserInput,
  ): Promise<PlayerBookingDetailDto> {
    await this.links.confirmParticipant(user.id, bookingId, participantId, body.userId);
    return this.bookings.getMine(user.id, bookingId);
  }

  @Delete(':bookingId/invites/:participantId')
  @ApiOperation({
    operationId: 'revokeBookingInvite',
    summary: 'Desfazer um convite pendente',
  })
  @ApiOkResponse({ type: PlayerBookingDetailDto })
  @ApiNotFoundResponse({
    description:
      '`BOOKING_NOT_FOUND`, `INVITE_NOT_FOUND` (inclui convite já aceito ou com pagamento).',
    type: ErrorResponseDto,
  })
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', uuidParam) bookingId: string,
    @Param('participantId', uuidParam) participantId: string,
  ): Promise<PlayerBookingDetailDto> {
    return this.invites.revoke(user.id, bookingId, participantId);
  }
}

export const tokenParam = new ZodValidationPipe(z.string().min(1).max(200));

@ApiTags('bookings')
@ApiAuth()
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get(':token')
  @ApiOperation({ operationId: 'getInvite', summary: 'Prévia do convite (deep link)' })
  @ApiOkResponse({ type: InvitePreviewDto })
  @ApiNotFoundResponse({ description: '`INVITE_NOT_FOUND`.', type: ErrorResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('token', tokenParam) token: string,
  ): Promise<InvitePreviewDto> {
    return this.invites.preview(user.id, token);
  }

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'acceptInvite',
    summary: 'Aceitar o convite (idempotente)',
    description:
      'RF-CONTACT-03: o convite e o contato dele passam para a conta da sessão. A presença confirmada sem conta pela página pública só vem para a conta com e-mail verificado ou telefone igual ao contato do participante; para outra conta, 409 `INVITE_SLOT_TAKEN`.',
  })
  @ApiOkResponse({ type: InvitePreviewDto })
  @ApiNotFoundResponse({ description: '`INVITE_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: '`INVITE_UNAVAILABLE`, `INVITE_SLOT_TAKEN`, `ALREADY_PARTICIPANT`.',
    type: ErrorResponseDto,
  })
  accept(
    @CurrentUser() user: AuthUser,
    @Param('token', tokenParam) token: string,
  ): Promise<InvitePreviewDto> {
    return this.invites.accept(user.id, token);
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'declineInvite', summary: 'Recusar o convite' })
  @ApiOkResponse({ type: InvitePreviewDto })
  @ApiNotFoundResponse({ description: '`INVITE_NOT_FOUND`.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: '`INVITE_UNAVAILABLE`.', type: ErrorResponseDto })
  decline(
    @CurrentUser() user: AuthUser,
    @Param('token', tokenParam) token: string,
  ): Promise<InvitePreviewDto> {
    return this.invites.decline(user.id, token);
  }
}
