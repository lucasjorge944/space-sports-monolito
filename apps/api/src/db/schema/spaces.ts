import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { amenities, cities, sports } from './catalog.js';
import { geographyPoint, id, timestamps } from './columns.js';
import { attendanceMode, courtStatus, paymentMethod, spaceStatus } from './enums.js';
import { users } from './identity.js';

/**
 * Espaços. Nasce `ACTIVE` com todos os módulos (RN-SPACE-01). Endereço, contatos e `location`
 * são opcionais: espaço sem `location` não aparece na busca geográfica.
 */
export const spaces = pgTable(
  'spaces',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull().unique('spaces_slug_unique'),
    description: text(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id),
    addressStreet: text(),
    addressNumber: text(),
    addressNeighborhood: text(),
    /** CEP só com dígitos (8). */
    addressPostalCode: text(),
    location: geographyPoint(),
    phone: text(),
    whatsapp: text(),
    instagram: text(),
    /** URL pública da logo no storage (RF-SPACE-11, decisão 44); nula = sem logo (iniciais). */
    logoUrl: text(),
    status: spaceStatus().notNull().default('ACTIVE'),
    /**
     * Avaliações que contam na média (RN-REVIEW-03) e a soma das notas, mantidas na mesma
     * transação que cria, edita, exclui ou tira da média (autor bloqueado) uma avaliação. A
     * média é calculada na leitura.
     */
    ratingCount: integer().notNull().default(0),
    ratingSum: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('spaces_city_id_status_idx').on(t.cityId, t.status),
    index('spaces_status_idx').on(t.status),
    index('spaces_location_gist_idx').using('gist', t.location),
    check('spaces_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('spaces_address_postal_code_format', sql`${t.addressPostalCode} ~ '^[0-9]{8}$'`),
    // Cada nota vale de 1 a 5: a soma fica entre a contagem e 5 × a contagem.
    check(
      'spaces_rating_consistent',
      sql`${t.ratingCount} >= 0 AND ${t.ratingSum} BETWEEN ${t.ratingCount} AND 5 * ${t.ratingCount}`,
    ),
  ],
);

/**
 * Configurações do espaço (1:1, RF-SPACE-04). Os valores ficam nulos até o espaço defini-los
 * na implantação; a aplicação trata nulo como "não configurado".
 */
export const spaceSettings = pgTable(
  'space_settings',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .unique('space_settings_space_id_unique')
      .references(() => spaces.id, { onDelete: 'cascade' }),
    pricePerHourCents: integer(),
    bookingMinDurationMin: integer(),
    bookingMaxDurationMin: integer(),
    bookingMinAdvanceMin: integer(),
    bookingWindowDays: integer(),
    cancellationDeadlineMin: integer(),
    /**
     * Legado: valor mensal e vencimento da mensalidade do mensalista, que deixou de existir
     * (decisão 27). As colunas ficam (nulas, sem uso) para não apagar o que já foi configurado.
     */
    recurringMonthlyPriceCents: integer(),
    recurringBillingDay: smallint(),
    attendanceMode: attendanceMode(),
    attendanceOpenBeforeMin: integer(),
    attendanceCloseBeforeMin: integer(),
    attendanceCancelDeadlineMin: integer(),
    /** RN-CLASS-06: bloqueio de confirmação por mensalidade em atraso; o espaço pode desligar. */
    pastDueBlockEnabled: boolean(),
    pastDueBlockDays: integer(),
    acceptedPaymentMethods: paymentMethod().array().notNull().default(sql`'{}'`),
    ...timestamps,
  },
  (t) => [
    check('space_settings_price_per_hour_cents_non_negative', sql`${t.pricePerHourCents} >= 0`),
    check(
      'space_settings_recurring_monthly_price_cents_non_negative',
      sql`${t.recurringMonthlyPriceCents} >= 0`,
    ),
    check(
      'space_settings_recurring_billing_day_range',
      sql`${t.recurringBillingDay} BETWEEN 1 AND 31`,
    ),
    check('space_settings_past_due_block_days_range', sql`${t.pastDueBlockDays} BETWEEN 1 AND 365`),
    check(
      'space_settings_booking_duration_range',
      sql`${t.bookingMinDurationMin} > 0 AND ${t.bookingMaxDurationMin} >= ${t.bookingMinDurationMin}`,
    ),
  ],
);

/**
 * Horário de funcionamento. `weekday` 0 = domingo … 6 = sábado. Pode haver mais de um intervalo
 * por dia. `closes_at <= opens_at` indica que o intervalo passa da meia-noite.
 */
export const spaceOpeningHours = pgTable(
  'space_opening_hours',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    weekday: smallint().notNull(),
    opensAt: time().notNull(),
    closesAt: time().notNull(),
    ...timestamps,
  },
  (t) => [
    index('space_opening_hours_space_id_weekday_idx').on(t.spaceId, t.weekday),
    check('space_opening_hours_weekday_range', sql`${t.weekday} BETWEEN 0 AND 6`),
  ],
);

export const spacePhotos = pgTable(
  'space_photos',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    blurhash: text(),
    /** Ordem na galeria; a posição 0 é a capa. */
    position: integer().notNull(),
    ...timestamps,
  },
  (t) => [index('space_photos_space_id_position_idx').on(t.spaceId, t.position)],
);

export const spaceAmenities = pgTable(
  'space_amenities',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    amenityId: uuid()
      .notNull()
      .references(() => amenities.id),
    ...timestamps,
  },
  (t) => [
    unique('space_amenities_space_amenity_unique').on(t.spaceId, t.amenityId),
    index('space_amenities_amenity_id_idx').on(t.amenityId),
  ],
);

export const courts = pgTable(
  'courts',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    covered: boolean().notNull().default(false),
    status: courtStatus().notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [
    unique('courts_space_name_unique').on(t.spaceId, t.name),
    // Alvo das FKs compostas (court_id, space_id) de bookings e recurring_bookings: garante no
    // banco que a quadra pertence ao espaço do registro.
    unique('courts_id_space_id_unique').on(t.id, t.spaceId),
    index('courts_space_id_status_idx').on(t.spaceId, t.status),
  ],
);

/** Esportes permitidos por quadra e a capacidade para cada um (RN-BOOK-04). */
export const courtSports = pgTable(
  'court_sports',
  {
    id: id(),
    courtId: uuid()
      .notNull()
      .references(() => courts.id, { onDelete: 'cascade' }),
    sportId: uuid()
      .notNull()
      .references(() => sports.id),
    maxPlayers: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('court_sports_court_sport_unique').on(t.courtId, t.sportId),
    index('court_sports_sport_id_idx').on(t.sportId),
    // Decisão 18 (docs/07): até 20 jogadores por quadra.
    check('court_sports_max_players_range', sql`${t.maxPlayers} BETWEEN 1 AND 20`),
  ],
);

export const favorites = pgTable(
  'favorites',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    unique('favorites_user_space_unique').on(t.userId, t.spaceId),
    index('favorites_space_id_idx').on(t.spaceId),
  ],
);
