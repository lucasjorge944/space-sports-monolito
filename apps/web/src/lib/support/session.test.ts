import { describe, expect, it } from 'vitest';
import { isExpired, type StoredSupportSession, supportHeadersFor } from './session';

const session: StoredSupportSession = {
  id: 'sess-1',
  spaceId: 'space-1',
  spaceName: 'Espaço A',
  spaceSlug: 'espaco-a',
  spaceStatus: 'ACTIVE',
  expiresAt: '2026-10-28T15:00:00.000Z',
};

describe('supportHeadersFor', () => {
  it('envia o header nas rotas de gestão do espaço da sessão', () => {
    expect(supportHeadersFor('/v1/manage/spaces/space-1/courts', session)).toEqual({
      'X-Support-Session': 'sess-1',
    });
    expect(supportHeadersFor('/v1/manage/spaces/space-1', session)).toBeDefined();
  });

  it('não envia para outro espaço, rotas fora da gestão ou sem sessão', () => {
    expect(supportHeadersFor('/v1/manage/spaces/space-2/courts', session)).toBeUndefined();
    expect(supportHeadersFor('/v1/me', session)).toBeUndefined();
    expect(supportHeadersFor('/v1/super/spaces/space-1', session)).toBeUndefined();
    expect(supportHeadersFor('/v1/manage/spaces/space-1/courts', null)).toBeUndefined();
  });
});

describe('isExpired', () => {
  it('compara com o relógio informado', () => {
    expect(isExpired(session, Date.parse('2026-10-28T14:59:59.000Z'))).toBe(false);
    expect(isExpired(session, Date.parse('2026-10-28T15:00:00.000Z'))).toBe(true);
  });
});
