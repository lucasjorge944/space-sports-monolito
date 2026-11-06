import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import MapaScreen from '@/app/(tabs)/mapa';
import { DEFAULT_FILTERS, setFilters } from '@/features/discovery/filters-store';

// Teste da aba Mapa (`app/(tabs)/mapa.tsx`). Fica fora de `app/` para o Expo Router não tratá-lo
// como rota.
jest.mock('react-native-maps', () => {
  const { createElement, forwardRef, useImperativeHandle } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const MapView = forwardRef((props: object, ref: unknown) => {
    useImperativeHandle(ref, () => ({ fitToCoordinates: jest.fn(), animateToRegion: jest.fn() }));
    return createElement(View, props);
  });
  return { __esModule: true, default: MapView, Marker: View };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/use-debounced-value', () => ({ useDebouncedValue: <T,>(value: T) => value }));
jest.mock('@/features/discovery/search-header', () => ({ SearchHeader: () => null }));
jest.mock('@/features/location/location-banner', () => ({ LocationBanner: () => null }));
let mockCoords: { lat: number; lng: number } | null = null;
jest.mock('@/features/location/location-provider', () => ({
  useLocation: () => ({ coords: mockCoords }),
}));

const mockSearch = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  searchSpaces: (...args: unknown[]) => mockSearch(...args),
}));

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe('Mapa: busca com os filtros da vitrine (RF-SPACE-07, decisão 109)', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockCoords = { lat: -19.9, lng: -43.9 };
    setFilters({ ...DEFAULT_FILTERS });
    mockSearch.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  });
  afterEach(() => client.clear());

  it('com "4+ estrelas" e "Melhor avaliados", manda minRating e nunca sort', async () => {
    setFilters({ minRating: 4, sort: 'rating' });
    await render(<MapaScreen />, { wrapper });
    await waitFor(() => expect(mockSearch).toHaveBeenCalled());
    const [params] = mockSearch.mock.calls[0] as [Record<string, unknown>];
    expect(params).toMatchObject({ minRating: 4, limit: 50, lat: -19.9, lng: -43.9 });
    for (const [call] of mockSearch.mock.calls as [Record<string, unknown>][]) {
      expect(call).not.toHaveProperty('sort');
    }
    // Sem pins com o "4+ estrelas", o aviso lembra a regra da nota pública.
    expect(await screen.findByTestId('mapa-vazio')).toHaveTextContent(
      /só mostra espaços com nota \(a partir de 5 avaliações\)/,
    );
  });

  it('sem filtros, não manda minRating nem sort', async () => {
    mockCoords = null;
    await render(<MapaScreen />, { wrapper });
    await waitFor(() => expect(mockSearch).toHaveBeenCalled());
    for (const [params] of mockSearch.mock.calls as [Record<string, unknown>][]) {
      expect(params).not.toHaveProperty('sort');
      expect(params).not.toHaveProperty('minRating');
    }
    expect(await screen.findByTestId('mapa-vazio')).toHaveTextContent(
      'Nenhum espaço com localização para estes filtros.',
    );
  });
});
