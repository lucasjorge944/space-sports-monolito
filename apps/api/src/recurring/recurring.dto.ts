import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type CreateDeskRecurringBookingInput,
  OCCUPATION_KINDS,
  type OccupationKind,
  RECURRING_STATUSES,
  type RecurringBooking,
  type RecurringBookingDetail,
  type RecurringBookingPage,
  type RecurringBookingsQuery,
  type RecurringConflict,
  type RecurringReasonInput,
  type RecurringStatus,
  type RequestRecurringBookingInput,
} from '@space-sports/shared';

// DTOs do OpenAPI espelhando os schemas de @space-sports/shared (recurring.ts, booking.ts). Os de
// entrada implementam a saída do Zod (a validação roda no ZodValidationPipe); os de resposta, os
// tipos da resposta. O `implements` mantém os dois em sincronia na compilação.

const dateTime = { type: String, format: 'date-time' } as const;
const uuid = { type: String, format: 'uuid' } as const;
const date = { type: String, format: 'date' } as const;
const recurringStatus = { enum: RECURRING_STATUSES, enumName: 'RecurringStatus' } as const;

// ---------------------------------------------------------------------------------------------
// Entrada

class RecurringSlotInputDto {
  @ApiProperty(uuid)
  courtId!: string;

  @ApiProperty(uuid)
  sportId!: string;

  @ApiProperty({ example: 2, minimum: 0, maximum: 6, description: '0 = domingo … 6 = sábado.' })
  weekday!: number;

  @ApiProperty({
    example: '19:30',
    description: 'Horário local do espaço (HH:MM), em hora cheia ou meia hora.',
  })
  startTime!: string;

  @ApiProperty({ example: 90, description: 'Minutos, múltiplo de 30 (RN-BOOK-02).' })
  durationMin!: number;

  @ApiProperty({ example: 4, description: 'RN-BOOK-04: até a capacidade da quadra no esporte.' })
  peopleCount!: number;

  @ApiPropertyOptional({
    ...date,
    description: 'Primeira data (local) em que vale. Padrão: hoje; não pode ser anterior a hoje.',
  })
  startsOn?: string;
}

export class RequestRecurringBookingDto
  extends RecurringSlotInputDto
  implements RequestRecurringBookingInput
{
  @ApiProperty(uuid)
  spaceId!: string;
}

export class CreateDeskRecurringBookingDto
  extends RecurringSlotInputDto
  implements CreateDeskRecurringBookingInput
{
  @ApiPropertyOptional({
    ...uuid,
    description: 'Cliente com app. Exclusivo com guestName/guestPhone.',
  })
  customerUserId?: string;

  @ApiPropertyOptional({ example: 'João Silva', description: 'Cliente sem app (com guestPhone).' })
  guestName?: string;

  @ApiPropertyOptional({
    example: '+5531999998888',
    description:
      'E.164. Entra na base de contatos. Se for o telefone de uma conta, a gestão vê `suggestedUser` nas ocorrências e confirma o vínculo: telefone não vincula sozinho (RF-CONTACT-05).',
  })
  guestPhone?: string;
}

export class RecurringReasonDto implements RecurringReasonInput {
  @ApiPropertyOptional({ maxLength: 500 })
  reason?: string;
}

export class RecurringBookingsQueryDto implements RecurringBookingsQuery {
  @ApiPropertyOptional({ ...recurringStatus, isArray: true })
  status?: RecurringStatus[];

  @ApiPropertyOptional(uuid)
  courtId?: string;

  @ApiPropertyOptional({ description: 'Nome ou telefone do mensalista.' })
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  limit!: number;

  @ApiPropertyOptional({ description: '`nextCursor` da página anterior.' })
  cursor?: string;
}

// ---------------------------------------------------------------------------------------------
// Respostas

type Customer = RecurringBooking['customer'];

export class RecurringCustomerDto implements Customer {
  @ApiProperty({ ...uuid, nullable: true, description: 'Nulo no cliente cadastrado sem app.' })
  userId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Só para a gestão (cliente cadastrado sem app).',
  })
  phone!: string | null;
}

class RecurringCourtDto {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty()
  name!: string;
}

class RecurringSpaceDto {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  timeZone!: string;
}

class RecurringSportDto {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class RecurringConflictDto implements RecurringConflict {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty(uuid)
  recurringBookingId!: string;

  @ApiProperty({ type: RecurringCourtDto })
  court!: RecurringCourtDto;

  @ApiProperty({ type: RecurringCustomerDto })
  customer!: RecurringCustomerDto;

  @ApiProperty({ ...dateTime, description: 'Ocorrência que não coube na agenda.' })
  startsAt!: string;

  @ApiProperty(dateTime)
  endsAt!: string;

  @ApiProperty({
    enum: OCCUPATION_KINDS,
    enumName: 'OccupationKind',
    description: 'O que ocupa o horário: bloqueio, torneio, aula ou outra reserva.',
  })
  conflictsWith!: OccupationKind;

  @ApiProperty(dateTime)
  createdAt!: string;
}

export class RecurringBookingDto implements RecurringBooking {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ type: RecurringSpaceDto })
  space!: RecurringSpaceDto;

  @ApiProperty({ type: RecurringCourtDto })
  court!: RecurringCourtDto;

  @ApiProperty({ type: RecurringSportDto })
  sport!: RecurringSportDto;

  @ApiProperty({ type: RecurringCustomerDto })
  customer!: RecurringCustomerDto;

  @ApiProperty({ description: '0 = domingo … 6 = sábado.' })
  weekday!: number;

  @ApiProperty({ example: '19:30', description: 'Horário local do espaço.' })
  startTime!: string;

  @ApiProperty()
  durationMin!: number;

  @ApiProperty()
  peopleCount!: number;

  @ApiProperty(date)
  startsOn!: string;

  @ApiProperty({ ...date, nullable: true })
  endsOn!: string | null;

  @ApiProperty(recurringStatus)
  status!: RecurringStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Motivo informado ao recusar, pausar ou encerrar.',
  })
  statusReason!: string | null;

  @ApiProperty(dateTime)
  createdAt!: string;
}

export class RecurringBookingDetailDto
  extends RecurringBookingDto
  implements RecurringBookingDetail
{
  @ApiProperty({
    type: [RecurringConflictDto],
    description: 'Ocorrências em aberto que conflitam com a agenda.',
  })
  conflicts!: RecurringConflictDto[];
}

export class RecurringBookingPageDto implements RecurringBookingPage {
  @ApiProperty({ type: [RecurringBookingDto] })
  items!: RecurringBookingDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
