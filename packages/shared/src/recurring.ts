import { z } from 'zod';
import { durationMinSchema, localDateSchema, oneOrMany, pageFields } from './booking';
import { phoneE164Schema } from './spaces';
import { addDays, weekdayOf } from './time';

// Mensalista: horário fixo semanal (RF-BOOK-05, RF-BOOK-07, RN-BOOK-08).

export const RECURRING_STATUSES = [
  'PENDING_APPROVAL',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'REJECTED',
] as const;
export const recurringStatusSchema = z.enum(RECURRING_STATUSES);
export type RecurringStatus = z.infer<typeof recurringStatusSchema>;

/** Estados em que o mensalista ainda ocupa ou pode vir a ocupar a agenda. */
export const OPEN_RECURRING_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED'] as const;

/** Origens que podem ocupar a quadra (court_occupations.kind). */
export const OCCUPATION_KINDS = ['BOOKING', 'CLASS', 'TOURNAMENT', 'BLOCK'] as const;
export const occupationKindSchema = z.enum(OCCUPATION_KINDS);
export type OccupationKind = z.infer<typeof occupationKindSchema>;

/** Antecedência da geração das ocorrências (RN-BOOK-08): 4 semanas. */
export const RECURRING_GENERATION_DAYS = 28;

/** Horário local do espaço, `HH:MM`, em hora cheia ou meia hora (RN-BOOK-02). */
export const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|30)$/, 'Horário HH:MM em hora cheia ou meia hora.');

const slotFields = {
  courtId: z.uuid(),
  sportId: z.uuid(),
  /** 0 = domingo … 6 = sábado. */
  weekday: z.number().int().min(0).max(6),
  startTime: startTimeSchema,
  durationMin: durationMinSchema,
  peopleCount: z.number().int().positive(),
  /** Primeira data (local) em que vale; padrão: hoje. */
  startsOn: localDateSchema.optional(),
};

/** POST /v1/recurring-bookings: o jogador solicita o horário fixo (nasce PENDING_APPROVAL). */
export const requestRecurringBookingSchema = z.object({ spaceId: z.uuid(), ...slotFields });
export type RequestRecurringBookingInput = z.infer<typeof requestRecurringBookingSchema>;

/**
 * POST /v1/manage/spaces/:spaceId/recurring-bookings: cadastro direto pela gestão (nasce
 * ACTIVE). Cliente com app (`customerUserId`) ou sem app (`guestName` + `guestPhone`).
 */
export const createDeskRecurringBookingSchema = z
  .object({
    ...slotFields,
    customerUserId: z.uuid().optional(),
    guestName: z.string().trim().min(1).max(120).optional(),
    guestPhone: phoneE164Schema.optional(),
  })
  .refine((v) => (v.customerUserId ? !v.guestName && !v.guestPhone : v.guestName && v.guestPhone), {
    message: 'Informe customerUserId ou guestName + guestPhone.',
    path: ['customerUserId'],
  });
export type CreateDeskRecurringBookingInput = z.infer<typeof createDeskRecurringBookingSchema>;

/** POST …/reject, …/pause, …/end. */
export const recurringReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type RecurringReasonInput = z.infer<typeof recurringReasonSchema>;

/** GET /v1/manage/spaces/:spaceId/recurring-bookings. */
export const recurringBookingsQuerySchema = z.object({
  status: oneOrMany(recurringStatusSchema),
  courtId: z.uuid().optional(),
  /** Busca no nome ou telefone do mensalista. */
  q: z.string().trim().min(1).max(120).optional(),
  ...pageFields,
});
export type RecurringBookingsQuery = z.infer<typeof recurringBookingsQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Respostas (datas em ISO 8601 UTC)

const isoString = z.iso.datetime();

export const recurringBookingSchema = z.object({
  id: z.uuid(),
  space: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), timeZone: z.string() }),
  court: z.object({ id: z.uuid(), name: z.string() }),
  sport: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  customer: z.object({
    userId: z.uuid().nullable(),
    name: z.string(),
    /** Só para a gestão (cliente cadastrado sem app). */
    phone: z.string().nullable(),
  }),
  weekday: z.number().int(),
  startTime: startTimeSchema,
  durationMin: z.number().int(),
  peopleCount: z.number().int(),
  startsOn: localDateSchema,
  endsOn: localDateSchema.nullable(),
  status: recurringStatusSchema,
  /** Motivo informado ao recusar, pausar ou encerrar. */
  statusReason: z.string().nullable(),
  createdAt: isoString,
});
export type RecurringBooking = z.infer<typeof recurringBookingSchema>;

export const recurringConflictSchema = z.object({
  id: z.uuid(),
  recurringBookingId: z.uuid(),
  court: z.object({ id: z.uuid(), name: z.string() }),
  customer: recurringBookingSchema.shape.customer,
  /** Ocorrência que não coube na agenda. */
  startsAt: isoString,
  endsAt: isoString,
  /** O que ocupa o horário: bloqueio, torneio, aula ou outra reserva. */
  conflictsWith: occupationKindSchema,
  createdAt: isoString,
});
export type RecurringConflict = z.infer<typeof recurringConflictSchema>;

export const recurringBookingDetailSchema = recurringBookingSchema.extend({
  /** Ocorrências em aberto que conflitam com a agenda (sinalizadas para a gestão). */
  conflicts: z.array(recurringConflictSchema),
});
export type RecurringBookingDetail = z.infer<typeof recurringBookingDetailSchema>;

export const recurringBookingPageSchema = z.object({
  items: z.array(recurringBookingSchema),
  nextCursor: z.string().nullable(),
});
export type RecurringBookingPage = z.infer<typeof recurringBookingPageSchema>;

// ---------------------------------------------------------------------------------------------
// Regras puras (compartilhadas com o app para pré-visualização)

/** Datas locais (`YYYY-MM-DD`) de `from` a `to`, inclusive, que caem no dia da semana. */
export function weekdayDates(weekday: number, from: string, to: string): string[] {
  const dates: string[] = [];
  let date = addDays(from, (weekday - weekdayOf(from) + 7) % 7);
  for (; date <= to; date = addDays(date, 7)) dates.push(date);
  return dates;
}
