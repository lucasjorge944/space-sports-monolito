import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstzrange } from './columns.js';
import { occupationKind } from './enums.js';
import { users } from './identity.js';
import { courts } from './spaces.js';

/**
 * Agenda: fonte única de ocupação das quadras (reservas, aulas, partidas e bloqueios).
 * A constraint `court_occupations_no_overlap` (EXCLUDE USING gist, criada na migração
 * `0002_court_occupations_exclusion`) impede duas ocupações ativas sobrepostas na mesma quadra
 * (RN-BOOK-03). O Drizzle não modela EXCLUDE, por isso ela não aparece aqui.
 */
export const courtOccupations = pgTable(
  'court_occupations',
  {
    id: id(),
    courtId: uuid()
      .notNull()
      .references(() => courts.id, { onDelete: 'cascade' }),
    /** Sempre `[início, fim)`, finito e não vazio. */
    period: tstzrange().notNull(),
    kind: occupationKind().notNull(),
    /** Id da origem conforme `kind`: bookings, class_sessions, matches ou court_blocks. */
    refId: uuid().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('court_occupations_kind_ref_id_idx').on(t.kind, t.refId),
    check(
      'court_occupations_period_valid',
      sql`NOT isempty(${t.period}) AND NOT lower_inf(${t.period}) AND NOT upper_inf(${t.period}) AND lower_inc(${t.period}) AND NOT upper_inc(${t.period})`,
    ),
  ],
);

/** Bloqueios manuais da quadra (manutenção, evento). Ocupam a agenda com kind = BLOCK. */
export const courtBlocks = pgTable(
  'court_blocks',
  {
    id: id(),
    courtId: uuid()
      .notNull()
      .references(() => courts.id, { onDelete: 'cascade' }),
    period: tstzrange().notNull(),
    reason: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('court_blocks_court_id_idx').on(t.courtId),
    index('court_blocks_created_by_idx').on(t.createdBy),
    check(
      'court_blocks_period_valid',
      sql`NOT isempty(${t.period}) AND NOT lower_inf(${t.period}) AND NOT upper_inf(${t.period})`,
    ),
  ],
);
