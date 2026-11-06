import { ApiError, type MeResponse } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import CadastroScreen from '@/app/(auth)/cadastro';
import CompletarPerfilScreen from '@/app/completar-perfil';
import { SPORTS as MOCK_SPORTS, makeMe } from './test-fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
let mockMe: MeResponse;
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ refresh: mockRefresh, signOut: mockSignOut }),
  useMe: () => mockMe,
}));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `spacesports://${path}` }));
// O login social carrega o cliente do Better Auth (ESM), que o Jest não transforma.
jest.mock('@/features/auth/social-sign-in', () => ({ signInWithSocial: jest.fn() }));
jest.mock('@/features/auth/components/social-buttons', () => ({ SocialButtons: () => null }));

const mockSignUp = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  signUpWithEmailAndPassword: (...args: unknown[]) => mockSignUp(...args),
  updateMyProfile: (...args: unknown[]) => mockUpdate(...args),
  useListSports: () => ({ data: { items: MOCK_SPORTS }, isPending: false, isError: false }),
}));

const renderWithClient = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

async function fillAccount(phone: string) {
  await fireEvent.changeText(screen.getByTestId('cadastro-nome'), 'Ana Souza');
  await fireEvent.changeText(screen.getByTestId('cadastro-email'), 'Ana@Example.com ');
  await fireEvent.changeText(screen.getByTestId('cadastro-telefone'), phone);
  await fireEvent.changeText(screen.getByTestId('cadastro-senha'), 'segredo123');
  await fireEvent.press(screen.getByTestId('cadastro-criar'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue({});
});

describe('cadastro (decisões 64 e 70)', () => {
  it('telefone com máscara, obrigatório e enviado em E.164', async () => {
    mockSignUp.mockResolvedValue({});
    await renderWithClient(<CadastroScreen />);
    await fireEvent.changeText(screen.getByTestId('cadastro-telefone'), '31999998888');
    expect(screen.getByTestId('cadastro-telefone').props.value).toBe('(31) 99999-8888');

    await fillAccount('31999998888');
    await waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ana Souza',
          email: 'ana@example.com',
          phone: '+5531999998888',
        }),
      ),
    );
  });

  it('telefone inválido não envia', async () => {
    await renderWithClient(<CadastroScreen />);
    await fillAccount('(31) 9999');
    expect(screen.getByText('Informe o telefone com DDD')).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('INVALID_PHONE_NUMBER da API vai para o campo do telefone', async () => {
    mockSignUp.mockRejectedValue(
      new ApiError({ status: 400, code: 'INVALID_PHONE_NUMBER', message: 'x' }),
    );
    await renderWithClient(<CadastroScreen />);
    await fillAccount('(31) 99999-8888');
    await waitFor(() => expect(screen.getByText('Informe o telefone com DDD')).toBeTruthy());
    expect(screen.queryByTestId('sobre-voce-titulo')).toBeNull();
  });

  it('conta criada → "Sobre você"; pular segue para a verificação do e-mail', async () => {
    mockSignUp.mockResolvedValue({});
    await renderWithClient(<CadastroScreen />);
    await fillAccount('(31) 99999-8888');
    await waitFor(() => expect(screen.getByTestId('sobre-voce-titulo')).toBeTruthy());
    // A sessão só é validada no fim da etapa, para as abas não assumirem antes.
    expect(mockRefresh).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('sobre-voce-pular'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/verificar-email'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('completar perfil por profile.missing (decisão 66)', () => {
  it('Google sem telefone: pede só o telefone e depois "Sobre você"', async () => {
    mockMe = makeMe({ phone: null, profile: { missing: ['phone'] } });
    await renderWithClient(<CompletarPerfilScreen />);
    expect(screen.queryByTestId('completar-perfil-nome')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('completar-perfil-telefone'), '31999998888');
    await fireEvent.press(screen.getByTestId('completar-perfil-continuar'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ phone: '+5531999998888' }));
    await waitFor(() => expect(screen.getByTestId('sobre-voce-titulo')).toBeTruthy());
    expect(mockRefresh).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('sobre-voce-pular'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('sem nome nem telefone: pede os dois', async () => {
    mockMe = makeMe({ name: '', phone: null, profile: { missing: ['name', 'phone'] } });
    await renderWithClient(<CompletarPerfilScreen />);
    await fireEvent.press(screen.getByTestId('completar-perfil-continuar'));
    expect(screen.getByText('Informe seu nome')).toBeTruthy();
    expect(screen.getByText('Informe o telefone com DDD')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('completar-perfil-nome'), ' Bia ');
    await fireEvent.changeText(screen.getByTestId('completar-perfil-telefone'), '3132221234');
    await fireEvent.press(screen.getByTestId('completar-perfil-continuar'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ name: 'Bia', phone: '+553132221234' }),
    );
  });

  it('conta antiga que já respondeu "Sobre você" libera o app direto', async () => {
    mockMe = makeMe({ phone: null, gender: 'MALE', profile: { missing: ['phone'] } });
    await renderWithClient(<CompletarPerfilScreen />);
    await fireEvent.changeText(screen.getByTestId('completar-perfil-telefone'), '31999998888');
    await fireEvent.press(screen.getByTestId('completar-perfil-continuar'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('sobre-voce-titulo')).toBeNull();
  });

  it('"Sair" fica disponível', async () => {
    mockMe = makeMe({ phone: null, profile: { missing: ['phone'] } });
    await renderWithClient(<CompletarPerfilScreen />);
    await fireEvent.press(screen.getByTestId('completar-perfil-sair'));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
