import { z } from 'zod';
import { BOOKING_EDIT_BLOCK_CODES, SLOT_MINUTES } from './availability';
import { centsSchema } from './money';
import {
  onlineChargeSchema,
  openOnlineChargeSchema,
  paymentChannelSchema,
  paymentOptionSchema,
  playerOnlineChargeSchema,
} from './online-payments';
import { paymentMethodSchema, phoneE164Schema } from './spaces';

/**
 * `PENDING_PAYMENT`: reserva com pagamento online obrigatório que segura o horário até
 * `paymentDueAt` (decisão 85, RN-ONPAY-02). Ocupa a agenda, não recebe lembrete e vira `CONFIRMED`
 * com o pagamento ou `CANCELLED` (`PAYMENT_EXPIRED`) no vencimento.
 */
export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const BOOKING_PAYMENT_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID'] as const;
export const bookingPaymentStatusSchema = z.enum(BOOKING_PAYMENT_STATUSES);
export type BookingPaymentStatus = z.infer<typeof bookingPaymentStatusSchema>;

export const BOOKING_SOURCES = ['APP', 'DESK', 'RECURRING'] as const;
export const bookingSourceSchema = z.enum(BOOKING_SOURCES);
export type BookingSource = z.infer<typeof bookingSourceSchema>;

export const INVITE_STATUSES = ['INVITED', 'ACCEPTED', 'DECLINED'] as const;
export const inviteStatusSchema = z.enum(INVITE_STATUSES);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/**
 * Itens do aluguel com pagamento registrado (RF-PAY-01). Só a reserva inteira recebe pagamento
 * novo; os outros tipos aparecem em registros antigos: a parte da conta dividida saiu na decisão
 * 50 e a mensalidade do mensalista, na decisão 27.
 */
export const BOOKING_PAYABLE_TYPES = [
  'BOOKING',
  'BOOKING_PARTICIPANT',
  'RECURRING_BOOKING_CHARGE',
] as const;
export const bookingPayableTypeSchema = z.enum(BOOKING_PAYABLE_TYPES);
export type BookingPayableType = z.infer<typeof bookingPayableTypeSchema>;

/** Todos os itens com pagamento registrado: os do aluguel e a mensalidade de aula. */
export const PAYABLE_TYPES = [...BOOKING_PAYABLE_TYPES, 'SUBSCRIPTION_CHARGE'] as const;
export const payableTypeSchema = z.enum(PAYABLE_TYPES);
export type PayableType = z.infer<typeof payableTypeSchema>;

/** Itens que aceitam registrar um pagamento novo: reserva inteira e mensalidade de aula. */
export const RECORDABLE_PAYABLE_TYPES = ['BOOKING', 'SUBSCRIPTION_CHARGE'] as const;
export const recordablePayableTypeSchema = z.enum(RECORDABLE_PAYABLE_TYPES);
export type RecordablePayableType = z.infer<typeof recordablePayableTypeSchema>;

/** Data local do espaço (`YYYY-MM-DD`). */
export const localDateSchema = z.iso.date();
/** Instante ISO 8601 com fuso (ex.: `2026-11-02T13:00:00Z` ou `2026-11-02T10:00:00-03:00`). */
export const instantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** RN-BOOK-02: duração em múltiplos de 30 min. */
export const durationMinSchema = z.coerce
  .number()
  .int()
  .positive()
  .multipleOf(SLOT_MINUTES, 'A duração deve ser múltipla de 30 minutos.');

// ---------------------------------------------------------------------------------------------
// Requisições

