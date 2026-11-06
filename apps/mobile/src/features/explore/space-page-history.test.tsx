import { ApiError, type PublicSpace } from '@space-sports/api-client';
import { render, waitFor } from '@testing-library/react-native';
import EspacoScreen from '@/app/espaco/[slug]/index';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ slug: 'arena' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
}));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));
jest.mock('@/features/space/gallery', () => ({ Gallery: () => null }));
jest.mock('@/features/space/quick-info', () => ({ QuickInfo: () => null }));
jest.mock('@/features/space/rent-tab', () => ({ RentTab: () => null }));
jest.mock('@/features/space/space-info', () => ({ SpaceInfo: () => null }));
jest.mock('@/features/classes/classes-tab', () => ({ ClassesTab: () => null }));
jest.mock('@/features/reviews/reviews-block', () => ({
  ReviewsBlock: () => null,
  RatingHeaderLine: () => null,
}));

const mockRecord = jest.fn(async () => undefined);
const mockRemove = jest.fn(async () => undefined);
jest.mock('@/features/explore/recent-spaces-store', () => ({
  ...jest.requireActual('@/features/explore/recent-spaces-store'),
  recordRecentSpace: (...args: unknown[]) => mockRecord(...(args as [])),
  removeRecentSpace: (...args: unknown[]) => mockRemove(...(args as [])),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { document: {} } }));

let mockQuery: { isPending: boolean; isError: boolean; data?: PublicSpace; error?: unknown };
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceBySlug: () => ({ ...mockQuery, refetch: jest.fn() }),
}));

const space = {
  id: 's1',
  slug: 'arena',
  name: 'Arena Sol',
  logoUrl: null,
  address: {
    neighborhood: 'Savassi',
    city: { id: 'c1', name: 'Belo Horizonte', state: 'MG' },
  },
  photos: [{ id: 'p1', url: 'https://cdn.test/1.jpg', blurhash: null, position: 0 }],
  sports: [],
  services: [],
} as unknown as PublicSpace;

beforeEach(() => {
  mockRecord.mockClear();
  mockRemove.mockClear();
});

describe('página do espaço e o histórico de recentes (RF-SPACE-12)', () => {
  it('abrir a página grava o espaço no histórico do aparelho', async () => {
    mockQuery = { isPending: false, isError: false, data: space };
    await render(<EspacoScreen />);
    await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'arena',
        name: 'Arena Sol',
        neighborhood: 'Savassi',
        city: 'Belo Horizonte',
        cover: { url: 'https://cdn.test/1.jpg', blurhash: null },
      }),
    );
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('404 (removido, suspenso ou fora da vitrine) tira o espaço do histórico', async () => {
    mockQuery = {
      isPending: false,
      isError: true,
      error: new ApiError({ status: 404, code: 'SPACE_NOT_FOUND', message: 'Não encontrado' }),
    };
    await render(<EspacoScreen />);
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('arena'));
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('erro de rede não mexe no histórico', async () => {
    mockQuery = { isPending: false, isError: true, error: new TypeError('Network request failed') };
    await render(<EspacoScreen />);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
