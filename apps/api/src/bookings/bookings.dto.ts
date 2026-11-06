import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  type AvailabilityQuery,
  type AvailabilityResponse,
  BOOKING_EDIT_BLOCK_CODES,
  BOOKING_PAYMENT_STATUSES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  type Booking,
  type BookingDetail,
  type BookingEditBlock,
  type BookingEditBlockCode,
  type BookingParticipant,
  type BookingPaymentStatus,
  type BookingSource,
  type BookingStatus,
  type CancelBookingInput,
  type CourtBlock,
  type CourtBlocksQuery,
  type CreateBookingInput,
  type CreateCourtBlockInput,
  type CreateDeskBookingInput,
  type CreateInvitesInput,
  INVITE_STATUSES,
  type InviteItem,
  type InvitePreview,
  type InviteStatus,
  type MyBookingsQuery,
  type OnlineCharge,
  type OpenOnlineCharge,
  PAYABLE_TYPES,
  PAYMENT_CHANNELS,
  PAYMENT_METHODS,
  PAYMENT_OPTIONS,
  type PayableType,
  type PaymentChannel,
  type PaymentMethod,
  type PaymentOption,
  type PaymentRecord,
  type PlayerBooking,
  type PlayerBookingDetail,
  type PlayerBookingPage,
  type PlayerBookingParticipant,
  type PlayerOnlineCharge,
  RECORDABLE_PAYABLE_TYPES,
  type Receivable,
  type ReceivablesToday,
  type RecordablePayableType,
  type RecordPaymentInput,
  type ReversePaymentInput,
  type SpaceBooking,
  type SpaceBookingDetail,
  type SpaceBookingPage,
  type SpaceBookingParticipant,
  type SpaceBookingsQuery,
  type SuggestedUser,
  type UpdateBookingInput,
} from '@space-sports/shared';

// DTOs do OpenAPI espelhando os schemas de @space-sports/shared (booking.ts). Os de entrada
// implementam a saída do Zod (validação no ZodValidationPipe); os de resposta, os tipos da
// resposta. O `implements` mantém os dois em sincronia na compilação.

const paymentMethod = { enum: PAYMENT_METHODS, enumName: 'PaymentMethod' } as const;
/** Componentes Zod do pagamento online (registrados em payments.openapi.ts). */
const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const dateTime = { type: String, format: 'date-time' } as const;
const uuid = { type: String, format: 'uuid' } as const;

// ---------------------------------------------------------------------------------------------
// Entrada

export class AvailabilityQueryDto implements AvailabilityQuery {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-02',
    description: 'Data local do espaço.',
  })
  date!: string;

  @ApiProperty({ example: 90, description: 'Minutos, múltiplo de 30 (RN-BOOK-02).' })
  durationMin!: number;

  @ApiProperty(uuid)
  sportId!: string;

  @ApiPropertyOptional({ ...uuid, description: 'Só esta quadra.' })
  courtId?: string;

  @ApiPropertyOptional({
    ...uuid,
    description:
      'RN-BOOK-12: reserva em edição, do próprio organizador. Exige sessão; o horário dela conta como livre e os preços usam o valor/hora guardado nela.',
  })
  excludeBookingId?: string;
}

class BookingSlotInputDto {
  @ApiProperty(uuid)
  courtId!: string;

  @ApiProperty(uuid)
  sportId!: string;

  @ApiProperty({ ...dateTime, example: '2026-11-02T21:00:00Z' })
  startsAt!: Date;

  @ApiProperty({ example: 90, description: 'Minutos, múltiplo de 30.' })
  durationMin!: number;

  @ApiProperty({ example: 4, description: 'RN-BOOK-04: até a capacidade da quadra no esporte.' })
  peopleCount!: number;

  @ApiPropertyOptional({ ...paymentMethod, description: 'Informativa (RF-PAY-02).' })
  intendedPaymentMethod?: PaymentMethod;
}

export class CreateBookingDto extends BookingSlotInputDto implements CreateBookingInput {
  @ApiProperty(uuid)
  spaceId!: string;