/** GET /v1/spaces/:spaceId/availability (RF-BOOK-01, RF-BOOK-02). */
export const availabilityQuerySchema = z.object({
  date: localDateSchema,
  durationMin: durationMinSchema,
  sportId: z.uuid(),
  courtId: z.uuid().optional(),
  /** Reserva do próprio organizador em edição: o horário dela conta como livre (RN-BOOK-12). */
  excludeBookingId: z.uuid().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

const bookingSlotFields = {
  courtId: z.uuid(),
  sportId: z.uuid(),
  startsAt: instantSchema,
  durationMin: durationMinSchema,
  peopleCount: z.number().int().positive(),
  intendedPaymentMethod: paymentMethodSchema.optional(),
};

/**
 * POST /v1/bookings: reserva avulsa pelo jogador (RF-BOOK-01, RN-BOOK-07). `paymentOption` é a
 * forma escolhida na etapa de pagamento (RF-ONPAY-03), conforme o modo do espaço; sem ela, vale
 * `ON_SITE` (recusada no modo `ONLINE_REQUIRED`). `cardToken` só com `ONLINE_CARD` (RN-ONPAY-10).
 */
export const createBookingSchema = z
  .object({
    spaceId: z.uuid(),
    ...bookingSlotFields,
    paymentOption: paymentOptionSchema.optional(),
    cardToken: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => (v.paymentOption === 'ONLINE_CARD') === Boolean(v.cardToken), {
    message: 'Envie `cardToken` só (e sempre) com `ONLINE_CARD`.',
    path: ['cardToken'],
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/**
 * POST /v1/manage/spaces/:spaceId/bookings: reserva de balcão (RF-BOOK-06). Cliente com app
 * (`customerUserId`) ou sem app (`guestName` + `guestPhone`).
 */
export const createDeskBookingSchema = z
  .object({
    ...bookingSlotFields,
    customerUserId: z.uuid().optional(),
    guestName: z.string().trim().min(1).max(120).optional(),
    guestPhone: phoneE164Schema.optional(),
  })
  .refine((v) => (v.customerUserId ? !v.guestName && !v.guestPhone : v.guestName && v.guestPhone), {
    message: 'Informe customerUserId ou guestName + guestPhone.',
    path: ['customerUserId'],
  });
export type CreateDeskBookingInput = z.infer<typeof createDeskBookingSchema>;

/** PATCH /v1/bookings/:bookingId: edição pelo organizador (RF-BOOK-03); a quadra não muda. */
export const updateBookingSchema = z
  .object({
    peopleCount: z.number().int().positive().optional(),
    startsAt: instantSchema.optional(),
    durationMin: durationMinSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'Informe peopleCount, startsAt ou durationMin.',
    path: ['peopleCount'],
  });
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

/** POST …/cancel. */
export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

/** Convite com contato (RF-CONTACT-01). Sem nome, é vaga aberta, preenchida na página pública. */
export const inviteItemSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneE164Schema.optional(),
  email: z.email().max(254).optional(),
});
export type InviteItem = z.infer<typeof inviteItemSchema>;

/** POST /v1/bookings/:bookingId/invites: convites da conta dividida (RF-BOOK-04). */
export const createInvitesSchema = z
  .object({
    /** Um convite por nome (o nome é só um rótulo até o convidado aceitar). */
    names: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    /** Convite direto a usuários do app: eles recebem a notificação `BOOKING_INVITE`. */
    userIds: z.array(z.uuid()).max(50).default([]),
    /** Convites com nome, WhatsApp ou e-mail do convidado; item vazio é vaga aberta. */
    items: z.array(inviteItemSchema).max(50).default([]),
  })
  .refine((v) => v.names.length + v.userIds.length + v.items.length > 0, {
    message: 'Informe ao menos um nome, usuário ou convite.',
    path: ['names'],
  });
export type CreateInvitesInput = z.infer<typeof createInvitesSchema>;

/** Confirma a conta sugerida pelo telefone: `userId` é o `suggestedUser.id` que a tela mostrou. */
export const confirmSuggestedUserSchema = z.object({ userId: z.uuid() }).strict();
export type ConfirmSuggestedUserInput = z.infer<typeof confirmSuggestedUserSchema>;

/** POST /v1/manage/spaces/:spaceId/court-blocks (RF-BOOK-06). */
export const createCourtBlockSchema = z
  .object({
    courtId: z.uuid(),
    startsAt: instantSchema,
    endsAt: instantSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt deve ser depois de startsAt.',
    path: ['endsAt'],
  });
export type CreateCourtBlockInput = z.infer<typeof createCourtBlockSchema>;

export const courtBlocksQuerySchema = z.object({
  from: instantSchema,
  to: instantSchema,
  courtId: z.uuid().optional(),
});
export type CourtBlocksQuery = z.infer<typeof courtBlocksQuerySchema>;

/** POST /v1/manage/spaces/:spaceId/payments (RF-PAY-01, RN-PAY-01). */
export const recordPaymentSchema = z.object({
  payableType: recordablePayableTypeSchema,
  payableId: z.uuid(),
  amountCents: centsSchema.positive(),
  method: paymentMethodSchema,
  /** Padrão: agora. */
  paidAt: instantSchema.optional(),
  note: z.string().trim().min(1).max(500).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

export const pageFields = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `nextCursor` da página anterior. */
  cursor: z.string().min(1).optional(),
};

/** GET /v1/bookings: minhas reservas (RF-BOOK-03). */
export const myBookingsQuerySchema = z.object({
  /**
   * `upcoming`: confirmadas ou aguardando pagamento (`PENDING_PAYMENT`) que ainda não terminaram.
   * `past`: as demais.
   */
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  ...pageFields,
});
export type MyBookingsQuery = z.infer<typeof myBookingsQuerySchema>;

/** Aceita um valor ou vários (`?status=A&status=B`). */
export const oneOrMany = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(schema)).optional();

/** GET /v1/manage/spaces/:spaceId/bookings: reservas do espaço com filtros. */
export const spaceBookingsQuerySchema = z.object({
  /** Reservas que terminam depois de `from`. */
  from: instantSchema.optional(),
  /** Reservas que começam antes de `to`. */
  to: instantSchema.optional(),
  courtId: z.uuid().optional(),
  status: oneOrMany(bookingStatusSchema),
  paymentStatus: oneOrMany(bookingPaymentStatusSchema),
  source: oneOrMany(bookingSourceSchema),
  /** Busca no nome do organizador/cliente ou no telefone. */
  q: z.string().trim().min(1).max(120).optional(),
  ...pageFields,
});
export type SpaceBookingsQuery = z.infer<typeof spaceBookingsQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Respostas (datas em ISO 8601 UTC)

const isoString = z.iso.datetime();

/**
 * Conta com o mesmo telefone do convidado ou do cliente de balcão (RF-CONTACT-05). Telefone não é
 * verificado: é só sugestão, e o vínculo depende da confirmação de quem vê.
 */
export const suggestedUserSchema = z.object({ id: z.uuid(), firstName: z.string() });
export type SuggestedUser = z.infer<typeof suggestedUserSchema>;

export const availabilitySlotSchema = z.object({
  startsAt: isoString,
  endsAt: isoString,
  available: z.boolean(),
});

export const availabilityCourtSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  covered: z.boolean(),
  /** RN-BOOK-04: capacidade da quadra para o esporte. */
  maxPlayers: z.number().int().positive(),
  slots: z.array(availabilitySlotSchema),
});

export const availabilityResponseSchema = z.object({
  date: localDateSchema,
  timeZone: z.string(),
  durationMin: z.number().int(),
  pricePerHourCents: centsSchema,
  /** RN-BOOK-01: preço da duração pedida. */
  priceCents: centsSchema,
  courts: z.array(availabilityCourtSchema),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

export const bookingParticipantSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  /** Nome do usuário que aceitou ou o rótulo dado no convite. */
  name: z.string().nullable(),
  isOrganizer: z.boolean(),
  shareCents: centsSchema,
  status: inviteStatusSchema,
  /** Só para o organizador e a gestão, enquanto o convite está pendente. */
  inviteToken: z.string().nullable(),
  /** Link público `${WEB_URL}/r/<token>` (mesma regra do inviteToken). */
  inviteUrl: z.string().nullable(),
});
export type BookingParticipant = z.infer<typeof bookingParticipantSchema>;

export const paymentRecordSchema = z.object({
  id: z.uuid(),
  payableType: payableTypeSchema,
  payableId: z.uuid(),
  payerUserId: z.uuid().nullable(),
  amountCents: centsSchema,
  method: paymentMethodSchema,
  /** `ONLINE`: pago pelo app (RN-ONPAY-04), com `onlineChargeId` e sem `recordedBy`. */
  channel: paymentChannelSchema,
  onlineChargeId: z.uuid().nullable(),
  paidAt: isoString,
  /** Quem registrou; nulo no pagamento online (registrado pelo sistema). */
  recordedBy: z.uuid().nullable(),
  note: z.string().nullable(),
  reversedAt: isoString.nullable(),
  reversedBy: z.uuid().nullable(),
});
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

export const bookingSchema = z.object({
  id: z.uuid(),
  space: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), timeZone: z.string() }),
  court: z.object({ id: z.uuid(), name: z.string() }),
  sport: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  organizer: z.object({
    userId: z.uuid().nullable(),
    /** Nome do usuário ou do cliente de balcão. */
    name: z.string(),
    /** Só para a gestão (cliente de balcão). */
    phone: z.string().nullable(),
  }),
  startsAt: isoString,
  endsAt: isoString,
  durationMin: z.number().int(),
  peopleCount: z.number().int(),
  pricePerHourCents: centsSchema,
  priceCents: centsSchema,
  /** Soma dos pagamentos não estornados (da reserva e os antigos por parte, decisão 50). */
  paidCents: centsSchema,
  /**
   * Abatimento registrado no estorno manual do pagamento online (decisão 93): sai do saldo em
   * aberto sem contar como recebido. Em aberto = `priceCents − discountCents − paidCents`.
   */
  discountCents: centsSchema,
  status: bookingStatusSchema,
  paymentStatus: bookingPaymentStatusSchema,
  intendedPaymentMethod: paymentMethodSchema.nullable(),
  source: bookingSourceSchema,
  /** Prazo do pagamento da reserva `PENDING_PAYMENT` (RN-ONPAY-02); nulo nas demais. */
  paymentDueAt: isoString.nullable(),
  /** Cobrança online aberta (Pix pendente ou cartão em processamento), se houver. */
  openOnlineCharge: openOnlineChargeSchema.nullable(),
  /** RN-BOOK-05: limite para o jogador cancelar pelo app. */
  cancellableUntil: isoString,
  cancelledAt: isoString.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: isoString,
});
export type Booking = z.infer<typeof bookingSchema>;

