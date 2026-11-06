import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import { contactOrigin } from './enums.js';
import { users } from './identity.js';
import { bookings } from './rental.js';
import { spaces } from './spaces.js';

/**
 * Base de contatos (RF-CONTACT-01, decisão 48): quem foi convidado ou reservou no balcão, com ou
 * sem conta. Os dados não são verificados: `user_id` só vem do link aceito, do e-mail verificado
 * da conta ou da confirmação do organizador ou da gestão. Marketing só com `marketing_consent_at`
 * e sem `unsubscribed_at`.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    /** Nulo enquanto o organizador só informou o telefone ou o e-mail. */
    name: text(),
    /** Normalizado como `users.email`. Só entra na criação do contato (ver `upsertContact`). */
    email: text(),
    /** E.164. */
    phone: text(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    marketingConsentAt: tstz(),
    unsubscribedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('contacts_email_unique').on(t.email).where(sql`${t.email} IS NOT NULL`),
    uniqueIndex('contacts_phone_unique').on(t.phone).where(sql`${t.phone} IS NOT NULL`),
    index('contacts_user_id_idx').on(t.userId),
    check('contacts_email_or_phone', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
    check('contacts_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('contacts_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
  ],
);

/**
 * Cada passagem do contato por um espaço, com o que foi informado ali (decisão 48). `contacts` é
 * global e só o Super o lê: a gestão de um espaço vê apenas os touchpoints dele, para que nome,
 * e-mail, telefone e consentimento dados em um espaço nunca cheguem a outro.
 */
export const contactTouchpoints = pgTable(
  'contact_touchpoints',
  {
    id: id(),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    origin: contactOrigin().notNull(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    /** Nulo no mensalista de balcão. */
    bookingId: uuid().references(() => bookings.id, { onDelete: 'set null' }),
    /** Quem digitou; nulo quando foi o próprio convidado, na página pública. */
    capturedBy: uuid().references(() => users.id),
    /** Como foram informados aqui, mesmo que não tenham entrado em `contacts`. */
    name: text(),
    email: text(),
    phone: text(),
    /** Consentimento dado nesta passagem: é o que libera a exportação deste espaço. */
    marketingConsentAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index('contact_touchpoints_contact_id_idx').on(t.contactId),
    index('contact_touchpoints_space_id_contact_id_idx').on(t.spaceId, t.contactId),
    index('contact_touchpoints_booking_id_idx').on(t.bookingId),
    index('contact_touchpoints_email_idx').on(t.email),
    index('contact_touchpoints_phone_idx').on(t.phone),
    check(
      'contact_touchpoints_email_or_phone',
      sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`,
    ),
    check('contact_touchpoints_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('contact_touchpoints_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
  ],
);
