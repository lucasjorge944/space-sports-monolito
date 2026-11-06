import type { MyReviewPage } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, FlatList } from 'react-native';
import { MyReviewsScreen, TARGET_MAX_PAGES } from './my-reviews-screen';
import { myReviewItem, SPACE_ID } from './test-fixtures';

const mockRouter = { push: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));
jest.mock('@shopify/flash-list', () => ({
  FlashList: jest.requireActual('react-native').FlatList,
}));

const mockList = jest.fn();
const mockDelete = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  listMyReviews: (...args: unknown[]) => mockList(...args),
  useDeleteMyReview: () => ({ mutate: mockDelete, isPending: false }),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyReviewsScreen />
    </QueryClientProvider>,
  );
}

const page = (items: MyReviewPage['items'], nextCursor: string | null = null): MyReviewPage => ({
  items,
  nextCursor,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});
afterEach(() => jest.restoreAllMocks());

describe('Minhas avaliações (RF-REVIEW-08)', () => {
  it('lista e abre a tela de avaliar para editar', async () => {
    mockList.mockResolvedValue(page([myReviewItem()]));
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('minhas-avaliacoes-item-r-mine'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/avaliar',
      params: { slug: 'arena-sol' },
    });
    await fireEvent.press(screen.getByTestId('minhas-avaliacoes-menu-r-mine'));
    expect(screen.getByTestId('minhas-avaliacoes-editar-r-mine')).toBeTruthy();
  });

  it('só leitura (equipe): sem "Editar", com "Excluir"', async () => {
    mockList.mockResolvedValue(page([myReviewItem({ canEdit: false })]));
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('minhas-avaliacoes-menu-r-mine'));
    expect(screen.queryByTestId('minhas-avaliacoes-editar-r-mine')).toBeNull();
    expect(screen.getByTestId('minhas-avaliacoes-excluir-r-mine')).toBeTruthy();
  });

  it('excluir confirma e chama a API', async () => {
    mockList.mockResolvedValue(page([myReviewItem()]));
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('minhas-avaliacoes-menu-r-mine'));
    await fireEvent.press(screen.getByTestId('minhas-avaliacoes-excluir-r-mine'));
    // O Alert espera o menu fechar (no iOS, abrir no mesmo toque falha sem erro).
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    alert.mock.calls[0]?.[2]?.find((b) => b.text === 'Excluir')?.onPress?.();
    expect(mockDelete).toHaveBeenCalledWith({ spaceId: SPACE_ID }, expect.anything());
  });

  it('"Ver no espaço" abre a página depois que o menu fecha', async () => {
    mockList.mockResolvedValue(page([myReviewItem()]));
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('minhas-avaliacoes-menu-r-mine'));
    await fireEvent.press(screen.getByTestId('minhas-avaliacoes-ver-espaco-r-mine'));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/espaco/[slug]',
        params: { slug: 'arena-sol' },
      }),
    );
  });

  it('mostra "bairro · cidade" do espaço', async () => {
    mockList.mockResolvedValue(page([myReviewItem()]));
    await renderScreen();
    expect(await screen.findByTestId('minhas-avaliacoes-local-r-mine')).toHaveTextContent(
      'Centro · Cidade Teste',
    );
  });

  it('sem bairro, só a cidade', async () => {
    mockList.mockResolvedValue(
      page([myReviewItem({ space: { ...myReviewItem().space, neighborhood: null } })]),
    );
    await renderScreen();
    expect(await screen.findByTestId('minhas-avaliacoes-local-r-mine')).toHaveTextContent(
      /^Cidade Teste$/,
    );
  });

  it('push review.replied (?avaliacao=): carrega as páginas até achar e rola até o item', async () => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    mockParams = { avaliacao: 'r-alvo' };
    mockList.mockImplementation(async (params: { cursor?: string }) =>
      params.cursor
        ? page([myReviewItem({ id: 'r-alvo', spaceId: 's2' })])
        : page([myReviewItem()], 'c2'),
    );
    await renderScreen();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ index: 1, animated: true }));
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList.mock.calls[1]?.[0]).toEqual({ limit: 20, cursor: 'c2' });
    expect(screen.getByTestId('minhas-avaliacoes-item-r-alvo')).toBeTruthy();
  });

  it('push review.replied: desiste depois do limite de páginas sem achar', async () => {
    const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    mockParams = { avaliacao: 'r-sumiu' };
    let n = 0;
    mockList.mockImplementation(async () => {
      n += 1;
      return page([myReviewItem({ id: `r-${n}` })], `c${n + 1}`);
    });
    await renderScreen();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(TARGET_MAX_PAGES));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockList).toHaveBeenCalledTimes(TARGET_MAX_PAGES);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('comentário oculto aparece só para a pessoa, com o aviso', async () => {
    mockList.mockResolvedValue(page([myReviewItem({ commentHidden: true })]));
    await renderScreen();
    expect(await screen.findByText('Quadra ótima.')).toBeTruthy();
    expect(screen.getByText(/só você vê este comentário/)).toBeTruthy();
  });

  it('espaço fora da vitrine: avisa e não abre', async () => {
    mockList.mockResolvedValue(
      page([
        myReviewItem({
          canEdit: false,
          space: { ...myReviewItem().space, inShowcase: false },
        }),
      ]),
    );
    await renderScreen();
    expect(await screen.findByText('Este espaço não está mais no app.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('minhas-avaliacoes-item-r-mine'));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('vazio', async () => {
    mockList.mockResolvedValue(page([]));
    await renderScreen();
    expect(await screen.findByText('Você ainda não avaliou nenhum espaço')).toBeTruthy();
  });
});