/** Detalhe da reserva para a gestão do espaço, com o extrato completo de pagamentos. */
export const bookingDetailSchema = bookingSchema.extend({
  participants: z.array(bookingParticipantSchema),
  payments: z.array(paymentRecordSchema),
  /** Cobranças online (RF-ONPAY-08): as pagas, a aberta e as encerradas, mais recentes primeiro. */
  onlineCharges: z.array(onlineChargeSchema),
  /** Conta sugerida para o cliente de balcão; só na visualização da reserva, para Dono e Admin. */
  suggestedUser: suggestedUserSchema.nullable(),
});
export type BookingDetail = z.infer<typeof bookingDetailSchema>;

/**
 * Reserva nas leituras da gestão (decisão 53): quem não registra pagamentos (o Professor) segue
 * vendo a agenda, mas os valores e a situação do pagamento chegam nulos, inclusive a forma prevista.
 */
export const spaceBookingSchema = bookingSchema.extend({
  pricePerHourCents: centsSchema.nullable(),
  priceCents: centsSchema.nullable(),
  paidCents: centsSchema.nullable(),
  discountCents: centsSchema.nullable(),
  paymentStatus: bookingPaymentStatusSchema.nullable(),
});
export type SpaceBooking = z.infer<typeof spaceBookingSchema>;

