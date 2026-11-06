import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  createDeskRecurringBookingSchema,
  recurringBookingsQuerySchema,
  recurringReasonSchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { uuidParam } from '../common/uuid-param.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  CreateDeskRecurringBookingDto,
  RecurringBookingDetailDto,
  RecurringBookingPageDto,
  RecurringBookingsQueryDto,
  RecurringConflictDto,
  RecurringReasonDto,
} from './recurring.dto.js';
import { RecurringBookingsService } from './recurring-bookings.service.js';

const notFound = (codes: string) =>
  ApiNotFoundResponse({ description: codes, type: ErrorResponseDto });
const invalidStatus = ApiConflictResponse({
  description: '`INVALID_RECURRING_STATUS`.',
  type: ErrorResponseDto,
});
const slotConflict = ApiConflictResponse({
  description:
    '`SLOT_UNAVAILABLE` (reserva ou aula no horário semanal) ou `INVALID_RECURRING_STATUS`.',
  type: ErrorResponseDto,
});

/**
 * Gestão de mensalistas no painel do espaço (RF-BOOK-05, RF-BOOK-07, RN-BOOK-08). Aprovar,
 * recusar, pausar, retomar, encerrar e cadastrar: Dono e Admin (`booking.create`). O `:spaceId`
 * passa pelo guard de papel e toda consulta filtra por ele.
 */
@ApiTags('space-recurring-bookings')
@ApiAuth()
@Controller('manage/spaces/:spaceId')
export class SpaceRecurringController {
  constructor(private readonly recurring: RecurringBookingsService) {}

  @Get('recurring-bookings')
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'listSpaceRecurringBookings',
    summary: 'Mensalistas do espaço (inclusive solicitações pendentes)',
  })
  @ApiOkResponse({ type: RecurringBookingPageDto })
  list(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(recurringBookingsQuerySchema)) query: RecurringBookingsQueryDto,
  ): Promise<RecurringBookingPageDto> {
    return this.recurring.listForSpace(spaceId, query);
  }

  @Post('recurring-bookings')
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'createDeskRecurringBooking',
    summary: 'Cadastrar mensalista (nasce ativo)',
    description:
      'RF-BOOK-05: cliente com app (`customerUserId`) ou sem app (`guestName` + `guestPhone`). Gera as ocorrências das próximas 4 semanas (sem cobrança: o pagamento é direto no espaço).',
  })
  @ApiCreatedResponse({ type: RecurringBookingDetailDto })
  @notFound('`COURT_NOT_FOUND`, `CUSTOMER_NOT_FOUND`.')
  @slotConflict
  @ApiUnprocessableEntityResponse({
    description:
      '`SPACE_NOT_BOOKABLE`, `RECURRING_START_IN_PAST`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `PEOPLE_EXCEED_CAPACITY`, `INVALID_DURATION`, `MISALIGNED_START`, `OUTSIDE_OPENING_HOURS`.',
    type: ErrorResponseDto,
  })
  createDesk(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDeskRecurringBookingSchema))
    body: CreateDeskRecurringBookingDto,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.createAtDesk(spaceId, user.id, body);
  }

  @Get('recurring-bookings/:recurringBookingId')
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'getSpaceRecurringBooking',
    summary: 'Detalhe do mensalista com conflitos',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  get(
    @Param('spaceId') spaceId: string,
    @Param('recurringBookingId', uuidParam) id: string,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.getForSpace(spaceId, id);
  }

  @Post('recurring-bookings/:recurringBookingId/approve')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'approveRecurringBooking',
    summary: 'Aprovar solicitação de mensalista',
    description:
      'RF-BOOK-07: passa a `ACTIVE` e gera as ocorrências das próximas 4 semanas. Se uma reserva ou aula já ocupa o horário semanal, nada muda e responde 409 `SLOT_UNAVAILABLE`; bloqueio ou torneio pontual não impede a aprovação (a ocorrência é sinalizada).',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`, `COURT_NOT_FOUND`.')
  @slotConflict
  @ApiUnprocessableEntityResponse({
    description: '`SPACE_NOT_BOOKABLE`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`.',
    type: ErrorResponseDto,
  })
  approve(
    @Param('spaceId') spaceId: string,
    @Param('recurringBookingId', uuidParam) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.approve(spaceId, user.id, id);
  }

  @Post('recurring-bookings/:recurringBookingId/reject')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({ operationId: 'rejectRecurringBooking', summary: 'Recusar solicitação' })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  @invalidStatus
  reject(
    @Param('spaceId') spaceId: string,
    @Param('recurringBookingId', uuidParam) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(recurringReasonSchema)) body: RecurringReasonDto,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.reject(spaceId, user.id, id, body);
  }

  @Post('recurring-bookings/:recurringBookingId/pause')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'pauseRecurringBooking',
    summary: 'Pausar mensalista',
    description: 'Cancela as ocorrências futuras que ainda não começaram, e libera a quadra.',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  @invalidStatus
  pause(
    @Param('spaceId') spaceId: string,
    @Param('recurringBookingId', uuidParam) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(recurringReasonSchema)) body: RecurringReasonDto,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.pause(spaceId, user.id, id, body);
  }

  @Post('recurring-bookings/:recurringBookingId/resume')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'resumeRecurringBooking',
    summary: 'Retomar mensalista pausado',
    description:
      'Volta a `ACTIVE` e regenera as ocorrências das próximas 4 semanas; 409 `SLOT_UNAVAILABLE` se o horário foi ocupado enquanto estava pausado.',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  @slotConflict
  resume(
    @Param('spaceId') spaceId: string,
    @Param('recurringBookingId', uuidParam) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.resume(spaceId, user.id, id);
  }

  @Post('recurring-bookings/:recurringBookingId/end')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('booking.create')
  @ApiOperation({
    operationId: 'endRecurringBooking',
    summary: 'Encerrar mensalista',
    description: 'Definitivo: cancela as ocorrências futuras e libera a quadra.',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  @invalidStatus
  end(
    @Param('spaceId') spaceId: string,
    @Param('recurringBookingId', uuidParam) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(recurringReasonSchema)) body: RecurringReasonDto,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.endByStaff(spaceId, user.id, id, body);
  }

  @Get('recurring-conflicts')
  @SpacePermission('schedule.view')
  @ApiOperation({
    operationId: 'listRecurringConflicts',
    summary: 'Ocorrências de mensalista em conflito com a agenda',
    description:
      'RN-BOOK-08: ocorrências que o job não conseguiu gerar por causa de bloqueio, torneio, aula ou reserva. Somem da lista quando o horário volta a caber ou o mensalista é pausado/encerrado.',
  })
  @ApiOkResponse({ type: [RecurringConflictDto] })
  conflicts(@Param('spaceId') spaceId: string): Promise<RecurringConflictDto[]> {
    return this.recurring.openConflicts(spaceId);
  }
}