  @ApiPropertyOptional({
    enum: PAYMENT_OPTIONS,
    enumName: 'PaymentOption',
    description:
      'RF-ONPAY-03: forma escolhida na etapa de pagamento, conforme `onlinePayments.rental.options` do espaço. Padrão `ON_SITE` (recusado no modo `ONLINE_REQUIRED`).',
  })
  paymentOption?: PaymentOption;

  @ApiPropertyOptional({
    description:
      'RN-ONPAY-10: token do cartão gerado no aparelho; só (e sempre) com `ONLINE_CARD`. Nenhum dado do cartão passa pela API.',
  })
  cardToken?: string;
}

export class CreateDeskBookingDto extends BookingSlotInputDto implements CreateDeskBookingInput {
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
      'E.164. Entra na base de contatos. Se for o telefone de uma conta, a gestão vê `suggestedUser` no detalhe e confirma o vínculo: telefone não vincula sozinho (RF-CONTACT-05).',
  })
  guestPhone?: string;
}

export class UpdateBookingDto implements UpdateBookingInput {
  @ApiPropertyOptional({
    example: 4,
    description:
      'RN-BOOK-11: até a capacidade da quadra e nunca menos que 1 + convidados não recusados.',
  })
  peopleCount?: number;

  @ApiPropertyOptional({ ...dateTime, description: 'Novo início (RN-BOOK-12).' })
  startsAt?: Date;

  @ApiPropertyOptional({ example: 90, description: 'Minutos, múltiplo de 30 (RN-BOOK-12).' })
  durationMin?: number;
}

export class CancelBookingDto implements CancelBookingInput {
  @ApiPropertyOptional({ maxLength: 500 })
  reason?: string;
}

export class InviteItemDto implements InviteItem {
  @ApiPropertyOptional({ example: 'Ana', description: 'Sem nome, é vaga aberta.' })
  name?: string;

  @ApiPropertyOptional({ example: '+5531999998888', description: 'E.164.' })
  phone?: string;

  @ApiPropertyOptional({ example: 'ana@exemplo.com' })
  email?: string;
}

export class CreateInvitesDto implements CreateInvitesInput {
  @ApiProperty({
    type: [String],
    example: ['Ana', 'Bruno'],
    required: false,
    default: [],
    description: 'Um convite por nome; no máximo people_count − 1 convites ativos.',
  })
  names!: string[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    required: false,
    default: [],
    description:
      'Convite direto a usuários do app (recebem a notificação); conta junto com `names` e `items` no limite de convites. Pelo menos um nome, usuário ou item.',
  })
  userIds!: string[];

  @ApiProperty({
    type: [InviteItemDto],
    required: false,
    default: [],
    description:
      'RF-CONTACT-01: convites com WhatsApp ou e-mail, que entram na base de contatos. Item vazio é vaga aberta, preenchida na página pública.',
  })
  items!: InviteItemDto[];
}

export class CreateCourtBlockDto implements CreateCourtBlockInput {
  @ApiProperty(uuid)
  courtId!: string;

  @ApiProperty(dateTime)
  startsAt!: Date;

  @ApiProperty(dateTime)
  endsAt!: Date;

  @ApiPropertyOptional({ example: 'Manutenção da rede', maxLength: 500 })
  reason?: string;
}

export class CourtBlocksQueryDto implements CourtBlocksQuery {
  @ApiProperty(dateTime)
  from!: Date;

  @ApiProperty(dateTime)
  to!: Date;

  @ApiPropertyOptional(uuid)
  courtId?: string;
}

export class RecordPaymentDto implements RecordPaymentInput {
  @ApiProperty({
    enum: RECORDABLE_PAYABLE_TYPES,
    enumName: 'RecordablePayableType',
    description:
      'Só a reserva inteira ou a mensalidade de aula. O recebimento por participante saiu (decisão 50) e o mensalista não tem cobrança na plataforma (decisão 27).',
  })
  payableType!: RecordablePayableType;