/** Decisão 53: sem `payment.record`, a parte e o convite (token e link) chegam nulos. */
export const spaceBookingParticipantSchema = bookingParticipantSchema.extend({
  shareCents: centsSchema.nullable(),
});
export type SpaceBookingParticipant = z.infer<typeof spaceBookingParticipantSchema>;

/** Detalhe da reserva para a leitura da gestão: sem `payment.record`, `payments` vem vazio. */
export const spaceBookingDetailSchema = spaceBookingSchema.extend({
  participants: z.array(spaceBookingParticipantSchema),
  payments: z.array(paymentRecordSchema),
  onlineCharges: z.array(onlineChargeSchema),
  suggestedUser: suggestedUserSchema.nullable(),
});
export type SpaceBookingDetail = z.infer<typeof spaceBookingDetailSchema>;

/**
 * Reserva na visão do jogador. O total pago e o status de pagamento da reserva inteira só vão
 * para o organizador; o participante vê o valor da própria parte em `myShare` (no detalhe).
 */
export const playerBookingSchema = bookingSchema.extend({
  paidCents: centsSchema.nullable(),
  discountCents: centsSchema.nullable(),
  paymentStatus: bookingPaymentStatusSchema.nullable(),
  /**
   * Hora do servidor, como nas cobranças: a contagem do prazo (`paymentDueAt`) usa a diferença
   * entre ela e o relógio do aparelho.
   */
  serverTime: isoString,
});
export type PlayerBooking = z.infer<typeof playerBookingSchema>;

