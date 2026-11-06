import type { ReviewEligibility, ReviewSummary } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReviewsBlock } from './reviews-block';
import {
  editable,
  eligibility,
  publicReview,
  readOnly,
  reviewSpace,
  summary,
} from './test-fixtures';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));

let mockSummary: { data?: ReviewSummary; isPending: boolean; isError: boolean };
let mockEligibility: ReviewEligibility | undefined;
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceReviewSummary: () => ({ ...mockSummary, refetch: jest.fn() }),
  useGetReviewEligibility: () => ({ data: mockEligibility }),
  useDeleteMyReview: () => ({ mutate: jest.fn(), isPending: false }),
  useReportReview: () => ({ mutate: jest.fn(), isPending: false }),
}));

const ok = (data: ReviewSummary) => ({ data, isPending: false, isError: false });

beforeEach(() => jest.clearAllMocks());

describe('bloco "Avaliações" da página do espaço (RF-REVIEW-03)', () => {
  it('com 5 ou mais: média, distribuição, mais citados, recentes e "Ver todas"', async () => {
    mockSummary = ok(summary());
    mockEligibility = undefined;
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByTestId('avaliacoes-media')).toHaveTextContent('4,8');
    expect(screen.getByText('23 avaliações')).toBeTruthy();
    expect(screen.getByLabelText('5 estrelas: 18 avaliações')).toBeTruthy();
    expect(screen.getByLabelText('Quadra boa, citado 12 vezes')).toBeTruthy();
    expect(screen.getByTestId('avaliacao-item-r1')).toHaveTextContent(/Ótimo atendimento/);
    expect(screen.queryByTestId('avaliacoes-novo')).toBeNull();
    expect(screen.getByTestId('espaco-avaliacoes-ver-todas')).toHaveTextContent(
      'Ver todas as 23 avaliações',
    );

    await fireEvent.press(screen.getByTestId('espaco-avaliacoes-ver-todas'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/avaliacoes',
      params: { slug: 'arena-sol' },
    });
  });

  it('abaixo de 5: selo "Novo", sem média nem distribuição', async () => {
    mockSummary = ok(summary({ count: 2, average: null, topTags: [], recent: [publicReview()] }));
    mockEligibility = undefined;
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByTestId('avaliacoes-novo')).toHaveTextContent(/Ainda poucas avaliações/);
    expect(screen.getByText('A nota aparece a partir de 5 avaliações.')).toBeTruthy();
    expect(screen.queryByTestId('avaliacoes-media')).toBeNull();
    expect(screen.queryByLabelText(/5 estrelas:/)).toBeNull();
    expect(screen.getByTestId('avaliacao-item-r1')).toBeTruthy();
  });

  it('com uma avaliação, o link diz "Ver a avaliação" (como o web)', async () => {
    mockSummary = ok(summary({ count: 1, average: null, topTags: [], recent: [] }));
    mockEligibility = undefined;
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByTestId('espaco-avaliacoes-ver-todas')).toHaveTextContent('Ver a avaliação');
  });

  it('sem nenhuma, convida quem pode avaliar', async () => {
    mockSummary = ok(summary({ count: 0, average: null, topTags: [], recent: [] }));
    mockEligibility = eligibility();
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByText('Ninguém avaliou ainda.')).toBeTruthy();
    expect(screen.getByText('Jogou aqui? Sua avaliação ajuda outros jogadores.')).toBeTruthy();
    expect(screen.queryByTestId('espaco-avaliacoes-ver-todas')).toBeNull();
  });

  it.each([
    ['pode avaliar', eligibility(), 'Avaliar este espaço'],
    ['já avaliou', editable(), 'Editar minha avaliação'],
    ['equipe com avaliação', readOnly(), 'Ver minha avaliação'],
  ])('botão conforme a elegibilidade: %s', async (_case, value, label) => {
    mockSummary = ok(summary());
    mockEligibility = value;
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByTestId('espaco-avaliar')).toHaveTextContent(label);
    await fireEvent.press(screen.getByTestId('espaco-avaliar'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/avaliar',
      params: { slug: 'arena-sol' },
    });
  });

  it('sem uso (ou equipe sem avaliação), sem botão', async () => {
    mockSummary = ok(summary());
    mockEligibility = eligibility({ canReview: false, reason: 'REVIEW_NOT_ELIGIBLE' });
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.queryByTestId('espaco-avaliar')).toBeNull();
  });

  it('a minha, nas recentes, tem o selo "Sua avaliação"', async () => {
    mockSummary = ok(summary({ recent: [publicReview({ id: 'r-mine' })] }));
    mockEligibility = editable();
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByTestId('avaliacao-minha-r-mine')).toBeTruthy();
  });

  it('erro no resumo não derruba a página', async () => {
    mockSummary = { isPending: false, isError: true };
    mockEligibility = undefined;
    await render(<ReviewsBlock space={reviewSpace()} />);
    expect(screen.getByTestId('avaliacoes-erro')).toHaveTextContent(/Não foi possível carregar/);
  });
});
