import { ApiError, type ReviewEligibility } from '@space-sports/api-client';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ReviewPromptCard } from './review-prompt-card';
import { editable, eligibility, myReview, readOnly, SPACE_ID } from './test-fixtures';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
const mockSetQueryData = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: mockSetQueryData }),
}));

let mockEligibility: ReviewEligibility | undefined;
const mockRefetch = jest.fn();
const mockUpsert = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetReviewEligibility: () => ({ data: mockEligibility, refetch: mockRefetch }),
  useUpsertMyReview: () => ({ mutate: mockUpsert, isPending: false }),
}));

const space = { id: SPACE_ID, slug: 'arena-sol', name: 'Arena Sol' };
const renderCard = () =>
  render(<ReviewPromptCard space={space} kind="booking" testID="reserva-avaliacao" />);

beforeEach(() => jest.clearAllMocks());

describe('card "Avalie sua experiência" (RF-REVIEW-02)', () => {
  it('sem resposta da elegibilidade, ou sem poder avaliar, não aparece', async () => {
    mockEligibility = undefined;
    await renderCard();
    expect(screen.queryByTestId('reserva-avaliacao')).toBeNull();

    mockEligibility = eligibility({ canReview: false, reason: 'REVIEW_NOT_ALLOWED' });
    await renderCard();
    expect(screen.queryByTestId('reserva-avaliacao')).toBeNull();
  });

  it('um toque na estrela grava só criando e abre a tela para completar', async () => {
    mockEligibility = eligibility();
    await renderCard();
    expect(screen.getByText('Como foi jogar no Arena Sol? Toque numa estrela.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('reserva-avaliacao-estrela-4'));
    expect(mockUpsert).toHaveBeenCalledWith(
      { spaceId: SPACE_ID, data: { rating: 4 }, params: { createOnly: 'true' } },
      expect.anything(),
    );
    expect(screen.getByText('Salvando sua nota…')).toBeTruthy();

    const saved = myReview({ rating: 4, tags: [], comment: null });
    await act(async () => mockUpsert.mock.calls[0][1].onSuccess(saved));
    // A elegibilidade já fica com a avaliação: o card passa a "Sua avaliação".
    expect(mockSetQueryData).toHaveBeenCalledWith([`/v1/spaces/${SPACE_ID}/reviews/eligibility`], {
      canReview: false,
      canEdit: true,
      reason: null,
      myReview: saved,
    });
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/avaliar',
      params: { slug: 'arena-sol', salva: '1' },
    });
  });

  it('depois de avaliar some o convite e fica "Sua avaliação" com editar', async () => {
    mockEligibility = editable();
    await renderCard();
    expect(screen.queryByTestId('reserva-avaliacao-estrela-1')).toBeNull();
    expect(screen.getByText('Sua avaliação')).toBeTruthy();
    expect(screen.getByTestId('reserva-avaliacao-nota')).toHaveTextContent('Bom');
    await fireEvent.press(screen.getByTestId('reserva-avaliacao-editar'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/avaliar',
      params: { slug: 'arena-sol' },
    });
  });

  it('na equipe, o botão é "Ver"', async () => {
    mockEligibility = readOnly();
    await renderCard();
    expect(screen.getByTestId('reserva-avaliacao-editar')).toHaveTextContent('Ver');
  });

  it('409 REVIEW_ALREADY_EXISTS não é erro: recarrega e não navega', async () => {
    mockEligibility = eligibility();
    await renderCard();
    await fireEvent.press(screen.getByTestId('reserva-avaliacao-estrela-5'));
    await act(async () =>
      mockUpsert.mock.calls[0][1].onError(
        new ApiError({ status: 409, code: 'REVIEW_ALREADY_EXISTS', message: 'x', details: null }),
      ),
    );
    expect(mockRefetch).toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('erro de rede: as estrelas voltam e aparece o aviso', async () => {
    mockEligibility = eligibility();
    await renderCard();
    await fireEvent.press(screen.getByTestId('reserva-avaliacao-estrela-3'));
    await act(async () => mockUpsert.mock.calls[0][1].onError(new TypeError('Network')));
    expect(screen.getByText('Não foi possível salvar a nota. Tente de novo.')).toBeTruthy();
    expect(screen.getByTestId('reserva-avaliacao-estrela-3')).not.toBeChecked();
  });

  it('aula: o texto fala da aula', async () => {
    mockEligibility = eligibility();
    await render(<ReviewPromptCard space={space} kind="class" testID="aula-avaliacao" />);
    expect(screen.getByText('Como foi a aula no Arena Sol? Toque numa estrela.')).toBeTruthy();
  });
});
