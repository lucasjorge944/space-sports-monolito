import { ApiError, type MeResponse } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SPORTS as MOCK_SPORTS, makeMe } from '@/features/profile/test-fixtures';
import { EditProfileScreen } from './edit-profile-screen';

// Modal que continua na tela depois de `visible` falso (no iOS a folha desce até o `onDismiss`); a
// última prop `onDismiss` fica guardada para o teste simular o fim da animação.
const mockModal: { visible?: boolean; onDismiss?: () => void } = {};
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function MockModal(props: { visible?: boolean; onDismiss?: () => void; children?: unknown }) {
    mockModal.visible = props.visible;
    mockModal.onDismiss = props.onDismiss;
    return createElement(View, { testID: 'modal' }, props.children);
  }
  return { __esModule: true, default: MockModal };
});

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `spacesports://${path}` }));
// O login social carrega o cliente do Better Auth (ESM), que o Jest não transforma.
jest.mock('@/features/auth/social-sign-in', () => ({ signInWithSocial: jest.fn() }));

const mockRefresh = jest.fn();
let mockMe: MeResponse;
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ refresh: mockRefresh }),
  useMe: () => mockMe,
}));

const mockUpdate = jest.fn();
const mockResend = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  updateMyProfile: (...args: unknown[]) => mockUpdate(...args),
  sendVerificationEmail: (...args: unknown[]) => mockResend(...args),
  useListSports: () => ({ data: { items: MOCK_SPORTS }, isPending: false, isError: false }),
}));

const mockPick = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/features/profile/avatar', () => ({
  ...jest.requireActual('@/features/profile/avatar'),
  pickAvatar: (...args: unknown[]) => mockPick(...args),
  uploadAvatar: (...args: unknown[]) => mockUpload(...args),
  removeAvatar: jest.fn(),
}));

// A mutação da foto termina depois do seletor e do envio: espera o botão voltar a ficar habilitado
// para a última atualização não escapar do act().
const waitForAvatarIdle = () =>
  waitFor(() => expect(screen.getByTestId('editar-perfil-foto-trocar')).toBeEnabled());

const renderScreen = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <EditProfileScreen />
    </QueryClientProvider>,
  );

