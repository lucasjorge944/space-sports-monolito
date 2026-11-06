import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AboutYouStep } from './about-you-step';
import { SPORTS as MOCK_SPORTS } from './test-fixtures';

const SPORTS = MOCK_SPORTS;

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ refresh: jest.fn() }) }));
// O login social carrega o cliente do Better Auth (ESM), que o Jest não transforma.
jest.mock('@/features/auth/social-sign-in', () => ({ signInWithSocial: jest.fn() }));

const mockUpdate = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  updateMyProfile: (...args: unknown[]) => mockUpdate(...args),
  useListSports: () => ({ data: { items: MOCK_SPORTS }, isPending: false, isError: false }),
}));

const renderStep = (onFinish: () => Promise<void>) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <AboutYouStep onFinish={onFinish} />
    </QueryClientProvider>,
  );

describe('etapa "Sobre você" (decisão 70)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('"Pular" segue o fluxo sem salvar nada', async () => {
    const onFinish = jest.fn().mockResolvedValue(undefined);
    await renderStep(onFinish);
    await fireEvent.press(screen.getByTestId('sobre-voce-pular'));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('salva nascimento, gênero e esportes com nível opcional', async () => {
    mockUpdate.mockResolvedValue({});
    const onFinish = jest.fn().mockResolvedValue(undefined);
    await renderStep(onFinish);
    await fireEvent.changeText(screen.getByTestId('perfil-nascimento'), '01021990');
    await fireEvent.press(screen.getByTestId('perfil-genero-FEMALE'));
    await fireEvent.press(screen.getByTestId('perfil-esporte-beach-tennis'));
    await fireEvent.press(screen.getByTestId('perfil-nivel-beach-tennis-ADVANCED'));
    await fireEvent.press(screen.getByTestId('perfil-esporte-futevolei'));
    await fireEvent.press(screen.getByTestId('sobre-voce-salvar'));

    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith({
      birthDate: '1990-02-01',
      gender: 'FEMALE',
      favoriteSports: [
        { sportId: SPORTS[0]?.id, level: 'ADVANCED' },
        { sportId: SPORTS[1]?.id, level: null },
      ],
    });
  });

  it('tocar de novo desmarca gênero e esporte', async () => {
    mockUpdate.mockResolvedValue({});
    await renderStep(jest.fn().mockResolvedValue(undefined));
    await fireEvent.press(screen.getByTestId('perfil-genero-OTHER'));
    await fireEvent.press(screen.getByTestId('perfil-genero-OTHER'));
    await fireEvent.press(screen.getByTestId('perfil-esporte-futevolei'));
    await fireEvent.press(screen.getByTestId('perfil-esporte-futevolei'));
    expect(screen.queryByTestId('perfil-nivel-futevolei-PRO')).toBeNull();
    await fireEvent.press(screen.getByTestId('sobre-voce-salvar'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        birthDate: null,
        gender: null,
        favoriteSports: [],
      }),
    );
  });

  it('data inválida não envia', async () => {
    const onFinish = jest.fn();
    await renderStep(onFinish);
    await fireEvent.changeText(screen.getByTestId('perfil-nascimento'), '01/01/2999');
    await fireEvent.press(screen.getByTestId('sobre-voce-salvar'));
    expect(screen.getByText('A data não pode ser no futuro')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});
