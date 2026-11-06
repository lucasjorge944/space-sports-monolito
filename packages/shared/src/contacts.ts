import { z } from 'zod';
import { pageOf, pageQuerySchema } from './super';

// Base de contatos (RF-CONTACT-01 a RF-CONTACT-08, decisão 48).

/**
 * Como o contato chegou: convite com dados do organizador, página pública do convite (o próprio
 * convidado), reserva e mensalista de balcão.
 */
export const CONTACT_ORIGINS = [
  'BOOKING_INVITE_ORGANIZER',
  'BOOKING_INVITE_SELF',
  'DESK_BOOKING',
  'RECURRING_DESK',
] as const;
export const contactOriginSchema = z.enum(CONTACT_ORIGINS);
export type ContactOrigin = z.infer<typeof contactOriginSchema>;

const contactFilters = {
  /** Parte do nome, e-mail ou telefone. */
  q: z.string().trim().min(1).max(100).optional(),
  /** `true`: consentimento de marketing vigente (dado e sem descadastro). */
  consent: z.stringbool().optional(),
  origin: contactOriginSchema.optional(),
};

/**
 * GET /v1/manage/spaces/:spaceId/contacts: só os contatos que passaram pelo espaço. Os filtros
 * olham só o que foi informado ali, senão a busca revelaria dado de outro espaço.
 */
export const contactsQuerySchema = pageQuerySchema.extend(contactFilters);
export type ContactsQuery = z.infer<typeof contactsQuerySchema>;

/** Os mesmos filtros, na exportação CSV. */
export const contactsExportQuerySchema = z.object(contactFilters);
export type ContactsExportQuery = z.infer<typeof contactsExportQuerySchema>;

const superFilters = {
  /** `true`: com conta vinculada. */
  hasAccount: z.stringbool().optional(),
  spaceId: z.uuid().optional(),
};

/** GET /v1/super/contacts: a base inteira. */
export const superContactsQuerySchema = contactsQuerySchema.extend(superFilters);
export type SuperContactsQuery = z.infer<typeof superContactsQuerySchema>;

export const superContactsExportQuerySchema = contactsExportQuerySchema.extend(superFilters);
export type SuperContactsExportQuery = z.infer<typeof superContactsExportQuerySchema>;

/** O que foi informado em um espaço: nos touchpoints dele, o dado mais recente de cada campo. */
const spaceDataFields = {
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Consentimento dado naquele espaço. */
  marketingConsentAt: z.iso.datetime().nullable(),
  origins: z.array(contactOriginSchema),
  firstTouchAt: z.iso.datetime(),
  lastTouchAt: z.iso.datetime(),
};

/** Contato na gestão do espaço: só o que passou por ele, nunca o que veio de outro espaço. */
export const contactSchema = z.object({
  id: z.uuid(),
  ...spaceDataFields,
  /** O descadastro vale para todos os espaços; aqui, só aparece a quem tinha consentimento. */
  unsubscribedAt: z.iso.datetime().nullable(),
});
export type Contact = z.infer<typeof contactSchema>;

/** Contato no Super: os dados globais e o que foi informado em cada espaço. */
export const superContactSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  userId: z.uuid().nullable(),
  marketingConsentAt: z.iso.datetime().nullable(),
  unsubscribedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  spaces: z.array(z.object({ spaceId: z.uuid(), spaceName: z.string(), ...spaceDataFields })),
});
export type SuperContact = z.infer<typeof superContactSchema>;

export const contactPageSchema = pageOf(contactSchema);
export type ContactPage = z.infer<typeof contactPageSchema>;

export const superContactPageSchema = pageOf(superContactSchema);
export type SuperContactPage = z.infer<typeof superContactPageSchema>;

/** POST /v1/public/contacts/unsubscribe: o token assinado que vai em cada linha da exportação. */
export const unsubscribeContactSchema = z.object({ token: z.string().min(1).max(200) });
export type UnsubscribeContactInput = z.infer<typeof unsubscribeContactSchema>;

export const unsubscribeResultSchema = z.object({ unsubscribed: z.literal(true) });
export type UnsubscribeResult = z.infer<typeof unsubscribeResultSchema>;
