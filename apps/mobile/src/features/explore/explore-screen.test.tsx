import { ApiError, type ListAdsParams } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus, Linking } from 'react-native';
import { DEFAULT_FILTERS, getFilters, setFilters } from '@/features/discovery/filters-store';
import { adEvents } from './ad-events';
import { ExploreScreen } from './explore-screen';
import {
  recentSpacesFile,
  recordRecentSpace,
  resetRecentSpacesForTests,
} from './recent-spaces-store';
import { makeAd, makeSpace, makeSpaces } from './test-fixtures';
import { TOKEN_REFRESH_MARGIN_MS } from './use-ads';

const mockPush = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => mockFocused,
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('@/lib/use-debounced-value', () => ({ useDebouncedValue: <T,>(value: T) => value }));
jest.mock('@/features/discovery/search-header', () => ({ SearchHeader: () => null }));
jest.mock('@/features/location/location-banner', () => ({ LocationBanner: () => null }));
let mockCoords: { lat: number; lng: number } | null = null;
jest.mock('@/features/location/location-provider', () => ({
  useLocation: () => ({ coords: mockCoords }),
}));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ state: { status: 'signed-out' } }),
}));
// A FlashList precisa de medidas reais; nos testes a FlatList cobre o mesmo contrato.
jest.mock('@shopify/flash-list', () => ({
  FlashList: jest.requireActual('react-native').FlatList,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { document: {} } }));

const mockListAds = jest.fn();
const mockSearch = jest.fn();
const SPORTS = [
  { id: '1', slug: 'beach-tennis', name: 'Beach Tennis', icon: null, defaultMaxPlayers: 4 },
  { id: '2', slug: 'futevolei', name: 'Futevôlei', icon: null, defaultMaxPlayers: 4 },
];
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  listAds: (...args: unknown[]) => mockListAds(...args),
  searchSpaces: (...args: unknown[]) => mockSearch(...args),
  sendAdEvents: jest.fn(async () => ({ accepted: 1 })),
  useListSports: () => ({
    data: { items: SPORTS },
    isPending: false,
    refetch: jest.fn(async () => undefined),
  }),
  useListRecentSpaces: () => ({ data: undefined, isPending: false, refetch: jest.fn() }),
}));

const HIDDEN = { includeHiddenElements: true };
const heroAd = makeAd('hero', { placement: 'EXPLORE_HERO', title: 'Raquetes com 30% off' });
const feedAd = makeAd('feed', { title: 'Whey para o pós-jogo' });

const clients: QueryClient[] = [];
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderExplore() {
  const result = await render(<ExploreScreen />, { wrapper });
  await waitFor(() => expect(screen.getByTestId('espaco-card-espaco-0')).toBeTruthy());
  return result;
}

let appStateListeners: Array<(state: AppStateStatus) => void> = [];
async function emitAppState(...states: AppStateStatus[]) {
  for (const state of states) {
    await act(async () => {
      for (const listener of appStateListeners) listener(state);
    });
  }
}
const adCalls = (placement: string) =>
  mockListAds.mock.calls.filter(([params]) => (params as ListAdsParams).placement === placement);

beforeEach(() => {
  mockCoords = null;
  mockFocused = true;
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    const fn = listener as (state: AppStateStatus) => void;
    appStateListeners.push(fn);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((other) => other !== fn);
      },
    } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  mockPush.mockClear();
  setFilters({ ...DEFAULT_FILTERS });
  resetRecentSpacesForTests();
  jest.spyOn(recentSpacesFile, 'read').mockResolvedValue(null);
  jest.spyOn(recentSpacesFile, 'write').mockResolvedValue();
  mockSearch.mockReset().mockResolvedValue({ items: makeSpaces(12), nextCursor: null });
  mockListAds.mockReset().mockImplementation(async (params: ListAdsParams) => ({
    items: params.placement === 'EXPLORE_HERO' ? [heroAd] : [feedAd],
  }));
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const client of clients.splice(0)) client.clear();
});

