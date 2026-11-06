import {
  ApiError,
  type PublicReviewPage,
  type ReviewEligibility,
  type ReviewSummary,
} from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReviewsListScreen } from './reviews-list-screen';
import { eligibility, publicReview, SPACE_ID, summary } from './test-fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
let mockParams: Record<string, string> = { slug: 'arena-sol' };
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
// A FlashList precisa de medidas reais; nos testes a FlatList cobre o mesmo contrato.
jest.mock('@shopify/flash-list', () => ({
  FlashList: jest.requireActual('react-native').FlatList,
}));

let mockSummary: ReviewSummary;
let mockEligibility: ReviewEligibility;
const mockList = jest.fn();
const mockReport = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceBySlug: () => ({
    data: (require('./test-fixtures') as typeof import('./test-fixtures')).reviewSpace(),
    isPending: false,
    isError: false,
  }),
  useGetSpaceReviewSummary: () => ({ data: mockSummary, refetch: jest.fn() }),
  useGetReviewEligibility: () => ({ data: mockEligibility }),
  useDeleteMyReview: () => ({ mutate: jest.fn(), isPending: false }),
  useReportReview: () => ({ mutate: mockReport, isPending: false }),
  listSpaceReviews: (...args: unknown[]) => mockList(...args),
}));

const page = (items = [publicReview(), publicReview({ id: 'r2', rating: 2, comment: 'Sujo.' })]) =>
  ({ items, nextCursor: null }) satisfies PublicReviewPage;

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReviewsListScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { slug: 'arena-sol' };
  mockSummary = summary();
  mockEligibility = eligibility();
  mockList.mockResolvedValue(page());
});

describe('lista "Ver todas" (RF-REVIEW-04)', () => {
  it('mostra os itens e o filtro com a contagem da distribuição', async () => {
    await renderScreen();
    expect(await screen.findByTestId('avaliacao-item-r1')).toBeTruthy();
    expect(screen.getByTestId('avaliacao-item-r2')).toBeTruthy();
    expect(mockList).toHaveBeenCalledWith(SPACE_ID, { limit: 20 }, expect.anything());
    expect(screen.getByTestId('avaliacoes-filtro-5')).toHaveTextContent(/5.*18/);
    // Nota sem avaliação fica desabilitada.
    expect(screen.getByTestId('avaliacoes-filtro-2')).toBeDisabled();
  });

  it('o filtro vai para a URL e a busca usa a nota', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('avaliacoes-filtro-5'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ nota: '5' });

    mockParams = { slug: 'arena-sol', nota: '1' };
    mockList.mockResolvedValue(page([]));
    await renderScreen();
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(SPACE_ID, { rating: 1, limit: 20 }, expect.anything()),
    );
    expect(await screen.findByText('Nenhuma avaliação com 1 estrela')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('avaliacoes-limpar-filtro'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ nota: undefined });
  });

  it('denunciar: motivo obrigatório, envio e "Denúncia enviada" só nesta tela', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('avaliacao-menu-r1'));
    await fireEvent.press(screen.getByTestId('avaliacao-denunciar-r1'));
    // A folha de denúncia abre só depois que o menu fecha (iOS).
    await fireEvent.press(await screen.findByTestId('denuncia-enviar'));
    expect(screen.getByText('Escolha um motivo')).toBeTruthy();
    expect(mockReport).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('denuncia-motivo-OFFENSIVE'));
    await fireEvent.changeText(screen.getByTestId('denuncia-detalhes'), '  xingou  ');
    await fireEvent.press(screen.getByTestId('denuncia-enviar'));
    expect(mockReport).toHaveBeenCalledWith(
      { reviewId: 'r1', data: { reason: 'OFFENSIVE', details: 'xingou' } },
      expect.anything(),
    );
    await waitFor(() => mockReport.mock.calls[0][1].onSuccess());
    expect(await screen.findByText('Denúncia enviada. Obrigado por avisar.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('avaliacao-menu-r1'));
    expect(screen.getByTestId('avaliacao-denunciada-r1')).toBeDisabled();
    expect(screen.queryByTestId('avaliacao-denunciar-r1')).toBeNull();
  });

  it('denúncia repetida (409) fecha e marca o item', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('avaliacao-menu-r2'));
    await fireEvent.press(screen.getByTestId('avaliacao-denunciar-r2'));
    await fireEvent.press(await screen.findByTestId('denuncia-motivo-SPAM'));
    await fireEvent.press(screen.getByTestId('denuncia-enviar'));
    await waitFor(() =>
      mockReport.mock.calls[0][1].onError(
        new ApiError({ status: 409, code: 'REVIEW_ALREADY_REPORTED', message: 'x', details: null }),
      ),
    );
    expect(await screen.findByText('Você já denunciou esta avaliação.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('avaliacao-menu-r2'));
    expect(screen.getByTestId('avaliacao-denunciada-r2')).toBeTruthy();
  });

  it('a minha (id igual ao da elegibilidade) tem editar e excluir, nunca denunciar', async () => {
    mockEligibility = eligibility({
      canReview: false,
      canEdit: true,
      myReview: {
        ...(require('./test-fixtures') as typeof import('./test-fixtures')).myReview(),
        id: 'r1',
      },
    });
    await renderScreen();
    expect(await screen.findByTestId('avaliacao-minha-r1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('avaliacao-menu-r1'));
    expect(screen.getByTestId('avaliacao-editar-r1')).toBeTruthy();
    expect(screen.getByTestId('avaliacao-excluir-r1')).toBeTruthy();
    expect(screen.queryByTestId('avaliacao-denunciar-r1')).toBeNull();
  });

  it('comentário oculto mostra o aviso e mantém a nota', async () => {
    mockList.mockResolvedValue(page([publicReview({ comment: null, commentHidden: true })]));
    await renderScreen();
    expect(await screen.findByLabelText('Comentário oculto pela moderação')).toBeTruthy();
    expect(screen.getByLabelText(/^5 de 5 estrelas/)).toBeTruthy();
  });

  it('resposta do espaço (push review.replied) fora da primeira página abre Minhas avaliações', async () => {
    mockParams = { slug: 'arena-sol', avaliacao: 'r-velha' };
    await renderScreen();
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/minhas-avaliacoes',
        params: { avaliacao: 'r-velha' },
      }),
    );
  });
});