export const playerBookingPageSchema = z.object({
  items: z.array(playerBookingSchema),
  nextCursor: z.string().nullable(),
});
export type PlayerBookingPage = z.infer<typeof playerBookingPageSchema>;

/** Participante na visão do jogador: a parte é só informativa (decisão 50). */
export const playerBookingParticipantSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  isOrganizer: z.boolean(),
  /** É o usuário da sessão. */
  isMe: z.boolean(),
  shareCents: centsSchema,
  status: inviteStatusSchema,
  /** Só para o organizador, enquanto o convite está pendente. */
  inviteToken: z.string().nullable(),
  inviteUrl: z.string().nullable(),
  /** Só para o organizador, em reserva aberta e participante sem conta. */
  suggestedUser: suggestedUserSchema.nullable(),
  /** O convite está numa conta; falso em quem confirmou pela página pública, sem conta. */
  hasAccount: z.boolean(),
});
export type PlayerBookingParticipant = z.infer<typeof playerBookingParticipantSchema>;

/**
 * Pagamento da mensalidade (aluno e gestão), sem quem registrou, nota ou estornos. Como o da
 * reserva, traz o canal: `ONLINE` é o pago pelo app (RN-ONPAY-04), com `onlineChargeId`; esse só
 * muda pelo estorno da cobrança online, não pelo estorno do registro.
 */
export const playerPaymentSchema = z.object({
  id: z.uuid(),
  amountCents: centsSchema,
  method: paymentMethodSchema,
  channel: paymentChannelSchema,
  onlineChargeId: z.uuid().nullable(),
  paidAt: isoString,
});
export type PlayerPayment = z.infer<typeof playerPaymentSchema>;

/** A parte do usuário da sessão, só informativa: o recebimento é da reserva inteira (decisão 50). */
export const myShareSchema = z.object({
  /** Nulo para o organizador de reserva sem divisão (a parte é a reserva inteira). */
  participantId: z.uuid().nullable(),
  shareCents: centsSchema,
});
export type MyShare = z.infer<typeof myShareSchema>;

/** Por que uma edição não está liberada: código estável e o texto para mostrar ao jogador. */
export const bookingEditBlockSchema = z.object({
  code: z.enum(BOOKING_EDIT_BLOCK_CODES),
  message: z.string(),
});
export type BookingEditBlock = z.infer<typeof bookingEditBlockSchema>;

/** Detalhe da reserva para o jogador (organizador ou participante). O extrato fica com a gestão. */
export const playerBookingDetailSchema = playerBookingSchema.extend({
  participants: z.array(playerBookingParticipantSchema),
  myShare: myShareSchema,
  /** RN-BOOK-11: o usuário da sessão pode alterar o nº de pessoas agora. */
  canEditPeople: z.boolean(),
  /** Nulo quando `canEditPeople`. */
  peopleEditBlock: bookingEditBlockSchema.nullable(),
  /** RN-BOOK-12: o usuário da sessão pode alterar data, horário e duração agora. */
  canEditSchedule: z.boolean(),
  /** Nulo quando `canEditSchedule`. */
  scheduleEditBlock: bookingEditBlockSchema.nullable(),
  /**
   * Última cobrança online da reserva (RF-ONPAY-03/04), só para o organizador: a aberta (com o Pix)
   * ou a mais recente. Nula sem cobrança online.
   */
  onlinePayment: playerOnlineChargeSchema.nullable(),
});
export type PlayerBookingDetail = z.infer<typeof playerBookingDetailSchema>;

