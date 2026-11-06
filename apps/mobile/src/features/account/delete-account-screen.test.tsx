import { ApiError } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { DeleteAccountScreen } from './delete-account-screen';

const mockSignOut = jest.fn();
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ signOut: mockSignOut }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

const mockRequest = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  requestMyAccountDeletion: (...args: unknown[]) => mockRequest(...args),
}));

const renderScreen = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <DeleteAccountScreen />
    </QueryClientProvider>,
  );

/** Toca em "Excluir" e escolhe o botão destrutivo do Alert de confirmação. */
async function confirmDeletion(alert: jest.SpyInstance) {
  await fireEvent.press(screen.getByTestId('excluir-conta-confirmar'));
  const [title, , buttons] = alert.mock.calls.at(-1) ?? [];
  expect(title).toBe('Excluir conta?');
  await act(async () => {
    buttons?.find((b: { style?: string }) => b.style === 'destructive')?.onPress?.();
  });
}

describe('Excluir conta (RF-AUTH-03, decisão 40)', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());

  it('explica o que acontece antes de pedir a senha', async () => {
    await renderScreen();
    expect(screen.getByText(/inativada na hora/)).toBeTruthy();
    expect(screen.getByText(/confirma o pedido em até 15 dias/)).toBeTruthy();
    expect(
      screen.getByText(/reservas, mensalistas, assinaturas e confirmações de aula futuras/),
    ).toBeTruthy();
    expect(screen.getByText(/fale com o atendimento/)).toBeTruthy();
    expect(screen.getByLabelText('Senha')).toBeTruthy();
  });

  it('só envia depois do Alert de confirmação', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'segredo123');
    await fireEvent.press(screen.getByTestId('excluir-conta-confirmar'));
    expect(mockRequest).not.toHaveBeenCalled();
    const [, , buttons] = alert.mock.calls[0] ?? [];
    expect(buttons?.some((b: { style?: string }) => b.style === 'cancel')).toBe(true);
  });

  it('ao concluir, mostra o prazo (America/Sao_Paulo) e sai da conta', async () => {
    mockRequest.mockResolvedValue({
      requestId: 'r1',
      requestedAt: '2026-10-29T15:00:00.000Z',
      dueAt: '2026-11-14T02:30:00.000Z',
    });
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'segredo123');
    await fireEvent.changeText(screen.getByLabelText('Motivo (opcional)'), 'Não uso mais');
    await confirmDeletion(alert);
    expect(mockRequest).toHaveBeenCalledWith({ password: 'segredo123', reason: 'Não uso mais' });
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    const [title, message] = alert.mock.calls.at(-1) ?? [];
    expect(title).toBe('Pedido de exclusão enviado');
    expect(message).toMatch(/até 13\/11\/2026/);
  });

  it('REAUTHENTICATION_REQUIRED pede a senha de novo e não sai da conta', async () => {
    mockRequest.mockRejectedValue(
      new ApiError({ status: 403, code: 'REAUTHENTICATION_REQUIRED', message: 'English' }),
    );
    await renderScreen();
    await confirmDeletion(alert);
    expect(await screen.findByText('Digite a senha da sua conta')).toBeTruthy();
    expect(screen.getByText(/Por segurança, digite a senha/)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('INVALID_PASSWORD marca "Senha incorreta" no campo, sem pedir a senha de novo', async () => {
    mockRequest.mockRejectedValue(
      new ApiError({ status: 403, code: 'INVALID_PASSWORD', message: 'English' }),
    );
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'errada');
    await confirmDeletion(alert);
    expect(await screen.findByText('Senha incorreta')).toBeTruthy();
    expect(screen.getByText(/Confira e tente de novo/)).toBeTruthy();
    expect(screen.queryByText('Digite a senha da sua conta')).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it.each([
    ['DELETION_REQUEST_PENDING', 409, /pedido de exclusão em análise/],
    ['LAST_OWNER', 409, /único Dono/],
    ['SUPER_ACCOUNT', 409, /administra a plataforma/],
  ])('%s mostra a mensagem em português e mantém a pessoa na conta', async (code, status, text) => {
    mockRequest.mockRejectedValue(new ApiError({ status, code, message: 'English' }));
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Senha'), 'x');
    await confirmDeletion(alert);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
