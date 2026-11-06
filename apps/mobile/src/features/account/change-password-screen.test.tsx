import { ApiError } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ChangePasswordScreen } from './change-password-screen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockSetToken = jest.fn();
jest.mock('@/features/auth/token-storage', () => ({
  setSessionToken: (...args: unknown[]) => mockSetToken(...args),
}));

let mockAccounts: { providerId: string }[] = [];
const mockChange = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  changePassword: (...args: unknown[]) => mockChange(...args),
  useListUserAccounts: () => ({ data: mockAccounts, isPending: false, isError: false }),
}));

const renderScreen = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ChangePasswordScreen />
    </QueryClientProvider>,
  );

async function fill(current: string, next: string, confirm: string) {
  await fireEvent.changeText(screen.getByTestId('alterar-senha-atual'), current);
  await fireEvent.changeText(screen.getByTestId('alterar-senha-nova'), next);
  await fireEvent.changeText(screen.getByTestId('alterar-senha-confirmar'), confirm);
  await fireEvent.press(screen.getByTestId('alterar-senha-salvar'));
}

describe('Alterar senha (RF-AUTH-02, decisão 67)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [{ providerId: 'credential' }];
  });

  it('troca a senha encerrando as outras sessões e guarda o token novo', async () => {
    mockChange.mockResolvedValue({ token: 'novo.tok', user: {} });
    await renderScreen();
    await fill('antiga123', 'nova-senha-1', 'nova-senha-1');
    await waitFor(() => expect(screen.getByTestId('alterar-senha-sucesso')).toBeTruthy());
    expect(mockChange).toHaveBeenCalledWith({
      currentPassword: 'antiga123',
      newPassword: 'nova-senha-1',
      revokeOtherSessions: true,
    });
    expect(mockSetToken).toHaveBeenCalledWith('novo.tok');
    expect(screen.getByTestId('alterar-senha-atual').props.value).toBe('');
  });

  it('confirmação diferente e senha curta não vão à API', async () => {
    await renderScreen();
    await fill('antiga123', 'curta', 'outra');
    expect(screen.getByText('Use pelo menos 8 caracteres')).toBeTruthy();
    expect(screen.getByText('As senhas não conferem')).toBeTruthy();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it('senha atual errada aparece no campo', async () => {
    mockChange.mockRejectedValue(
      new ApiError({ status: 400, code: 'INVALID_PASSWORD', message: 'x' }),
    );
    await renderScreen();
    await fill('errada123', 'nova-senha-1', 'nova-senha-1');
    await waitFor(() => expect(screen.getByText('Senha atual incorreta')).toBeTruthy());
    expect(screen.queryByText('Senha incorreta.')).toBeNull();
  });

  it('conta só Google explica o login pelo Google, sem formulário', async () => {
    mockAccounts = [{ providerId: 'google' }];
    await renderScreen();
    expect(screen.getByTestId('alterar-senha-social')).toBeTruthy();
    expect(screen.getByText(/Você entra com Google/)).toBeTruthy();
    expect(screen.queryByTestId('alterar-senha-atual')).toBeNull();
  });
});