export const bookingPageSchema = z.object({
  items: z.array(bookingSchema),
  nextCursor: z.string().nullable(),
});
export type BookingPage = z.infer<typeof bookingPageSchema>;

export const spaceBookingPageSchema = z.object({
  items: z.array(spaceBookingSchema),
  nextCursor: z.string().nullable(),
});
export type SpaceBookingPage = z.infer<typeof spaceBookingPageSchema>;

/** GET /v1/invites/:token: prévia do convite antes de aceitar. */
export const invitePreviewSchema = z.object({
  participantId: z.uuid(),
  status: inviteStatusSchema,
  shareCents: centsSchema,
  /** A presença é do usuário da sessão: só com status ACCEPTED. O convite direto nasce pendente. */
  acceptedByMe: z.boolean(),
  /**
   * A vaga é de outra pessoa e o aceite seria recusado: outra conta ficou com ela, ou ela foi
   * confirmada sem conta com um contato que não é o desta conta (RF-CONTACT-03).
   */
  slotTaken: z.boolean(),
  /** Convite direto a outra conta, ainda pendente: só ela responde. */
  forAnotherAccount: z.boolean(),
  booking: bookingSchema
    .pick({
      id: true,
      space: true,
      court: true,
      sport: true,
      startsAt: true,
      endsAt: true,
      status: true,
      intendedPaymentMethod: true,
    })
    .extend({ organizerName: z.string() }),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/**
 * GET /v1/public/invites/:token (RF-CONTACT-02): o mínimo para responder sem conta. Quem tem o link
 * não vê telefone, e-mail ou dados dos outros convidados, nem ids internos.
 */
export const publicInvitePreviewSchema = z.object({
  status: inviteStatusSchema,
  /** Pode responder sem conta agora: pendente, sem conta dona, em reserva que não terminou. */
  canAnswer: z.boolean(),
  /** Convite direto a uma conta: só ela responde, entrando. */
  accountRequired: z.boolean(),
  /**
   * Alguém já ficou com esta vaga, com ou sem conta. A prévia é anônima: quem olha pode ser a
   * própria pessoa. Só a confirmação compara o contato (`INVITE_SLOT_TAKEN`); com sessão, vale o
   * `slotTaken` de `GET /v1/invites/:token`, que já compara com a conta.
   */
  slotTaken: z.boolean(),
  shareCents: centsSchema,
  booking: z.object({
    space: z.object({ name: z.string(), slug: z.string(), timeZone: z.string() }),
    court: z.object({ name: z.string() }),
    sport: z.object({ name: z.string(), slug: z.string() }),
    startsAt: isoString,
    endsAt: isoString,
    status: bookingStatusSchema,
    organizerFirstName: z.string(),
  }),
});
export type PublicInvitePreview = z.infer<typeof publicInvitePreviewSchema>;

/** POST /v1/public/invites/:token/confirm: presença sem conta (nome + WhatsApp ou e-mail). */
export const confirmPublicInviteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: phoneE164Schema.optional(),
    email: z.email().max(254).optional(),
    /** Caixa desmarcada por padrão (decisão 48). */
    marketingConsent: z.boolean().default(false),
  })
  .refine((v) => v.phone || v.email, {
    message: 'Informe o WhatsApp ou o e-mail.',
    path: ['phone'],
  });
export type ConfirmPublicInviteInput = z.infer<typeof confirmPublicInviteSchema>;

export const courtBlockSchema = z.object({
  id: z.uuid(),
  courtId: z.uuid(),
  startsAt: isoString,
  endsAt: isoString,
  reason: z.string().nullable(),
  createdBy: z.uuid(),
  createdAt: isoString,
});
export type CourtBlock = z.infer<typeof courtBlockSchema>;

/** RF-PAY-03: "a receber hoje". */
export const receivableSchema = z.object({
  booking: bookingSchema,
  /** priceCents − discountCents − paidCents. */
  dueCents: centsSchema,
});
export const receivablesTodaySchema = z.object({
  date: localDateSchema,
  timeZone: z.string(),
  /** Soma do que falta receber das reservas de hoje. */
  totalDueCents: centsSchema,
  items: z.array(receivableSchema),
});
export type Receivable = z.infer<typeof receivableSchema>;
export type ReceivablesToday = z.infer<typeof receivablesTodaySchema>;