describe('Editar perfil (RF-AUTH-02, decisões 67 a 69)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    mockMe = makeMe({
      birthDate: '1990-02-01',
      gender: 'FEMALE',
      favoriteSports: [
        { sport: MOCK_SPORTS[0] as MeResponse['favoriteSports'][0]['sport'], level: 'PRO' },
      ],
    });
  });

  it('preenche com o /me e não reenvia nome e telefone que não mudaram', async () => {
    await renderScreen();
    expect(screen.getByTestId('editar-perfil-telefone').props.value).toBe('(31) 99999-8888');
    expect(screen.getByTestId('perfil-nascimento').props.value).toBe('01/02/1990');

    await fireEvent.press(screen.getByTestId('perfil-nivel-beach-tennis-PRO'));
    await fireEvent.press(screen.getByTestId('editar-perfil-salvar'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith({
      birthDate: '1990-02-01',
      gender: 'FEMALE',
      favoriteSports: [{ sportId: MOCK_SPORTS[0]?.id, level: null }],
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('envia nome e telefone novos (telefone em E.164)', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('editar-perfil-nome'), 'Ana S.');
    await fireEvent.changeText(screen.getByTestId('editar-perfil-telefone'), '31988887777');
    await fireEvent.press(screen.getByTestId('editar-perfil-salvar'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ana S.', phone: '+5531988887777' }),
      ),
    );
  });

  it('telefone antigo estrangeiro não trava o salvar se não for mexido', async () => {
    mockMe = makeMe({ phone: '+14155550132' });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('editar-perfil-nome'), 'Ana S.');
    await fireEvent.press(screen.getByTestId('editar-perfil-salvar'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0]?.[0]).not.toHaveProperty('phone');
  });

  it('telefone alterado continua validado', async () => {
    mockMe = makeMe({ phone: '+14155550132' });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('editar-perfil-telefone'), '+1 415');
    await fireEvent.press(screen.getByTestId('editar-perfil-salvar'));
    expect(screen.getByText('Informe o telefone com DDD')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('INVALID_PHONE_NUMBER do PATCH vai para o campo', async () => {
    mockUpdate.mockRejectedValue(
      new ApiError({ status: 400, code: 'INVALID_PHONE_NUMBER', message: 'x' }),
    );
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('editar-perfil-telefone'), '31988887777');
    await fireEvent.press(screen.getByTestId('editar-perfil-salvar'));
    await waitFor(() => expect(screen.getByText('Informe o telefone com DDD')).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('e-mail só leitura, com selo e reenvio da verificação', async () => {
    mockResend.mockResolvedValue({});
    await renderScreen();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText('Não verificado')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('editar-perfil-reenviar'));
    await waitFor(() =>
      expect(mockResend).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ana@example.com' }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/E-mail reenviado/)).toBeTruthy());
  });

  it('e-mail verificado não oferece reenvio', async () => {
    mockMe = makeMe({ emailVerified: true });
    await renderScreen();
    expect(screen.getByText('Verificado')).toBeTruthy();
    expect(screen.queryByTestId('editar-perfil-reenviar')).toBeNull();
  });

  it('troca a foto pela galeria e relê o /me', async () => {
    mockPick.mockResolvedValue({ uri: 'file:///cache/avatar.jpg' });
    mockUpload.mockResolvedValue('https://cdn.example/users/u1/avatar/a.jpg');
    await renderScreen();
    expect(
      screen.getByTestId('editar-perfil-foto-initials', { includeHiddenElements: true }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
    await fireEvent.press(screen.getByTestId('editar-perfil-foto-galeria'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    await waitForAvatarIdle();
    expect(mockPick).toHaveBeenCalledWith('library');
    expect(mockUpload).toHaveBeenCalledWith({ uri: 'file:///cache/avatar.jpg' });
  });

  it('envio de fotos indisponível (503) aparece em português', async () => {
    mockPick.mockResolvedValue({ uri: 'file:///cache/avatar.jpg' });
    mockUpload.mockRejectedValue(
      new ApiError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'x' }),
    );
    await renderScreen();
    await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
    await fireEvent.press(screen.getByTestId('editar-perfil-foto-camera'));
    await waitFor(() => expect(screen.getByText(/envio de fotos está indisponível/)).toBeTruthy());
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('com foto, mostra a imagem e o botão de remover', async () => {
    mockMe = makeMe({ avatarUrl: 'https://cdn.example/users/u1/avatar/a.jpg' });
    await renderScreen();
    expect(
      screen.getByTestId('editar-perfil-foto-image', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId('editar-perfil-foto-remover')).toBeTruthy();
  });

  describe('folha "Foto do perfil" (iOS: o seletor só abre depois que a folha some)', () => {
    beforeEach(() => mockPick.mockResolvedValue(null));

    it('a escolha abre o seletor no onDismiss do Modal, uma vez só', async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-galeria'));
      // A folha já está fechando, mas o seletor espera o fim da animação.
      expect(mockModal.visible).toBe(false);
      expect(mockPick).not.toHaveBeenCalled();
      await act(() => mockModal.onDismiss?.());
      await waitFor(() => expect(mockPick).toHaveBeenCalledWith('library'));
      await waitForAvatarIdle();
      expect(screen.queryByTestId('editar-perfil-foto-galeria')).toBeNull();
      expect(mockPick).toHaveBeenCalledTimes(1);
    });

    it('sem o onDismiss, a reserva por tempo abre o seletor', async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-camera'));
      await waitFor(() => expect(mockPick).toHaveBeenCalledWith('camera'));
      await waitForAvatarIdle();
      expect(mockPick).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['o fundo', 'Fechar'],
      ['outra opção', 'editar-perfil-foto-camera'],
    ])('tocar %s durante o fechamento não troca a escolha', async (_caso, alvo) => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-galeria'));
      await fireEvent.press(
        alvo === 'Fechar' ? screen.getByLabelText('Fechar') : screen.getByTestId(alvo),
      );
      await act(() => mockModal.onDismiss?.());
      await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
      await waitForAvatarIdle();
      expect(mockPick).toHaveBeenCalledWith('library');
    });

    it('fechar sem escolher não abre o seletor, e a folha abre de novo', async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
      await fireEvent.press(screen.getByLabelText('Fechar'));
      await act(() => mockModal.onDismiss?.());
      expect(mockPick).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-trocar'));
      expect(screen.getByTestId('editar-perfil-foto-galeria')).toBeTruthy();
    });

    it('"Remover foto" fica fora da folha: pede confirmação direto, sem esperar fechamento', async () => {
      mockMe = makeMe({ avatarUrl: 'https://cdn.example/users/u1/avatar/a.jpg' });
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      await renderScreen();
      await fireEvent.press(screen.getByTestId('editar-perfil-foto-remover'));
      expect(alert).toHaveBeenCalledWith('Remover foto?', expect.any(String), expect.any(Array));
      expect(screen.queryByTestId('modal')).toBeNull();
      alert.mockRestore();
    });
  });
});
