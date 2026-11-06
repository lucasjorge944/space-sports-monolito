import { CONTACT_ORIGINS } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import {
  canExportContacts,
  consentState,
  contactFilterParams,
  contactsCsvFilename,
  ORIGIN_LABEL,
} from './contacts';

const AT = '2026-10-01T12:00:00.000Z';

describe('consentState', () => {
  it('sem consentimento dado', () => {
    expect(consentState({ marketingConsentAt: null, unsubscribedAt: null })).toBe('none');
  });

  it('com consentimento dado', () => {
    expect(consentState({ marketingConsentAt: AT, unsubscribedAt: null })).toBe('consented');
  });

  it('o descadastro vence o consentimento', () => {
    expect(consentState({ marketingConsentAt: AT, unsubscribedAt: AT })).toBe('unsubscribed');
  });
});

describe('contactFilterParams', () => {
  it('não manda filtro vazio', () => {
    expect(contactFilterParams({ q: '', consent: '', origin: '' })).toEqual({});
  });

  it('manda só o que foi preenchido', () => {
    expect(contactFilterParams({ q: 'ana', consent: 'true', origin: 'DESK_BOOKING' })).toEqual({
      q: 'ana',
      consent: 'true',
      origin: 'DESK_BOOKING',
    });
  });
});

describe('exportação', () => {
  it('não exporta o filtro de quem não consentiu, que sairia vazio', () => {
    expect(canExportContacts('false')).toBe(false);
    expect(canExportContacts('true')).toBe(true);
    expect(canExportContacts('')).toBe(true);
  });

  it('nome do arquivo', () => {
    expect(contactsCsvFilename('arena', '2026-10-31')).toBe('contatos-arena-2026-10-31.csv');
  });
});

it('toda origem tem rótulo em português', () => {
  for (const origin of CONTACT_ORIGINS) expect(ORIGIN_LABEL[origin]).toBeTruthy();
});