  @ApiProperty({
    ...uuid,
    description: 'Id da reserva ou da mensalidade, conforme `payableType`.',
  })
  payableId!: string;

  @ApiProperty({ example: 5000, description: 'Centavos; no máximo o valor em aberto.' })
  amountCents!: number;

  @ApiProperty(paymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ ...dateTime, description: 'Padrão: agora.' })
  paidAt?: Date;

  @ApiPropertyOptional({ maxLength: 500 })
  note?: string;
}

export class ReversePaymentDto implements ReversePaymentInput {
  @ApiPropertyOptional({ maxLength: 500 })
  reason?: string;
}

export class MyBookingsQueryDto implements MyBookingsQuery {
  @ApiPropertyOptional({
    enum: ['upcoming', 'past'],
    default: 'upcoming',
    description:
      '`upcoming`: confirmadas que não terminaram (crescente). `past`: as demais (decrescente).',
  })
  when!: 'upcoming' | 'past';

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  limit!: number;

  @ApiPropertyOptional({ description: '`nextCursor` da página anterior.' })
  cursor?: string;
}

export class SpaceBookingsQueryDto implements SpaceBookingsQuery {
  @ApiPropertyOptional({ ...dateTime, description: 'Reservas que terminam depois de `from`.' })
  from?: Date;

  @ApiPropertyOptional({ ...dateTime, description: 'Reservas que começam antes de `to`.' })
  to?: Date;

  @ApiPropertyOptional(uuid)
  courtId?: string;

  @ApiPropertyOptional({ enum: BOOKING_STATUSES, enumName: 'BookingStatus', isArray: true })
  status?: BookingStatus[];

  @ApiPropertyOptional({
    enum: BOOKING_PAYMENT_STATUSES,
    enumName: 'BookingPaymentStatus',
    isArray: true,
  })
  paymentStatus?: BookingPaymentStatus[];

  @ApiPropertyOptional({ enum: BOOKING_SOURCES, enumName: 'BookingSource', isArray: true })
  source?: BookingSource[];

  @ApiPropertyOptional({ description: 'Nome do organizador/cliente ou telefone.' })
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  limit!: number;

  @ApiPropertyOptional({ description: '`nextCursor` da página anterior.' })
  cursor?: string;
}

// ---------------------------------------------------------------------------------------------
// Respostas

type AvailabilityCourt = AvailabilityResponse['courts'][number];
type AvailabilitySlot = AvailabilityCourt['slots'][number];

class AvailabilitySlotDto implements AvailabilitySlot {
  @ApiProperty(dateTime)
  startsAt!: string;

  @ApiProperty(dateTime)
  endsAt!: string;

  @ApiProperty({ description: 'Livre e reservável agora pelo jogador.' })
  available!: boolean;
}

class AvailabilityCourtDto implements AvailabilityCourt {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ example: 'Quadra 1' })
  name!: string;

  @ApiProperty()
  covered!: boolean;

  @ApiProperty({ description: 'RN-BOOK-04: capacidade para o esporte.' })
  maxPlayers!: number;

  @ApiProperty({ type: [AvailabilitySlotDto] })
  slots!: AvailabilitySlotDto[];
}

export class AvailabilityResponseDto implements AvailabilityResponse {
  @ApiProperty({ type: String, format: 'date' })
  date!: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  timeZone!: string;

  @ApiProperty()
  durationMin!: number;

  @ApiProperty()
  pricePerHourCents!: number;

  @ApiProperty({ description: 'RN-BOOK-01: preço da duração pedida.' })
  priceCents!: number;

  @ApiProperty({ type: [AvailabilityCourtDto] })
  courts!: AvailabilityCourtDto[];
}

type BookingSpace = Booking['space'];
type BookingCourt = Booking['court'];
type BookingSport = Booking['sport'];
type BookingOrganizer = Booking['organizer'];

class BookingSpaceDto implements BookingSpace {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  timeZone!: string;
}

class BookingCourtDto implements BookingCourt {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty()
  name!: string;
}

