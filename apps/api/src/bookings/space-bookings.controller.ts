import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  type PipeTransform,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type ConfirmSuggestedUserInput,
  cancelBookingSchema,
  canInSpace,
  confirmSuggestedUserSchema,
  courtBlocksQuerySchema,
  createCourtBlockSchema,
  createDeskBookingSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  spaceBookingsQuerySchema,
} from '@space-sports/shared';
import type { AuthUser, SpaceAccess } from '../auth/auth-context.js';
import { ApiAuth, CurrentSpaceAccess, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { uuidParam } from '../common/uuid-param.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ContactLinksService } from '../contacts/contact-links.service.js';
import { ApiZodBody } from '../openapi/zod-openapi.js';
import { detailWithoutMoney } from './booking-views.js';
import {
  BookingDetailDto,
  CancelBookingDto,
  CourtBlockDto,
  CourtBlocksQueryDto,
  CreateCourtBlockDto,
  CreateDeskBookingDto,
  PaymentRecordDto,
  ReceivablesTodayDto,
  RecordPaymentDto,
  ReversePaymentDto,
  SpaceBookingDetailDto,
  SpaceBookingPageDto,
  SpaceBookingsQueryDto,
} from './bookings.dto.js';
import { participantPaymentNotAllowed } from './bookings.errors.js';
import { bookingSchemas } from './bookings.openapi.js';
import { BookingsService } from './bookings.service.js';
import { CourtBlocksService } from './court-blocks.service.js';
import { PaymentsService } from './payments.service.js';

const notFound = (codes: string) =>
  ApiNotFoundResponse({ description: codes, type: ErrorResponseDto });

/**
 * Decisão 50: o tipo saiu do contrato, mas quem ainda o envia recebe o motivo em vez do 400
 * genérico da validação.
 */
const rejectParticipantPayable: PipeTransform = {
  transform(body: { payableType?: unknown } | undefined) {
    if (body?.payableType === 'BOOKING_PARTICIPANT') throw participantPaymentNotAllowed();
    return body;
  },
};

/** Decisão 53: valores, pagamentos e convites da reserva só para quem registra pagamentos. */
const seesMoney = (access: SpaceAccess | undefined) =>
  canInSpace(access?.roles ?? [], 'payment.record');

/**
 * Gestão de reservas no painel do espaço (RF-BOOK-06, RF-BOOK-08, RF-PAY-01, RF-PAY-03). O
 * `:spaceId` passa pelo guard de papel (matriz de permissões em packages/shared) e toda
 * consulta filtra por ele.
 */
@ApiTags('space-bookings')
@ApiAuth()
@Controller('manage/spaces/:spaceId')
export class SpaceBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly blocks: CourtBlocksService,
    private readonly payments: PaymentsService,
    private readonly links: ContactLinksService,
  ) {}

  @Get('bookings')
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'listSpaceBookings',
    summary: 'Reservas do espaço com filtros',
    description:
      'Decisão 53: sem `payment.record` (Professor), os valores e a situação do pagamento chegam nulos e o filtro `paymentStatus` é ignorado.',
  })
  @ApiOkResponse({ type: SpaceBookingPageDto })
  list(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(spaceBookingsQuerySchema)) query: SpaceBookingsQueryDto,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<SpaceBookingPageDto> {
    return this.bookings.listForSpace(spaceId, query, { money: seesMoney(access) });
  }

  @Get('bookings/:bookingId')
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'getSpaceBooking',
    summary: 'Detalhe da reserva com participantes e pagamentos',
    description:
      'Decisão 53: sem `payment.record` (Professor), os valores, as partes e o convite (token e link) chegam nulos e `payments` vem vazio.',
  })
  @ApiOkResponse({ type: SpaceBookingDetailDto })
  @notFound('`BOOKING_NOT_FOUND`.')
  async get(
    @Param('spaceId') spaceId: string,
    @Param('bookingId', uuidParam) bookingId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<SpaceBookingDetailDto> {
    // O Professor só visualiza a agenda: não vincula conta, então não consulta telefone.
    const canLink = canInSpace(access?.roles ?? [], 'booking.create');
    const detail = await this.bookings.getForSpace(
      spaceId,
      bookingId,
      canLink ? user.id : undefined,
    );
    return seesMoney(access) ? detail : detailWithoutMoney(detail);
  }

  @Post('bookings/:bookingId/confirm-link')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'confirmDeskCustomerLink',
    summary: 'Vincular o cliente de balcão à conta sugerida',
    description:
      'RF-CONTACT-05: telefone não vincula sozinho; a gestão confirma o `suggestedUser` da reserva, que entra em Minhas reservas do cliente. Em ocorrência de mensalista, vale para o mensalista e as próximas ocorrências abertas. Em reserva terminada ou cancelada, só o contato é vinculado. Rate limit por usuário: 429 `TOO_MANY_REQUESTS`.',
  })
  @ApiZodBody(bookingSchemas.confirmSuggestedUser)
  @ApiOkResponse({ type: BookingDetailDto })
  @notFound('`BOOKING_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`SUGGESTED_USER_MISMATCH`.', type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async confirmLink(
    @Param('spaceId') spaceId: string,
    @Param('bookingId', uuidParam) bookingId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(confirmSuggestedUserSchema)) body: ConfirmSuggestedUserInput,
  ): Promise<BookingDetailDto> {
    await this.links.confirmDeskCustomer(spaceId, user.id, bookingId, body.userId);
    return this.bookings.getForSpace(spaceId, bookingId, user.id);
  }

  @Post('bookings')
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'createDeskBooking',
    summary: 'Reserva de balcão',
    description:
      'RF-BOOK-06: cliente com app (`customerUserId`) ou sem app (`guestName` + `guestPhone`). Mantém a fração de 30 min, o funcionamento e a capacidade; dispensa antecedência, janela e duração mín./máx.',
  })
  @ApiCreatedResponse({ type: BookingDetailDto })
  @notFound('`COURT_NOT_FOUND`, `CUSTOMER_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`SLOT_UNAVAILABLE`.', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      '`SPACE_NOT_BOOKABLE`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `PEOPLE_EXCEED_CAPACITY`, `INVALID_DURATION`, `MISALIGNED_START`, `OUTSIDE_OPENING_HOURS`, `BOOKING_IN_THE_PAST`.',
    type: ErrorResponseDto,
  })
  createDesk(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDeskBookingSchema)) body: CreateDeskBookingDto,
  ): Promise<BookingDetailDto> {
    return this.bookings.createAtDesk(spaceId, user.id, body);
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'cancelSpaceBooking',
    summary: 'Cancelar reserva (gestão, a qualquer momento)',
    description: 'RN-BOOK-05: sem prazo para a gestão; libera a quadra e fica na auditoria.',
  })
  @ApiOkResponse({ type: BookingDetailDto })
  @notFound('`BOOKING_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`INVALID_BOOKING_STATUS`.', type: ErrorResponseDto })
  cancel(
    @Param('spaceId') spaceId: string,
    @Param('bookingId', uuidParam) bookingId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingDto,
  ): Promise<BookingDetailDto> {
    return this.bookings.cancelByStaff(spaceId, user.id, bookingId, body);
  }

  @Post('bookings/:bookingId/complete')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'completeSpaceBooking',
    summary: 'Marcar como concluída (RF-BOOK-08)',
  })
  @ApiOkResponse({ type: BookingDetailDto })
  @notFound('`BOOKING_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`INVALID_BOOKING_STATUS`.', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: '`BOOKING_NOT_STARTED`.', type: ErrorResponseDto })
  complete(
    @Param('spaceId') spaceId: string,
    @Param('bookingId', uuidParam) bookingId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingDetailDto> {
    return this.bookings.finish(spaceId, user.id, bookingId, 'COMPLETED');
  }

  @Post('bookings/:bookingId/no-show')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({ operationId: 'markSpaceBookingNoShow', summary: 'Marcar no-show (RF-BOOK-08)' })
  @ApiOkResponse({ type: BookingDetailDto })
  @notFound('`BOOKING_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`INVALID_BOOKING_STATUS`.', type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: '`BOOKING_NOT_STARTED`.', type: ErrorResponseDto })
  noShow(
    @Param('spaceId') spaceId: string,
    @Param('bookingId', uuidParam) bookingId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingDetailDto> {
    return this.bookings.finish(spaceId, user.id, bookingId, 'NO_SHOW');
  }

  @Get('court-blocks')
  @SpacePermission('schedule.view')
  @ApiOperation({ operationId: 'listCourtBlocks', summary: 'Bloqueios no período' })
  @ApiOkResponse({ type: [CourtBlockDto] })
  listBlocks(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(courtBlocksQuerySchema)) query: CourtBlocksQueryDto,
  ): Promise<CourtBlockDto[]> {
    return this.blocks.list(spaceId, query);
  }

  @Post('court-blocks')
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'createCourtBlock',
    summary: 'Bloquear horário da quadra (manutenção, evento)',
    description: 'RF-BOOK-06. Conflito com reserva/aula/jogo/bloqueio: 409 `SLOT_UNAVAILABLE`.',
  })
  @ApiCreatedResponse({ type: CourtBlockDto })
  @notFound('`COURT_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`SLOT_UNAVAILABLE`.', type: ErrorResponseDto })
  createBlock(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCourtBlockSchema)) body: CreateCourtBlockDto,
  ): Promise<CourtBlockDto> {
    return this.blocks.create(spaceId, user.id, body);
  }

  @Delete('court-blocks/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SpacePermission('booking.create')
  @ApiOperation({ operationId: 'deleteCourtBlock', summary: 'Remover bloqueio' })
  @ApiNoContentResponse()
  @notFound('`COURT_BLOCK_NOT_FOUND`.')
  deleteBlock(
    @Param('spaceId') spaceId: string,
    @Param('blockId', uuidParam) blockId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.blocks.remove(spaceId, user.id, blockId);
  }

  @Post('payments')
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'recordPayment',
    summary: 'Registrar pagamento recebido no espaço',
    description:
      'RF-PAY-01, RF-BOOK-08, RN-PAY-01: da reserva inteira ou da mensalidade de aula (`SUBSCRIPTION_CHARGE`, RF-CLASS-11; quitar volta a assinatura em atraso para `ACTIVE`). O recebimento por participante saiu (decisão 50): `payableType: BOOKING_PARTICIPANT` responde 422 `PARTICIPANT_PAYMENT_NOT_ALLOWED`. O mensalista não tem cobrança na plataforma (decisão 27). Recalcula o status de pagamento e fica na auditoria.',
  })
  @ApiCreatedResponse({ type: PaymentRecordDto })
  @notFound('`PAYABLE_NOT_FOUND`.')
  @ApiConflictResponse({
    description:
      '`BOOKING_NOT_PAYABLE` (cancelada), `CHARGE_NOT_PAYABLE` (mensalidade dispensada).',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '`PAYMENT_EXCEEDS_DUE`, `PARTICIPANT_PAYMENT_NOT_ALLOWED`.',
    type: ErrorResponseDto,
  })
  recordPayment(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(rejectParticipantPayable, new ZodValidationPipe(recordPaymentSchema))
    body: RecordPaymentDto,
  ): Promise<PaymentRecordDto> {
    return this.payments.record(spaceId, user.id, body);
  }

  @Post('payments/:paymentId/reverse')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'reversePayment',
    summary: 'Estornar pagamento',
    description: 'RN-PAY-01: marca o estorno (não apaga), recalcula o status e audita.',
  })
  @ApiOkResponse({ type: PaymentRecordDto })
  @notFound('`PAYMENT_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`PAYMENT_ALREADY_REVERSED`.', type: ErrorResponseDto })
  reversePayment(
    @Param('spaceId') spaceId: string,
    @Param('paymentId', uuidParam) paymentId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reversePaymentSchema)) body: ReversePaymentDto,
  ): Promise<PaymentRecordDto> {
    return this.payments.reverse(spaceId, user.id, paymentId, body);
  }

  @Get('receivables/today')
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'getReceivablesToday',
    summary: 'A receber hoje',
    description:
      'RF-PAY-03: reservas de hoje (fuso do espaço) com pagamento em aberto; `totalDueCents` soma o que falta receber.',
  })
  @ApiOkResponse({ type: ReceivablesTodayDto })
  receivablesToday(@Param('spaceId') spaceId: string): Promise<ReceivablesTodayDto> {
    return this.payments.receivablesToday(spaceId);
  }
}
