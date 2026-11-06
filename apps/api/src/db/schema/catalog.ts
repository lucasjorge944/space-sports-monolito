import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns.js';

// Catálogos geridos no Super.

export const cities = pgTable(
  'cities',
  {
    id: id(),
    name: text().notNull(),
    /** UF com 2 letras (ex.: MG). */
    state: text().notNull(),
    /** Fuso IANA usado para exibir as datas do espaço (ex.: America/Sao_Paulo). */
    timezone: text().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('cities_name_state_unique').on(t.name, t.state),
    check('cities_state_format', sql`${t.state} ~ '^[A-Z]{2}$'`),
  ],
);

export const sports = pgTable(
  'sports',
  {
    id: id(),
    /** Ex.: futevolei, beach-tennis, volei-praia. */
    slug: text().notNull().unique('sports_slug_unique'),
    name: text().notNull(),
    icon: text(),
    defaultMaxPlayers: integer(),
    ...timestamps,
  },
  (t) => [check('sports_default_max_players_positive', sql`${t.defaultMaxPlayers} > 0`)],
);

export const amenities = pgTable('amenities', {
  id: id(),
  slug: text().notNull().unique('amenities_slug_unique'),
  name: text().notNull(),
  icon: text(),
  ...timestamps,
});