class BookingSportDto implements BookingSport {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

class BookingOrganizerDto implements BookingOrganizer {
  @ApiProperty({ ...uuid, nullable: true, description: 'Nulo no cliente de balcão sem app.' })
  userId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Só para a gestão (balcão).' })
  phone!: string | null;
}

export class BookingDto implements Booking {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ type: BookingSpaceDto })
  space!: BookingSpaceDto;

  @ApiProperty({ type: BookingCourtDto })
  court!: BookingCourtDto;

  @ApiProperty({ type: BookingSportDto })
  sport!: BookingSportDto;

  @ApiProperty({ type: BookingOrganizerDto })
  organizer!: BookingOrganizerDto;

  @ApiProperty(dateTime)
  startsAt!: string;

  @ApiProperty(dateTime)
  endsAt!: string;

  @ApiProperty()
  durationMin!: number;

  @ApiProperty()
  peopleCount!: number;

  @ApiProperty({ description: 'Snapshot do preço/hora na criação.' })
  pricePerHourCents!: number;

  @ApiProperty()
  priceCents!: number;

  @ApiProperty({
    description: 'Pagamentos não estornados (reserva + registros antigos por parte).',
  })
  paidCents!: number;

  @ApiProperty({
    description:
      'Decisão 93: abatimento do estorno manual do pagamento online. Em aberto = priceCents − discountCents − paidCents.',
  })
  discountCents!: number;

  @ApiProperty({
    enum: BOOKING_STATUSES,
    enumName: 'BookingStatus',
    description:
      '`PENDING_PAYMENT`: pagamento online obrigatório pendente; segura o horário até `paymentDueAt` (RN-ONPAY-02).',
  })
  status!: BookingStatus;

  @ApiProperty({ enum: BOOKING_PAYMENT_STATUSES, enumName: 'BookingPaymentStatus' })
  paymentStatus!: BookingPaymentStatus;

  @ApiProperty({ ...paymentMethod, nullable: true })
  intendedPaymentMethod!: PaymentMethod | null;

  @ApiProperty({ enum: BOOKING_SOURCES, enumName: 'BookingSource' })
  source!: BookingSource;

  @ApiProperty({
    ...dateTime,
    nullable: true,
    description: 'RN-ONPAY-02: prazo do pagamento da reserva `PENDING_PAYMENT`; nulo nas demais.',
  })
  paymentDueAt!: string | null;

  @ApiProperty({
    allOf: [schemaRef('OpenOnlineCharge')],
    nullable: true,
    description: 'Cobrança online aberta (Pix pendente), se houver. Nula sem `payment.record`.',
  })
  openOnlineCharge!: OpenOnlineCharge | null;

  @ApiProperty({ ...dateTime, description: 'RN-BOOK-05: o jogador cancela pelo app até aqui.' })
  cancellableUntil!: string;

  @ApiProperty({ ...dateTime, nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Motivo informado, ou `PAYMENT_EXPIRED` (prazo do pagamento online) e `PAYMENT_ABANDONED` (o organizador desistiu antes de pagar).',
  })
  cancelReason!: string | null;

  @ApiProperty(dateTime)
  createdAt!: string;
}

export class BookingParticipantDto implements BookingParticipant {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ ...uuid, nullable: true, description: 'Nulo até o convite ser aceito.' })
  userId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty()
  isOrganizer!: boolean;

  @ApiProperty({
    description: 'RN-BOOK-09: parte de cada um (o organizador fica com a diferença).',
  })
  shareCents!: number;

  @ApiProperty({ enum: INVITE_STATUSES, enumName: 'InviteStatus' })
  status!: InviteStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Só para o organizador e a gestão, com o convite pendente.',
  })
  inviteToken!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://app.spacesports.com.br/r/abc123',
    description: 'Link público do convite. O app segue aceitando `spacesports://convite/<token>`.',
  })
  inviteUrl!: string | null;
}

