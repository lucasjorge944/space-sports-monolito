import {
  hasPendingInvite,
  isValidInviteToken,
  savePendingInvite,
  takePendingInvite,
} from './pending-invite';

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  STORAGE_KEYS: { pendingInviteToken: 'pending' },
  getStored: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setStored: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeStored: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

beforeEach(() => mockStore.clear());

describe('convite pendente', () => {
  it('valida o formato do token', () => {
    expect(isValidInviteToken('abcDEF123_-xyz')).toBe(true);
    expect(isValidInviteToken('curto')).toBe(false);
    expect(isValidInviteToken('../../admin/x1')).toBe(false);
  });

  it('guarda e devolve uma vez só', async () => {
    await savePendingInvite('tok12345678');
    expect(await hasPendingInvite()).toBe(true);
    expect(await takePendingInvite()).toBe('tok12345678');
    expect(await takePendingInvite()).toBeNull();
  });

  it('não guarda token inválido', async () => {
    await savePendingInvite('x/y');
    expect(await hasPendingInvite()).toBe(false);
  });
});
