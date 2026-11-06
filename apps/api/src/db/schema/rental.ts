import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sports } from './catalog.js';
import { id, timestamps, tstz } from './columns.js';
import { contacts } from './contacts.js';
import {
  bookingPaymentStatus,
  bookingSource,
  bookingStatus,
  chargeStatus,
  inviteStatus,
  occupationKind,
  paymentMethod,
  recurringBookingStatus,
} from './enums.js';
import { users } from './identity.js';
import { courts, spaces } from './spaces.js';

/**
 * Reservas (avulsas, de balcão e ocorrências de mensalista). A ocupação da quadra fica em
 * `court_occupations` (kind = BOOKING, ref_id = bookings.id).
 */
export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    /** FK composta (court_id, space_id) → courts: a quadra tem de ser do mesmo espaço. */
    courtId: uuid().notNull(),
    /** Nulo em reserva de balcão para cliente sem app (usa guest_name/guest_phone). */
    organizerUserId: uuid().references(() => users.id),
    guestName: text(),
    guestPhone: text(),
    sportId: uuid()
      .notNull()
      .references(() => sports.id),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    durationMin: integer().notNull(),
    peopleCount: integer().notNull(),
    /** Snapshot do preço/hora no momento da reserva. */
    pricePerHourCents: integer().notNull(),
    /** 0 nas ocorrências de mensalista (RN-BOOK-08). */
    priceCents: integer().notNull(),
    /** Abatimento do estorno manual do pagamento online (decisão 93); sai do saldo em aberto. */
    discountCents: integer().notNull().default(0),
    status: bookingStatus().notNull().default('CONFIRMED'),
    paymentStatus: bookingPaymentStatus().notNull().default('PENDING'),
    intendedPaymentMethod: paymentMethod(),
    source: bookingSource().notNull(),
    recurringBookingId: uuid().references((): AnyPgColumn => recurringBookings.id),
    cancelledAt: tstz(),
    cancelledBy: uuid().references(() => users.id),
    cancelReason: text(),
    /**
     * Ocorrência de mensalista cancelada pela pausa (RN-BOOK-08): a retomada reativa só estas.
     * Cancelamento à mão (semana em que o mensalista não vem) fica `false` e não volta.
     */
    cancelledByPause: boolean().notNull().default(false),
    /** Quando o job de lembrete reservou esta reserva; nulo = lembrete ainda não enviado (RF-NOTIF-01). */
    reminderSentAt: tstz(),
    /**
     * Prazo do pagamento online da reserva `PENDING_PAYMENT` (decisão 85, RN-ONPAY-02); vencido, o
     * job cancela com `cancel_reason = 'PAYMENT_EXPIRED'`. Nulo depois de confirmada.
     */
    paymentDueAt: tstz(),
    /** `Idempotency-Key` da criação pelo app (decisão 96): a nova tentativa devolve esta reserva. */
    idempotencyKey: text(),
    /**
     * Hash (SHA-256) do pedido que usou a chave: a mesma chave com outro pedido é recusada
     * (`IDEMPOTENCY_KEY_REUSED`). Nulo nas reservas antigas (sem conferência).
     */
    idempotencyRequestHash: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'bookings_court_space_fk',
      columns: [t.courtId, t.spaceId],
      foreignColumns: [courts.id, courts.spaceId],
    }),
    index('bookings_court_id_starts_at_idx').on(t.courtId, t.startsAt),
    index('bookings_space_id_status_idx').on(t.spaceId, t.status),
    index('bookings_space_id_starts_at_idx').on(t.spaceId, t.startsAt),
    index('bookings_organizer_user_id_starts_at_idx').on(t.organizerUserId, t.startsAt),
    index('bookings_sport_id_idx').on(t.sportId),
    index('bookings_recurring_booking_id_idx').on(t.recurringBookingId),
    // Uma ocorrência por mensalista e horário: a geração repetida não duplica (RN-BOOK-08).
    unique('bookings_recurring_booking_starts_at_unique').on(t.recurringBookingId, t.startsAt),
    index('bookings_cancelled_by_idx').on(t.cancelledBy),
    // O job de lembrete só varre as confirmadas ainda sem lembrete.
    index('bookings_reminder_pending_idx')
      .on(t.startsAt)
      .where(sql`${t.status} = 'CONFIRMED' AND ${t.reminderSentAt} IS NULL`),
    // O job de expiração só varre as que seguram horário (o status novo do enum não pode aparecer
    // num índice da mesma migração que o cria).
    index('bookings_payment_due_at_idx')
      .on(t.paymentDueAt)
      .where(sql`${t.paymentDueAt} IS NOT NULL`),
    // O job de pedidos de avaliação (RN-REVIEW-02) varre as que terminaram nas últimas 24 h.
    index('bookings_ends_at_reviewable_idx')
      .on(t.endsAt)
      .where(sql`${t.status} IN ('CONFIRMED', 'COMPLETED')`),
    uniqueIndex('bookings_organizer_idempotency_key_unique')
      .on(t.organizerUserId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check('bookings_discount_valid', sql`${t.discountCents} BETWEEN 0 AND ${t.priceCents}`),
    check('bookings_period_valid', sql`${t.endsAt} > ${t.startsAt}`),
    check('bookings_duration_positive', sql`${t.durationMin} > 0`),
    check(
      'bookings_duration_matches_period',
      sql`${t.durationMin} * interval '1 minute' = ${t.endsAt} - ${t.startsAt}`,
    ),
    check('bookings_people_count_positive', sql`${t.peopleCount} > 0`),
    check(
      'bookings_prices_non_negative',
      sql`${t.pricePerHourCents} >= 0 AND ${t.priceCents} >= 0`,
    ),
    check(
      'bookings_organizer_or_guest',
      sql`${t.organizerUserId} IS NOT NULL OR ${t.guestName} IS NOT NULL`,
    ),
  ],
);