/** Decisão 53: sem `payment.record`, a parte e o convite chegam nulos. */
export class SpaceBookingParticipantDto
  extends OmitType(BookingParticipantDto, ['shareCents'] as const)
  implements SpaceBookingParticipant
{
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'RN-BOOK-09. Nulo sem `payment.record` (decisão 53).',
  })
  shareCents!: number | null;
}

export class SuggestedUserDto implements SuggestedUser {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ description: 'Só o primeiro nome.' })
  firstName!: string;
}

export class PaymentRecordDto implements PaymentRecord {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ enum: PAYABLE_TYPES, enumName: 'PayableType' })
  payableType!: PayableType;

  @ApiProperty(uuid)
  payableId!: string;

  @ApiProperty({ ...uuid, nullable: true })
  payerUserId!: string | null;

  @ApiProperty()
  amountCents!: number;

  @ApiProperty(paymentMethod)
  method!: PaymentMethod;

  @ApiProperty({
    enum: PAYMENT_CHANNELS,
    enumName: 'PaymentChannel',
    description: '`ONLINE`: pago pelo app (RN-ONPAY-04); só sai pelo estorno da cobrança online.',
  })
  channel!: PaymentChannel;

  @ApiProperty({ ...uuid, nullable: true })
  onlineChargeId!: string | null;

  @ApiProperty(dateTime)
  paidAt!: string;

  @ApiProperty({ ...uuid, nullable: true, description: 'Nulo no pagamento online.' })
  recordedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ ...dateTime, nullable: true })
  reversedAt!: string | null;

  @ApiProperty({ ...uuid, nullable: true })
  reversedBy!: string | null;
}

/** Detalhe para a gestão, com o extrato completo de pagamentos. */
export class BookingDetailDto extends BookingDto implements BookingDetail {
  @ApiProperty({ type: [BookingParticipantDto] })
  participants!: BookingParticipantDto[];

  @ApiProperty({ type: [PaymentRecordDto] })
  payments!: PaymentRecordDto[];

  @ApiProperty({
    type: 'array',
    items: schemaRef('OnlineCharge'),
    description: 'RF-ONPAY-08: cobranças online da reserva, mais recentes primeiro.',
  })
  onlineCharges!: OnlineCharge[];

  @ApiProperty({
    type: SuggestedUserDto,
    nullable: true,
    description:
      'RF-CONTACT-05: conta com o telefone do cliente de balcão, na visualização da reserva e só para quem cria reservas. Nulo também acima da cota de consultas.',
  })
  suggestedUser!: SuggestedUserDto | null;
}

/** Reserva nas leituras da gestão: sem `payment.record`, os valores chegam nulos (decisão 53). */
export class SpaceBookingDto
  extends OmitType(BookingDto, [
    'pricePerHourCents',
    'priceCents',
    'paidCents',
    'discountCents',
    'paymentStatus',
  ] as const)
  implements SpaceBooking
{
  @ApiProperty({ type: Number, nullable: true, description: 'Nulo sem `payment.record`.' })
  discountCents!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Snapshot do preço/hora na criação. Nulo sem `payment.record`.',
  })
  pricePerHourCents!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Nulo sem `payment.record`.' })
  priceCents!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Pagamentos não estornados (reserva + registros antigos por parte). Nulo sem `payment.record`.',
  })
  paidCents!: number | null;

  @ApiProperty({
    enum: BOOKING_PAYMENT_STATUSES,
    enumName: 'BookingPaymentStatus',
    nullable: true,
    description: 'Nulo sem `payment.record`.',
  })
  paymentStatus!: BookingPaymentStatus | null;
}

/** Detalhe da leitura da gestão: sem `payment.record`, `payments` vem vazio (decisão 53). */
export class SpaceBookingDetailDto extends SpaceBookingDto implements SpaceBookingDetail {
  @ApiProperty({ type: [SpaceBookingParticipantDto] })
  participants!: SpaceBookingParticipantDto[];

  @ApiProperty({ type: [PaymentRecordDto] })
  payments!: PaymentRecordDto[];