describe('Explorar (RF-SPACE-12, RF-SPACE-13, RF-ADS-04 a 06)', () => {
  it('sem busca nem filtro: atalhos, carrossel, recentes e "Espaços perto de você"', async () => {
    mockCoords = { lat: -19.9, lng: -43.9 };
    await recordRecentSpace({ ...makeSpace(50), viewedAt: '2026-11-03T10:00:00Z' });
    await renderExplore();
    expect(screen.getByTestId('explorar-atalhos')).toBeTruthy();
    expect(await screen.findByTestId('explorar-carrossel')).toBeTruthy();
    expect(screen.getByTestId('explorar-recente-espaco-50')).toBeTruthy();
    expect(screen.getByTestId('explorar-titulo-lista')).toHaveTextContent('Espaços perto de você');
  });

  it('sem localização, o título é "Espaços"', async () => {
    await renderExplore();
    expect(screen.getByTestId('explorar-titulo-lista')).toHaveTextContent('Espaços');
  });

  it('pede os anúncios de cada vaga com as coordenadas (2 casas) e o esporte atuais', async () => {
    mockCoords = { lat: -19.912345, lng: -43.937891 };
    setFilters({ sport: 'futevolei' });
    await renderExplore();
    await waitFor(() =>
      expect(mockListAds).toHaveBeenCalledWith(
        { placement: 'EXPLORE_FEED', lat: -19.91, lng: -43.94, sport: 'futevolei' },
        expect.anything(),
      ),
    );
    // Com filtro, o carrossel some e a vaga dele nem é pedida.
    expect(mockListAds).not.toHaveBeenCalledWith(
      expect.objectContaining({ placement: 'EXPLORE_HERO' }),
      expect.anything(),
    );
  });

  it('filtro de esporte: atalhos ficam (com o esporte marcado); carrossel e recentes somem', async () => {
    await recordRecentSpace({ ...makeSpace(50), viewedAt: '2026-11-03T10:00:00Z' });
    setFilters({ sport: 'futevolei' });
    await renderExplore();
    expect(screen.getByTestId('explorar-atalho-futevolei')).toBeSelected();
    expect(screen.getByTestId('explorar-atalho-beach-tennis')).not.toBeSelected();
    expect(screen.queryByTestId('explorar-carrossel')).toBeNull();
    expect(screen.queryByTestId('explorar-recentes')).toBeNull();
    expect(screen.getByTestId('explorar-titulo-lista')).toHaveTextContent('Resultados');
    // Os cards patrocinados continuam na lista.
    expect(await screen.findByTestId('explorar-anuncio-card-feed')).toBeTruthy();
  });

  it('busca por nome esconde atalhos, carrossel e recentes', async () => {
    setFilters({ q: 'Espaço' });
    await renderExplore();
    expect(screen.queryByTestId('explorar-atalhos')).toBeNull();
    expect(screen.queryByTestId('explorar-carrossel')).toBeNull();
    expect(screen.getByTestId('explorar-titulo-lista')).toHaveTextContent('Resultados');
  });

  it('o raio sozinho não esconde nada nem troca o título', async () => {
    mockCoords = { lat: -19.9, lng: -43.9 };
    setFilters({ radiusKm: 50 });
    await renderExplore();
    expect(screen.getByTestId('explorar-atalhos')).toBeTruthy();
    expect(await screen.findByTestId('explorar-carrossel')).toBeTruthy();
    expect(screen.getByTestId('explorar-titulo-lista')).toHaveTextContent('Espaços perto de você');
  });

  it.each([
    ['"4+ estrelas"', { minRating: 4 }, { minRating: 4 }],
    ['"Melhor avaliados"', { sort: 'rating' as const }, { sort: 'rating' }],
  ])(
    '%s: busca com o filtro; atalhos ficam; carrossel e recentes somem',
    async (_, patch, sent) => {
      mockCoords = { lat: -19.9, lng: -43.9 };
      await recordRecentSpace({ ...makeSpace(50), viewedAt: '2026-11-03T10:00:00Z' });
      setFilters(patch);
      await renderExplore();
      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining(sent), expect.anything());
      expect(screen.getByTestId('explorar-atalhos')).toBeTruthy();
      expect(screen.queryByTestId('explorar-carrossel')).toBeNull();
      expect(screen.queryByTestId('explorar-recentes')).toBeNull();
      expect(screen.getByTestId('explorar-titulo-lista')).toHaveTextContent('Resultados');
    },
  );

  it('vazio com só o "4+ estrelas": explica a nota a partir de 5 avaliações e tira o filtro', async () => {
    setFilters({ minRating: 4, sort: 'rating' });
    mockSearch.mockResolvedValue({ items: [], nextCursor: null });
    await render(<ExploreScreen />, { wrapper });
    const empty = await screen.findByTestId('explorar-vazio-nota');
    expect(empty).toHaveTextContent(/Nenhum espaço com 4\+ estrelas/);
    expect(empty).toHaveTextContent(/a nota aparece a partir de 5 avaliações/);
    expect(screen.queryByTestId('explorar-vazio-limpar')).toBeNull();
    mockSearch.mockResolvedValue({ items: makeSpaces(2), nextCursor: null });
    await fireEvent.press(screen.getByTestId('explorar-vazio-tirar-nota'));
    // Só o "4+ estrelas" sai; a ordem continua.
    expect(getFilters()).toMatchObject({ minRating: null, sort: 'rating' });
    await waitFor(() => expect(screen.getByTestId('espaco-card-espaco-0')).toBeTruthy());
    expect(mockSearch).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ minRating: expect.anything() }),
      expect.anything(),
    );
  });

  it('vazio com "4+ estrelas" e outro filtro: vazio genérico com "Tirar" e "Limpar filtros"', async () => {
    setFilters({ minRating: 4, sport: 'futevolei' });
    mockSearch.mockResolvedValue({ items: [], nextCursor: null });
    await render(<ExploreScreen />, { wrapper });
    const empty = await screen.findByTestId('explorar-vazio');
    expect(screen.queryByTestId('explorar-vazio-nota')).toBeNull();
    expect(empty).toHaveTextContent(/Nenhum espaço encontrado/);
    expect(empty).toHaveTextContent(/só mostra espaços com nota \(a partir de 5 avaliações\)/);
    expect(screen.getByTestId('explorar-vazio-limpar')).toHaveTextContent('Limpar filtros');
    mockSearch.mockResolvedValue({ items: makeSpaces(2), nextCursor: null });
    await fireEvent.press(screen.getByTestId('explorar-vazio-tirar-nota'));
    // "Tirar" mantém o esporte.
    expect(getFilters()).toMatchObject({ minRating: null, sport: 'futevolei' });
    await waitFor(() => expect(screen.getByTestId('espaco-card-espaco-0')).toBeTruthy());
  });

  it('vazio com "4+ estrelas" e busca por nome: "Limpar busca e filtros" tira tudo', async () => {
    setFilters({ minRating: 4, q: 'arena' });
    mockSearch.mockResolvedValue({ items: [], nextCursor: null });
    await render(<ExploreScreen />, { wrapper });
    await screen.findByTestId('explorar-vazio');
    expect(screen.queryByTestId('explorar-vazio-nota')).toBeNull();
    expect(screen.getByTestId('explorar-vazio-tirar-nota')).toBeTruthy();
    const clear = screen.getByTestId('explorar-vazio-limpar');
    expect(clear).toHaveTextContent('Limpar busca e filtros');
    mockSearch.mockResolvedValue({ items: makeSpaces(2), nextCursor: null });
    await fireEvent.press(clear);
    expect(getFilters()).toEqual(DEFAULT_FILTERS);
    await waitFor(() => expect(screen.getByTestId('espaco-card-espaco-0')).toBeTruthy());
  });

  it('vazio sem "4+ estrelas" segue com "Limpar filtros"', async () => {
    setFilters({ sport: 'futevolei', sort: 'rating' });
    mockSearch.mockResolvedValue({ items: [], nextCursor: null });
    await render(<ExploreScreen />, { wrapper });
    expect(await screen.findByText('Tente outro nome ou afrouxe os filtros.')).toBeTruthy();
    expect(screen.queryByTestId('explorar-vazio-nota')).toBeNull();
    expect(screen.queryByTestId('explorar-vazio-tirar-nota')).toBeNull();
    mockSearch.mockResolvedValue({ items: makeSpaces(2), nextCursor: null });
    await fireEvent.press(screen.getByText('Limpar filtros'));
    expect(getFilters()).toEqual(DEFAULT_FILTERS);
    await waitFor(() => expect(screen.getByTestId('espaco-card-espaco-0')).toBeTruthy());
  });

  it('tocar no atalho aplica o filtro de esporte; tocar de novo tira', async () => {
    await renderExplore();
    await fireEvent.press(screen.getByTestId('explorar-atalho-beach-tennis'));
    expect(getFilters().sport).toBe('beach-tennis');
    await fireEvent.press(screen.getByTestId('explorar-atalho-beach-tennis'));
    expect(getFilters().sport).toBeNull();
  });

  it('card patrocinado na 3ª posição, com o selo "Patrocinado · <anunciante>"', async () => {
    await renderExplore();
    const card = await screen.findByTestId('explorar-anuncio-card-feed');
    expect(within(card).getByText('Whey para o pós-jogo')).toBeTruthy();
    expect(within(card).getByText('Patrocinado', HIDDEN)).toBeTruthy();
    expect(within(card).getByText(' · Anunciante feed', HIDDEN)).toBeTruthy();
    expect(card.props.accessibilityLabel).toMatch(/^Patrocinado, Anunciante feed\./);
    const ids = screen
      .getAllByTestId(/^(espaco-card|explorar-anuncio-card)-/)
      .map((node) => node.props.testID);
    expect(ids.slice(0, 4)).toEqual([
      'espaco-card-espaco-0',
      'espaco-card-espaco-1',
      'explorar-anuncio-card-feed',
      'espaco-card-espaco-2',
    ]);
  });

  it('banner do carrossel com selo e rótulo próprio', async () => {
    await renderExplore();
    const banner = await screen.findByTestId('explorar-anuncio-banner-hero');
    expect(banner.props.accessibilityLabel).toBe(
      'Patrocinado, Anunciante hero. Raquetes com 30% off. Texto hero. Ver ofertas',
    );
    expect(within(banner).getByText(' · Anunciante hero', HIDDEN)).toBeTruthy();
  });

  it('anunciante espaço sem imagem usa o card do espaço com o selo', async () => {
    const space = makeSpace(77, { name: 'Arena Patrocinada' });
    mockListAds.mockImplementation(async (params: ListAdsParams) => ({
      items:
        params.placement === 'EXPLORE_FEED'
          ? [
              makeAd('sp', {
                imageUrl: null,
                advertiser: { name: 'Arena Patrocinada', kind: 'SPACE' },
                destination: { type: 'SPACE', space },
              }),
            ]
          : [],
    }));
    await renderExplore();
    const card = await screen.findByTestId('explorar-anuncio-card-sp');
    expect(within(card).getByText('Arena Patrocinada')).toBeTruthy();
    expect(card.props.accessibilityLabel).toMatch(/^Patrocinado, Arena Patrocinada, Arena/);
    await fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]',
      params: { slug: 'espaco-77' },
    });
  });

  it('tocar no anúncio conta o clique e abre o destino', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const click = jest.spyOn(adEvents, 'click');
    await renderExplore();
    await fireEvent.press(await screen.findByTestId('explorar-anuncio-card-feed'));
    expect(openURL).toHaveBeenCalledWith('https://www.example.com/feed');
    await waitFor(() =>
      expect(click).toHaveBeenCalledWith(expect.objectContaining({ creativeId: 'feed' })),
    );
  });

  it('destino que não abre (sem app ou URL recusada) não conta o clique', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const click = jest.spyOn(adEvents, 'click');
    await renderExplore();
    await fireEvent.press(await screen.findByTestId('explorar-anuncio-card-feed'));
    await act(async () => undefined);
    expect(click).not.toHaveBeenCalled();
  });

  it('falha ou 429 nos anúncios não mostra erro, não segura a lista e não tenta de novo', async () => {
    mockListAds.mockRejectedValue(
      new ApiError({ status: 429, code: 'TOO_MANY_REQUESTS', message: 'Muitas requisições' }),
    );
    await renderExplore();
    await act(async () => undefined);
    expect(screen.queryByTestId('explorar-carrossel')).toBeNull();
    expect(screen.queryByTestId('explorar-anuncio-card-feed')).toBeNull();
    expect(screen.queryByText(/tentar de novo/i)).toBeNull();
    expect(screen.getByTestId('espaco-card-espaco-2')).toBeTruthy();
    // Uma chamada por vaga, sem nova tentativa.
    expect(mockListAds).toHaveBeenCalledTimes(2);
  });

  it('lista de anúncios vazia: sem carrossel e sem card patrocinado', async () => {
    mockListAds.mockResolvedValue({ items: [] });
    await renderExplore();
    await act(async () => undefined);
    expect(screen.queryByTestId('explorar-carrossel')).toBeNull();
    expect(screen.queryByTestId(/^explorar-anuncio-card-/)).toBeNull();
  });
});

