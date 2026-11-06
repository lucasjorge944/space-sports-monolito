import { isValidSpaceSlug } from './pending-space';

describe('isValidSpaceSlug', () => {
  it('aceita o formato de slug da API', () => {
    expect(isValidSpaceSlug('arena-exemplo')).toBe(true);
    expect(isValidSpaceSlug('quadra10')).toBe(true);
  });

  it('recusa o que não é slug', () => {
    for (const slug of ['', 'Arena', 'arena x', 'arena--x', '-arena', 'arena/x', 'a'.repeat(101)]) {
      expect(isValidSpaceSlug(slug)).toBe(false);
    }
  });
});

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  STORAGE_KEYS: { pendingSpaceSlug: 'space' },
  getStored: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setStored: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeStored: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

describe('destino guardado do deep link do espaço', () => {
  beforeEach(() => mockStore.clear());

  it('guarda a página ou a tela de avaliar (RF-REVIEW-02) e entrega uma vez só', async () => {
    const { savePendingSpace, takePendingSpace } = require('./pending-space');
    await savePendingSpace('arena-x', 'review');
    expect(await takePendingSpace()).toEqual({ slug: 'arena-x', screen: 'review' });
    expect(await takePendingSpace()).toBeNull();

    await savePendingSpace('arena-x');
    expect(await takePendingSpace()).toEqual({ slug: 'arena-x', screen: 'space' });
  });

  it('valor adulterado não vira destino', async () => {
    const { takePendingSpace } = require('./pending-space');
    mockStore.set('space', '../admin/avaliar');
    expect(await takePendingSpace()).toBeNull();
  });
});
