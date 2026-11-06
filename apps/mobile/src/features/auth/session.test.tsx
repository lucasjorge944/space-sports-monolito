import { ApiError, type MeResponse } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SessionProvider, useIsManager, useSession } from './session';
import * as tokens from './token-storage';

const mockGetMe = jest.fn();
const mockSignOut = jest.fn();
const calls: string[] = [];
jest.mock('@/features/notifications/push-device', () => ({
  unregisterPushDevice: jest.fn(async () => {
    calls.push('push');
  }),
}));
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));
jest.mock('./token-storage', () => ({
  getSessionToken: jest.fn(),
  clearSessionToken: jest.fn(async () => undefined),
}));
jest.mock('./social-sign-in', () => ({ clearSocialSession: jest.fn(async () => undefined) }));
jest.mock('@/features/explore/recent-spaces-store', () => ({
  clearRecentSpaces: jest.fn(async () => undefined),
}));
const mockRecent = jest.requireMock<{ clearRecentSpaces: jest.Mock }>(
  '@/features/explore/recent-spaces-store',
);
jest.mock('expo-image', () => ({
  Image: {
    clearMemoryCache: jest.fn(async () => true),
    clearDiskCache: jest.fn(async () => true),
  },
}));
const mockImage = jest.requireMock<{
  Image: { clearMemoryCache: jest.Mock; clearDiskCache: jest.Mock };
}>('expo-image').Image;

const me = (overrides: Partial<MeResponse> = {}): MeResponse => ({
  id: '0192f0a0-0000-7000-8000-000000000001',
  name: 'Ana',
  email: 'ana@example.com',
  emailVerified: false,
  phone: null,
  phoneVerified: false,
  avatarUrl: null,
  birthDate: null,
  gender: null,
  favoriteSports: [],
  profile: { missing: [] },
  platformRole: 'USER',
  memberships: [],
  access: { super: false, management: false },
  ...overrides,
});

// O fetchQuery do provider agenda o timer de gc (5 min) do react-query; sem `clear()` ele
// mantém o processo do Jest vivo depois do fim dos testes.
const clients: QueryClient[] = [];

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
  return await renderHook(() => ({ session: useSession(), manager: useIsManager() }), { wrapper });
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe('SessionProvider', () => {
  it('sem token: deslogado, sem chamar a API', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue(null);
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-out'));
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it('com token válido: logado com o /v1/me; gestão vem de access.management', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue(
      me({ access: { super: false, management: true }, memberships: [] }),
    );
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));
    expect(result.current.manager).toBe(true);
  });

  it('jogador sem vínculo não vê o modo gestão', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue(me());
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));
    expect(result.current.manager).toBe(false);
  });

  it('401 em /v1/me: apaga o token e fica deslogado', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('velho.sig');
    mockGetMe.mockRejectedValue(
      new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' }),
    );
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-out'));
    expect(tokens.clearSessionToken).toHaveBeenCalled();
  });

  it('conta bloqueada: deslogado', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockRejectedValue(new ApiError({ status: 403, code: 'USER_BLOCKED', message: 'x' }));
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-out'));
  });

  it('conta inativa: apaga o token e fica deslogado', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockRejectedValue(
      new ApiError({ status: 403, code: 'ACCOUNT_INACTIVE', message: 'x' }),
    );
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-out'));
    expect(tokens.clearSessionToken).toHaveBeenCalled();
  });

  it('sem rede: offline, mantém o token e permite tentar de novo', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('offline'));
    expect(tokens.clearSessionToken).not.toHaveBeenCalled();

    mockGetMe.mockResolvedValue(me());
    await act(() => result.current.session.refresh());
    expect(result.current.session.state.status).toBe('signed-in');
  });

  it('/v1/me fora do contrato: estado de erro, não "sem conexão", e mantém o token', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue({ id: 'não-é-uuid' });
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('error'));
    expect(tokens.clearSessionToken).not.toHaveBeenCalled();
  });

  it('sair encerra a sessão mesmo se a API falhar', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue(me());
    mockSignOut.mockRejectedValue(new TypeError('Network request failed'));
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));

    await act(() => result.current.session.signOut());

    expect(result.current.session.state.status).toBe('signed-out');
    expect(tokens.clearSessionToken).toHaveBeenCalled();
  });

  it('sair apaga as fotos do cache do expo-image (memória e disco, LGPD)', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue(me({ avatarUrl: 'https://cdn.example/users/u1/avatar/a.jpg' }));
    mockSignOut.mockResolvedValue({});
    mockImage.clearDiskCache.mockRejectedValueOnce(new Error('disco'));
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));

    await act(() => result.current.session.signOut());

    expect(mockImage.clearMemoryCache).toHaveBeenCalled();
    expect(mockImage.clearDiskCache).toHaveBeenCalled();
    // Falha na limpeza não prende a saída.
    expect(result.current.session.state.status).toBe('signed-out');
  });

  it('sair apaga o histórico de espaços recentes do aparelho (RF-SPACE-12)', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue(me());
    mockSignOut.mockResolvedValue({});
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));
    mockRecent.clearRecentSpaces.mockClear();

    // A exclusão e a inativação da conta também terminam no `signOut` (telas da conta).
    await act(() => result.current.session.signOut());

    expect(mockRecent.clearRecentSpaces).toHaveBeenCalledTimes(1);
  });

  it('conta inativada em outro aparelho: o histórico de recentes também sai', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockRejectedValue(
      new ApiError({ status: 403, code: 'ACCOUNT_INACTIVE', message: 'Conta inativa' }),
    );
    mockRecent.clearRecentSpaces.mockClear();
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-out'));
    expect(mockRecent.clearRecentSpaces).toHaveBeenCalled();
  });

  it('sair remove o token push ANTES de encerrar a sessão na API (precisa do Bearer)', async () => {
    jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
    mockGetMe.mockResolvedValue(me());
    mockSignOut.mockImplementation(async () => {
      calls.push('sign-out');
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));
    calls.length = 0;

    await act(() => result.current.session.signOut());

    expect(calls).toEqual(['push', 'sign-out']);
  });

  it('sair não fica preso se a remoção do token push demorar', async () => {
    jest.useFakeTimers();
    try {
      const push = jest.requireMock('@/features/notifications/push-device') as {
        unregisterPushDevice: jest.Mock;
      };
      push.unregisterPushDevice.mockImplementationOnce(() => new Promise(() => undefined));
      jest.mocked(tokens.getSessionToken).mockResolvedValue('tok.sig');
      mockGetMe.mockResolvedValue(me());
      mockSignOut.mockResolvedValue(undefined);
      const { result } = await setup();
      await waitFor(() => expect(result.current.session.state.status).toBe('signed-in'));

      let done = false;
      const pending = result.current.session.signOut().then(() => {
        done = true;
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2900);
      });
      expect(done).toBe(false);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(200);
        await pending;
      });

      expect(mockSignOut).toHaveBeenCalled();
      expect(result.current.session.state.status).toBe('signed-out');
    } finally {
      jest.useRealTimers();
    }
  });
});