/** Participantes da conta dividida (RF-BOOK-04, RN-BOOK-09). */
export const bookingParticipants = pgTable(
  'booking_participants',
  {
    id: id(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    /** Nulo enquanto o convite (link) não foi aceito por um usuário do app. */
    userId: uuid().references(() => users.id),
    inviteToken: text().notNull().unique('booking_participants_invite_token_unique'),
    name: text(),
    shareCents: integer().notNull(),
    status: inviteStatus().notNull().default('INVITED'),
    /** Contato do convidado (RF-CONTACT-01); apagar o contato não apaga o participante. */
    contactId: uuid().references((): AnyPgColumn => contacts.id, { onDelete: 'set null' }),
    /**
     * O convite citou o e-mail do contato. Só assim ele passa para a conta que verificar esse
     * e-mail: quem chegou pelo telefone pode ser outra pessoa, pois telefone não é verificado.
     */
    contactViaEmail: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('booking_participants_booking_user_unique').on(t.bookingId, t.userId),
    index('booking_participants_user_id_idx').on(t.userId),
    index('booking_participants_contact_id_idx').on(t.contactId),
    check('booking_participants_share_cents_non_negative', sql`${t.shareCents} >= 0`),
  ],
);

/** Mensalista: horário fixo semanal (RF-BOOK-05, RN-BOOK-08). */
export const recurringBookings = pgTable(
  'recurring_bookings',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    /** FK composta (court_id, space_id) → courts: a quadra tem de ser do mesmo espaço. */
    courtId: uuid().notNull(),
    userId: uuid().references(() => users.id),
    guestName: text(),
    guestPhone: text(),
    sportId: uuid()
      .notNull()
      .references(() => sports.id),
    /** 0 = domingo … 6 = sábado. */
    weekday: smallint().notNull(),
    /** Horário local do espaço (America/Sao_Paulo). */
    startTime: time().notNull(),
    durationMin: integer().notNull(),
    peopleCount: integer().notNull(),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }),
    status: recurringBookingStatus().notNull().default('PENDING_APPROVAL'),
    /** Motivo informado ao recusar, pausar ou encerrar. */
    statusReason: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'recurring_bookings_court_space_fk',
      columns: [t.courtId, t.spaceId],
      foreignColumns: [courts.id, courts.spaceId],
    }),
    index('recurring_bookings_space_id_status_idx').on(t.spaceId, t.status),
    index('recurring_bookings_court_id_weekday_idx').on(t.courtId, t.weekday),
    index('recurring_bookings_user_id_idx').on(t.userId),
    index('recurring_bookings_sport_id_idx').on(t.sportId),
    check('recurring_bookings_weekday_range', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('recurring_bookings_duration_positive', sql`${t.durationMin} > 0`),
    check('recurring_bookings_people_count_positive', sql`${t.peopleCount} > 0`),
    check(
      'recurring_bookings_dates_valid',
      sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`,
    ),
    check(
      'recurring_bookings_user_or_guest',
      sql`${t.userId} IS NOT NULL OR ${t.guestName} IS NOT NULL`,
    ),
  ],
);

/** Mensalidade do mensalista (uma por período; valor copiado de space_settings na geração). */
export const recurringBookingCharges = pgTable(
  'recurring_booking_charges',
  {
    id: id(),
    recurringBookingId: uuid()
      .notNull()
      .references(() => recurringBookings.id),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    amountCents: integer().notNull(),
    status: chargeStatus().notNull().default('PENDING'),
    ...timestamps,
  },
  (t) => [
    unique('recurring_booking_charges_booking_period_unique').on(
      t.recurringBookingId,
      t.periodStart,
    ),
    index('recurring_booking_charges_status_due_date_idx').on(t.status, t.dueDate),
    check('recurring_booking_charges_amount_cents_non_negative', sql`${t.amountCents} >= 0`),
    check('recurring_booking_charges_period_valid', sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/**
 * Ocorrência de mensalista que não coube na agenda (bloqueio, torneio, aula ou reserva no mesmo
 * horário): o job de geração registra aqui, sinalizando a gestão, em vez de falhar. Fica aberta
 * (`resolved_at` nulo) até a ocorrência ser gerada ou o mensalista ser pausado/encerrado.
 */
export const recurringBookingConflicts = pgTable(
  'recurring_booking_conflicts',
  {
    id: id(),
    recurringBookingId: uuid()
      .notNull()
      .references(() => recurringBookings.id),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    /** Origem da ocupação que bloqueou o horário. */
    conflictsWith: occupationKind().notNull(),
    resolvedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('recurring_booking_conflicts_booking_starts_at_unique').on(
      t.recurringBookingId,
      t.startsAt,
    ),
    index('recurring_booking_conflicts_open_idx')
      .on(t.recurringBookingId)
      .where(sql`${t.resolvedAt} IS NULL`),
    check('recurring_booking_conflicts_period_valid', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