describe('Explorar: nova entrega a cada abertura (RF-ADS-08)', () => {
  async function renderWithAds() {
    const result = await renderExplore();
    await screen.findByTestId('explorar-anuncio-card-feed');
    await waitFor(() => expect(mockListAds).toHaveBeenCalledTimes(2));
    return result;
  }

  it('voltar do segundo plano busca as duas vagas de novo, uma vez cada', async () => {
    await renderWithAds();
    await emitAppState('inactive', 'background', 'active');
    await waitFor(() => expect(mockListAds).toHaveBeenCalledTimes(4));
    expect(adCalls('EXPLORE_HERO')).toHaveLength(2);
    expect(adCalls('EXPLORE_FEED')).toHaveLength(2);
  });

  it('o "inactive" do iOS (sem ir para segundo plano) não conta como abertura', async () => {
    await renderWithAds();
    await emitAppState('inactive', 'active');
    await act(async () => undefined);
    expect(mockListAds).toHaveBeenCalledTimes(2);
  });

  it('a aba ganhar o foco de novo busca as duas vagas de novo', async () => {
    const { rerender } = await renderWithAds();
    mockFocused = false;
    await rerender(<ExploreScreen />);
    await act(async () => undefined);
    expect(mockListAds).toHaveBeenCalledTimes(2);
    mockFocused = true;
    await rerender(<ExploreScreen />);
    await waitFor(() => expect(mockListAds).toHaveBeenCalledTimes(4));
  });

  it('campanha que saiu da nova entrega some das vagas ainda não vistas', async () => {
    await renderWithAds();
    mockListAds.mockImplementation(async (params: ListAdsParams) => ({
      items: params.placement === 'EXPLORE_HERO' ? [heroAd] : [makeAd('nova')],
    }));
    await emitAppState('background', 'active');
    expect(await screen.findByTestId('explorar-anuncio-card-nova')).toBeTruthy();
    expect(screen.queryByTestId('explorar-anuncio-card-feed')).toBeNull();
  });

  it('a nova abertura conta de novo a impressão, com o token da nova entrega', async () => {
    const impression = jest.spyOn(adEvents, 'impression');
    const startSession = jest.spyOn(adEvents, 'startSession');
    await renderWithAds();
    startSession.mockClear();
    mockListAds.mockImplementation(async (params: ListAdsParams) => ({
      items: [
        params.placement === 'EXPLORE_HERO'
          ? { ...heroAd, deliveryToken: 'token-hero-2' }
          : { ...feedAd, deliveryToken: 'token-feed-2' },
      ],
    }));
    await emitAppState('background', 'active');
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    // O carrossel na tela conta com o token novo depois de 1 s.
    await waitFor(
      () =>
        expect(impression).toHaveBeenCalledWith(
          expect.objectContaining({ deliveryToken: 'token-hero-2' }),
        ),
      { timeout: 2500 },
    );
  });

  it('token perto de vencer gera nova entrega sem esperar outra abertura', async () => {
    let feedCalls = 0;
    mockListAds.mockImplementation(async (params: ListAdsParams) => {
      if (params.placement === 'EXPLORE_HERO') return { items: [] };
      feedCalls += 1;
      const expiresAt = new Date(Date.now() + TOKEN_REFRESH_MARGIN_MS + 50).toISOString();
      return {
        items: [
          feedCalls === 1
            ? { ...feedAd, tokenExpiresAt: expiresAt }
            : { ...feedAd, deliveryToken: 'token-feed-2' },
        ],
      };
    });
    await renderExplore();
    await waitFor(() => expect(adCalls('EXPLORE_FEED')).toHaveLength(2));
    // A entrega nova (token de 2 h) não agenda outra busca logo em seguida.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(adCalls('EXPLORE_FEED')).toHaveLength(2);
  });
});
