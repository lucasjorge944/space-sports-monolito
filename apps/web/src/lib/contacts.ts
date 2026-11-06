import type { ContactOrigin } from '@space-sports/shared';
import { CONTACT_ORIGINS } from '@space-sports/shared';

export const ORIGIN_LABEL: Record<ContactOrigin, string> = {
  BOOKING_INVITE_ORGANIZER: 'Convite do organizador',
  BOOKING_INVITE_SELF: 'Convite respondido',
  DESK_BOOKING: 'Reserva de balcão',
  RECURRING_DESK: 'Mensalista de balcão',
};

export const ORIGIN_OPTIONS = CONTACT_ORIGINS.map((value) => ({
  value,
  label: ORIGIN_LABEL[value],
}));

export type ConsentState = 'unsubscribed' | 'consented' | 'none';

/** O descadastro vence o consentimento: vale para todos os espaços (RN-CONTACT-05). */
export function consentState(contact: {
  marketingConsentAt: string | null;
  unsubscribedAt?: string | null;
}): ConsentState {
  if (contact.unsubscribedAt) return 'unsubscribed';
  return contact.marketingConsentAt ? 'consented' : 'none';
}

/** Filtros de texto da tela → parâmetros da API, sem os vazios. */
export function contactFilterParams(filters: { q: string; consent: string; origin: string }) {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.consent ? { consent: filters.consent } : {}),
    ...(filters.origin ? { origin: filters.origin as ContactOrigin } : {}),
  };
}

/** Sem consentimento o CSV sairia vazio: a exportação só traz quem deu (RF-CONTACT-06/07). */
export function canExportContacts(consent: string): boolean {
  return consent !== 'false';
}

export function contactsCsvFilename(prefix: string, today: string): string {
  return `contatos-${prefix}-${today}.csv`;
}