// ---------------------------------------------------------------------------------------------
// Extrato de recebimentos do espaço (RF-PAY-03)

/**
 * Serviço do extrato: aluguel avulso (reserva e, em registros antigos, partes), mensalidade do
 * mensalista (só pagamentos antigos) e mensalidade de aula.
 */
export const STATEMENT_SERVICES = ['RENTAL', 'RECURRING', 'CLASS'] as const;
export const statementServiceSchema = z.enum(STATEMENT_SERVICES);
export type StatementService = z.infer<typeof statementServiceSchema>;

/** Tipos de pagamento de cada serviço do extrato. */
export const STATEMENT_SERVICE_PAYABLE_TYPES = {
  RENTAL: ['BOOKING', 'BOOKING_PARTICIPANT'],
  RECURRING: ['RECURRING_BOOKING_CHARGE'],
  CLASS: ['SUBSCRIPTION_CHARGE'],
} as const satisfies Record<StatementService, readonly PayableType[]>;

const statementFilterFields = {
  from: instantSchema,
  to: instantSchema,
  method: paymentMethodSchema.optional(),
  service: statementServiceSchema.optional(),
  /** No local (registrado pela gestão) ou online (pago pelo app). */
  channel: paymentChannelSchema.optional(),
};
const periodIsValid = (v: { from: Date; to: Date }) => v.to > v.from;
const periodError = { message: '`to` deve ser depois de `from`.', path: ['to'] };

/** Filtros do extrato (CSV). Período por `paid_at`, em UTC: [from, to). */
export const statementFiltersSchema = z
  .object(statementFilterFields)
  .refine(periodIsValid, periodError);
export type StatementFilters = z.infer<typeof statementFiltersSchema>;

/** GET /v1/manage/spaces/:spaceId/statement: os mesmos filtros, paginados. */
export const statementQuerySchema = z
  .object({ ...statementFilterFields, ...pageFields })
  .refine(periodIsValid, periodError);
export type StatementQuery = z.infer<typeof statementQuerySchema>;

export const statementEntrySchema = paymentRecordSchema.extend({
  service: statementServiceSchema,
  /** Usuário pagador ou, sem app, o cliente de balcão / mensalista cadastrado. */
  payerName: z.string().nullable(),
  /** Nulo no pagamento online (registrado pelo sistema). */
  recordedByName: z.string().nullable(),
  /** Reserva paga (inteira ou, em registro antigo, a parte de um participante). */
  bookingId: z.uuid().nullable(),
  bookingStartsAt: isoString.nullable(),
  /** Mensalista da mensalidade paga e o primeiro dia do mês cobrado. */
  recurringBookingId: z.uuid().nullable(),
  /** Assinatura de aula e o plano da mensalidade paga. */
  subscriptionId: z.uuid().nullable(),
  planName: z.string().nullable(),
  /** Primeiro dia do mês cobrado (mensalidade do mensalista ou de aula). */
  chargePeriodStart: localDateSchema.nullable(),
  courtName: z.string().nullable(),
});
export type StatementEntry = z.infer<typeof statementEntrySchema>;

const statementTotalSchema = z.object({
  /** Pagamentos não estornados. */
  receivedCents: centsSchema,
  paymentsCount: z.number().int(),
});

export const statementSchema = z.object({
  period: z.object({ from: isoString, to: isoString }),
  timeZone: z.string(),
  /** Totais do período com os filtros aplicados (todas as páginas). */
  totals: statementTotalSchema.extend({ reversedCents: centsSchema }),
  byMethod: z.array(statementTotalSchema.extend({ method: paymentMethodSchema })),
  /** No local × online (RF-ONPAY-04). */
  byChannel: z.array(statementTotalSchema.extend({ channel: paymentChannelSchema })),
  /** Mais recentes primeiro; inclui os estornados (com `reversedAt`). */
  items: z.array(statementEntrySchema),
  nextCursor: z.string().nullable(),
});
export type Statement = z.infer<typeof statementSchema>;
