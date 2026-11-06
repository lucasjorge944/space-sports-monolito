import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { recurringReasonSchema, requestRecurringBookingSchema } from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { uuidParam } from '../common/uuid-param.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  RecurringBookingDetailDto,
  RecurringBookingDto,
  RecurringReasonDto,
  RequestRecurringBookingDto,
} from './recurring.dto.js';
import { RecurringBookingsService } from './recurring-bookings.service.js';

const notFound = (codes: string) =>
  ApiNotFoundResponse({ description: codes, type: ErrorResponseDto });

/** Mensalista na visão do jogador (RF-BOOK-05): solicita, acompanha o status e encerra o seu. */
@ApiTags('recurring-bookings')
@ApiAuth()
@Controller('recurring-bookings')
export class RecurringBookingsController {
  constructor(private readonly recurring: RecurringBookingsService) {}

  @Post()
  @ApiOperation({
    operationId: 'requestRecurringBooking',
    summary: 'Solicitar horário fixo semanal (mensalista)',
    description:
      'RF-BOOK-05: dia da semana + horário + quadra + duração (múltiplos de 30 min, dentro do funcionamento). Nasce `PENDING_APPROVAL`; o espaço aprova ou recusa. Vale o valor mensal geral do espaço (RN-BOOK-08).',
  })
  @ApiCreatedResponse({ type: RecurringBookingDetailDto })
  @notFound('`SPACE_NOT_FOUND`, `COURT_NOT_FOUND`.')
  @ApiConflictResponse({
    description: '`RECURRING_REQUEST_DUPLICATE` (já há solicitação pendente para o mesmo horário).',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`SPACE_NOT_BOOKABLE`, `RECURRING_START_IN_PAST`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `PEOPLE_EXCEED_CAPACITY`, `INVALID_DURATION`, `MISALIGNED_START`, `OUTSIDE_OPENING_HOURS`.',
    type: ErrorResponseDto,
  })
  request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestRecurringBookingSchema)) body: RequestRecurringBookingDto,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.requestForPlayer(user.id, body);
  }

  @Get()
  @ApiOperation({
    operationId: 'listMyRecurringBookings',
    summary: 'Meus horários fixos (mensalista) e o status de cada um',
  })
  @ApiOkResponse({ type: [RecurringBookingDto] })
  listMine(@CurrentUser() user: AuthUser): Promise<RecurringBookingDto[]> {
    return this.recurring.listMine(user.id);
  }

  @Get(':recurringBookingId')
  @ApiOperation({
    operationId: 'getMyRecurringBooking',
    summary: 'Detalhe do meu mensalista',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  get(
    @CurrentUser() user: AuthUser,
    @Param('recurringBookingId', uuidParam) id: string,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.getMine(user.id, id);
  }

  @Post(':recurringBookingId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'endMyRecurringBooking',
    summary: 'Encerrar meu mensalista (ou retirar a solicitação pendente)',
    description:
      'Cancela as ocorrências futuras e libera a quadra. Vale para `PENDING_APPROVAL`, `ACTIVE` e `PAUSED`.',
  })
  @ApiOkResponse({ type: RecurringBookingDetailDto })
  @notFound('`RECURRING_BOOKING_NOT_FOUND`.')
  @ApiConflictResponse({ description: '`INVALID_RECURRING_STATUS`.', type: ErrorResponseDto })
  end(
    @CurrentUser() user: AuthUser,
    @Param('recurringBookingId', uuidParam) id: string,
    @Body(new ZodValidationPipe(recurringReasonSchema)) body: RecurringReasonDto,
  ): Promise<RecurringBookingDetailDto> {
    return this.recurring.endByPlayer(user.id, id, body);
  }
}