  @ApiProperty({
    type: 'array',
    items: schemaRef('OnlineCharge'),
    description: 'RF-ONPAY-08: cobranças online; vazio sem `payment.record`.',
  })
  onlineCharges!: OnlineCharge[];

  @ApiProperty({
    type: SuggestedUserDto,
    nullable: true,
    description:
      'RF-CONTACT-05: conta com o telefone do cliente de balcão, na visualização da reserva e só para quem cria reservas. Nulo também acima da cota de consultas.',
  })
  suggestedUser!: SuggestedUserDto | null;
}

type PlayerShare = PlayerBookingDetail['myShare'];

/** Reserva na visão do jogador: total pago e status da reserva inteira só para o organizador. */
export class PlayerBookingDto
  extends OmitType(BookingDto, ['paidCents', 'discountCents', 'paymentStatus'] as const)
  implements PlayerBooking
{
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Abatimento por estorno; nulo para quem não é o organizador.',
  })
  discountCents!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Total pago da reserva; nulo para quem não é o organizador.',
  })
  paidCents!: number | null;

  @ApiProperty({
    enum: BOOKING_PAYMENT_STATUSES,
    enumName: 'BookingPaymentStatus',
    nullable: true,
    description: 'Status da reserva inteira; nulo para quem não é o organizador.',
  })
  paymentStatus!: BookingPaymentStatus | null;

  @ApiProperty({
    ...dateTime,
    description:
      'Hora do servidor, como nas cobranças: a contagem do prazo (`paymentDueAt`) usa a diferença entre ela e o relógio do aparelho.',
  })
  serverTime!: string;
}

export class PlayerBookingParticipantDto implements PlayerBookingParticipant {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty()
  isOrganizer!: boolean;

  @ApiProperty({ description: 'É o usuário da sessão.' })
  isMe!: boolean;

  @ApiProperty({ description: 'RN-BOOK-09.' })
  shareCents!: number;

  @ApiProperty({ enum: INVITE_STATUSES, enumName: 'InviteStatus' })
  status!: InviteStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Só para o organizador, com o convite pendente.',
  })
  inviteToken!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://app.spacesports.com.br/r/abc123',
    description: 'Link público do convite. O app segue aceitando `spacesports://convite/<token>`.',
  })
  inviteUrl!: string | null;

  @ApiProperty({
    type: SuggestedUserDto,
    nullable: true,
    description:
      'RF-CONTACT-05: conta com o telefone do convidado, só para o organizador, em reserva aberta. Nulo também acima da cota de consultas.',
  })
  suggestedUser!: SuggestedUserDto | null;

  @ApiProperty({
    description: 'O convite está numa conta; falso em quem confirmou sem conta (RF-CONTACT-02).',
  })
  hasAccount!: boolean;
}

export class MyShareDto implements PlayerShare {
  @ApiProperty({
    ...uuid,
    nullable: true,
    description: 'Nulo para o organizador de reserva sem divisão (a parte é a reserva inteira).',
  })
  participantId!: string | null;

  @ApiProperty({ description: 'Só informativo: o recebimento é da reserva inteira (decisão 50).' })
  shareCents!: number;
}

class BookingEditBlockDto implements BookingEditBlock {
  @ApiProperty({ enum: BOOKING_EDIT_BLOCK_CODES, enumName: 'BookingEditBlockCode' })
  code!: BookingEditBlockCode;

  @ApiProperty({ description: 'Texto para mostrar ao jogador.' })
  message!: string;
}

/** Detalhe para o jogador: participantes e a própria parte, sem o extrato da gestão. */
export class PlayerBookingDetailDto extends PlayerBookingDto implements PlayerBookingDetail {
  @ApiProperty({ type: [PlayerBookingParticipantDto] })
  participants!: PlayerBookingParticipantDto[];

  @ApiProperty({ type: MyShareDto })
  myShare!: MyShareDto;

  @ApiProperty({ description: 'RN-BOOK-11: pode alterar o nº de pessoas agora.' })
  canEditPeople!: boolean;

