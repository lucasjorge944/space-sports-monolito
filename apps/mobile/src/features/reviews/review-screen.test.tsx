import { ApiError, type ReviewEligibility } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ReviewScreen } from './review-screen';
import { editable, eligibility, myReview, readOnly, reviewSpace, SPACE_ID } from './test-fixtures';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  dismissTo: jest.fn(),
  canGoBack: () => true,
};
let mockParams: Record<string, string> = { slug: 'arena-sol' };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePreventRemove: () => jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate, setQueryData: jest.fn() }),
}));

let mockEligibility: ReviewEligibility;
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceBySlug: () => ({
    data: (require('./test-fixtures') as typeof import('./test-fixtures')).reviewSpace(),
    isPending: false,
    isError: false,
  }),
  useGetReviewEligibility: () => ({ data: mockEligibility, isPending: false, isError: false }),
  useUpsertMyReview: () => ({ mutate: mockUpsert, isPending: false }),
  useDeleteMyReview: () => ({ mutate: mockDelete, isPending: false }),
}));

const apiError = (status: number, code: string) =>
  new ApiError({ status, code, message: code, details: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { slug: 'arena-sol' };
});

describe('tela de avaliar (RF-REVIEW-01)', () => {
  it('chips mudam com a nota: positivos com 4–5, negativos com 1–3', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    expect(screen.getByText('Dê a nota para ver as opções')).toBeTruthy();
    expect(screen.queryByTestId('avaliar-chip-GOOD_COURT')).toBeNull();

    await fireEvent.press(screen.getByTestId('avaliar-estrela-5'));
    expect(screen.getByTestId('avaliar-rotulo-nota')).toHaveTextContent('Excelente');
    expect(screen.getByTestId('avaliar-chip-GOOD_COURT')).toBeTruthy();
    expect(screen.queryByTestId('avaliar-chip-BAD_COURT')).toBeNull();
    await fireEvent.press(screen.getByTestId('avaliar-chip-GOOD_COURT'));

    await fireEvent.press(screen.getByTestId('avaliar-estrela-2'));
    expect(screen.getByTestId('avaliar-rotulo-nota')).toHaveTextContent('Ruim');
    expect(screen.getByTestId('avaliar-chip-BAD_COURT')).toBeTruthy();
    expect(screen.queryByTestId('avaliar-chip-GOOD_COURT')).toBeNull();

    // De volta a 4: o positivo marcado antes continua marcado.
    await fireEvent.press(screen.getByTestId('avaliar-estrela-4'));
    expect(screen.getByTestId('avaliar-chip-GOOD_COURT')).toBeChecked();
  });

  it('com 5 chips marcados, os outros ficam desabilitados', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-estrela-5'));
    for (const tag of ['GOOD_COURT', 'GOOD_SERVICE', 'CLEAN', 'GOOD_VALUE', 'EASY_BOOKING']) {
      await fireEvent.press(screen.getByTestId(`avaliar-chip-${tag}`));
    }
    expect(screen.getByText('Você escolheu 5 de 5')).toBeTruthy();
    expect(screen.getByTestId('avaliar-chip-ON_TIME')).toBeDisabled();
  });

  it('enviar sem nota mostra o erro e não chama a API', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-enviar'));
    expect(screen.getByTestId('avaliar-erro-nota')).toHaveTextContent('Escolha de 1 a 5 estrelas');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('envia nota, chips do grupo e comentário sem espaços; sucesso invalida e agradece', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-estrela-5'));
    await fireEvent.press(screen.getByTestId('avaliar-chip-CLEAN'));
    await fireEvent.changeText(screen.getByTestId('avaliar-comentario'), '  Muito bom!  ');
    expect(screen.getByTestId('avaliar-contador')).toHaveTextContent('14/500');
    expect(screen.getByText('Enviar avaliação')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('avaliar-enviar'));
    expect(mockUpsert).toHaveBeenCalledWith(
      { spaceId: SPACE_ID, data: { rating: 5, tags: ['CLEAN'], comment: 'Muito bom!' } },
      expect.anything(),
    );
    await mockUpsert.mock.calls[0][1].onSuccess();
    expect(await screen.findByTestId('avaliar-sucesso')).toBeTruthy();
    expect(screen.getByText('Obrigado pela avaliação!')).toBeTruthy();
    const keys = mockInvalidate.mock.calls.map(([arg]) => arg.queryKey[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        `/v1/spaces/${SPACE_ID}/reviews/summary`,
        `/v1/spaces/${SPACE_ID}/reviews`,
        `/v1/spaces/${SPACE_ID}/reviews/eligibility`,
        '/v1/me/reviews',
      ]),
    );

    await fireEvent.press(screen.getByTestId('avaliar-ver-no-espaco'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]',
      params: { slug: 'arena-sol', avaliacoes: '1' },
    });
  });

  it('edição vem preenchida e salva as alterações', async () => {
    mockEligibility = editable();
    mockParams = { slug: 'arena-sol', salva: '1' };
    await render(<ReviewScreen />);
    expect(screen.getByTestId('avaliar-nota-salva')).toHaveTextContent(
      'Nota salva. Quer contar mais?',
    );
    expect(screen.getByTestId('avaliar-comentario').props.value).toBe('Quadra ótima.');
    expect(screen.getByTestId('avaliar-chip-GOOD_COURT')).toBeChecked();
    expect(screen.getByText('Salvar alterações')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('avaliar-estrela-3'));
    await fireEvent.press(screen.getByTestId('avaliar-enviar'));
    // Nota 3: o chip positivo sai do envio.
    expect(mockUpsert.mock.calls[0][0].data).toEqual({
      rating: 3,
      tags: [],
      comment: 'Quadra ótima.',
    });
    await mockUpsert.mock.calls[0][1].onSuccess();
    expect(await screen.findByText('Avaliação atualizada')).toBeTruthy();
  });

  it('comentário oculto pela moderação avisa que editar não reexibe', async () => {
    mockEligibility = eligibility({
      canReview: false,
      canEdit: true,
      myReview: myReview({ commentHidden: true }),
    });
    await render(<ReviewScreen />);
    expect(screen.getByTestId('avaliar-aviso-oculto')).toHaveTextContent(/não o reexibe/);
  });

  it('excluir confirma, chama a API e volta', async () => {
    mockEligibility = editable();
    const alert = jest.spyOn(Alert, 'alert');
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-excluir'));
    expect(alert.mock.calls[0]?.[0]).toBe('Excluir sua avaliação?');
    const confirm = alert.mock.calls[0]?.[2]?.find((b) => b.text === 'Excluir');
    confirm?.onPress?.();
    expect(mockDelete).toHaveBeenCalledWith({ spaceId: SPACE_ID }, expect.anything());
    mockDelete.mock.calls[0][1].onSuccess();
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('REVIEW_TAGS_MISMATCH mostra a mensagem e mantém os dados', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-estrela-4'));
    await fireEvent.press(screen.getByTestId('avaliar-enviar'));
    await mockUpsert.mock.calls[0][1].onError(apiError(400, 'REVIEW_TAGS_MISMATCH'));
    expect(await screen.findByTestId('avaliar-erro')).toHaveTextContent(
      'Os destaques não combinam com a nota. Confira e envie de novo.',
    );
    expect(screen.getByTestId('avaliar-rotulo-nota')).toHaveTextContent('Bom');
  });

  it('REVIEW_NOT_ELIGIBLE ao criar mostra o motivo', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-estrela-4'));
    await fireEvent.press(screen.getByTestId('avaliar-enviar'));
    await mockUpsert.mock.calls[0][1].onError(apiError(403, 'REVIEW_NOT_ELIGIBLE'));
    expect(await screen.findByTestId('avaliar-erro')).toHaveTextContent(/depois de jogar/);
  });

  it('REVIEW_NOT_ALLOWED ao editar passa ao só leitura', async () => {
    mockEligibility = editable();
    await render(<ReviewScreen />);
    await fireEvent.press(screen.getByTestId('avaliar-enviar'));
    await mockUpsert.mock.calls[0][1].onError(apiError(403, 'REVIEW_NOT_ALLOWED'));
    expect(await screen.findByTestId('avaliar-so-leitura')).toBeTruthy();
    expect(screen.getByText('Sua avaliação')).toBeTruthy();
    expect(screen.queryByTestId('avaliar-enviar')).toBeNull();
  });

  it('equipe com avaliação: só leitura, com excluir', async () => {
    mockEligibility = readOnly();
    await render(<ReviewScreen />);
    expect(screen.getByTestId('avaliar-so-leitura')).toBeTruthy();
    expect(screen.getByText(/não pode ser editada/)).toBeTruthy();
    expect(screen.getByText('Quadra ótima.')).toBeTruthy();
    expect(screen.queryByTestId('avaliar-comentario')).toBeNull();
    expect(screen.getByTestId('avaliar-excluir')).toBeTruthy();
  });

  it('sem uso: explica e oferece ver o espaço', async () => {
    mockEligibility = eligibility({ canReview: false, reason: 'REVIEW_NOT_ELIGIBLE' });
    await render(<ReviewScreen />);
    expect(screen.getByTestId('avaliar-bloqueado')).toHaveTextContent(/depois de jogar/);
    expect(screen.queryByTestId('avaliar-enviar')).toBeNull();
  });

  it('equipe sem avaliação: a equipe não avalia o próprio espaço', async () => {
    mockEligibility = eligibility({ canReview: false, reason: 'REVIEW_NOT_ALLOWED' });
    await render(<ReviewScreen />);
    expect(screen.getByTestId('avaliar-bloqueado')).toHaveTextContent(/equipe não avalia/);
  });

  it('o espaço do cabeçalho vem da página', async () => {
    mockEligibility = eligibility();
    await render(<ReviewScreen />);
    expect(screen.getByText(reviewSpace().name)).toBeTruthy();
    expect(screen.getByText('Savassi · Belo Horizonte')).toBeTruthy();
  });
});