  @ApiProperty({
    type: BookingEditBlockDto,
    nullable: true,
    description: 'Nulo quando `canEditPeople`.',
  })
  peopleEditBlock!: BookingEditBlockDto | null;

  @ApiProperty({ description: 'RN-BOOK-12: pode alterar data, horário e duração agora.' })
  canEditSchedule!: boolean;

  @ApiProperty({
    type: BookingEditBlockDto,
    nullable: true,
    description: 'Nulo quando `canEditSchedule`.',
  })
  scheduleEditBlock!: BookingEditBlockDto | null;

  @ApiProperty({
    allOf: [schemaRef('PlayerOnlineCharge')],
    nullable: true,
    description:
      'RF-ONPAY-03/04: cobrança online da reserva (a aberta, com o Pix, ou a mais recente), só para o organizador.',
  })
  onlinePayment!: PlayerOnlineCharge | null;
}

export class PlayerBookingPageDto implements PlayerBookingPage {
  @ApiProperty({ type: [PlayerBookingDto] })
  items!: PlayerBookingDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class SpaceBookingPageDto implements SpaceBookingPage {
  @ApiProperty({ type: [SpaceBookingDto] })
  items!: SpaceBookingDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

type InviteBooking = InvitePreview['booking'];

class InviteBookingDto implements InviteBooking {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty({ type: BookingSpaceDto })
  space!: BookingSpaceDto;

  @ApiProperty({ type: BookingCourtDto })
  court!: BookingCourtDto;

  @ApiProperty({ type: BookingSportDto })
  sport!: BookingSportDto;

  @ApiProperty(dateTime)
  startsAt!: string;

  @ApiProperty(dateTime)
  endsAt!: string;

  @ApiProperty({ enum: BOOKING_STATUSES, enumName: 'BookingStatus' })
  status!: BookingStatus;

  @ApiProperty({ ...paymentMethod, nullable: true })
  intendedPaymentMethod!: PaymentMethod | null;

  @ApiProperty()
  organizerName!: string;
}

export class InvitePreviewDto implements InvitePreview {
  @ApiProperty(uuid)
  participantId!: string;

  @ApiProperty({ enum: INVITE_STATUSES, enumName: 'InviteStatus' })
  status!: InviteStatus;

  @ApiProperty()
  shareCents!: number;

  @ApiProperty({
    description: 'A presença é do usuário da sessão: só com status ACCEPTED.',
  })
  acceptedByMe!: boolean;

  @ApiProperty({
    description:
      'RF-CONTACT-03: a vaga é de outra pessoa e o aceite seria recusado. Outra conta ficou com ela, ou foi confirmada sem conta com um contato que não é o desta conta.',
  })
  slotTaken!: boolean;

  @ApiProperty({ description: 'Convite direto a outra conta, ainda pendente: só ela responde.' })
  forAnotherAccount!: boolean;

  @ApiProperty({ type: InviteBookingDto })
  booking!: InviteBookingDto;
}

export class CourtBlockDto implements CourtBlock {
  @ApiProperty(uuid)
  id!: string;

  @ApiProperty(uuid)
  courtId!: string;

  @ApiProperty(dateTime)
  startsAt!: string;

  @ApiProperty(dateTime)
  endsAt!: string;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty(uuid)
  createdBy!: string;

  @ApiProperty(dateTime)
  createdAt!: string;
}

class ReceivableDto implements Receivable {
  @ApiProperty({ type: BookingDto })
  booking!: BookingDto;

  @ApiProperty({ description: 'priceCents − paidCents.' })
  dueCents!: number;
}

export class ReceivablesTodayDto implements ReceivablesToday {
  @ApiProperty({ type: String, format: 'date' })
  date!: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  timeZone!: string;

  @ApiProperty({ description: 'Soma do que falta receber das reservas de hoje.' })
  totalDueCents!: number;

  @ApiProperty({ type: [ReceivableDto] })
  items!: ReceivableDto[];
}
