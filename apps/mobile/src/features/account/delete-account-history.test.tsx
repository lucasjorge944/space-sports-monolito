import type { MeResponse } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SessionProvider, useSession } from '@/features/auth/session';
import {
  getRecentSpaces,
  recentSpacesFile,
  recordRecentSpace,
  resetRecentSpacesForTests,
} from '@/features/explore/recent-spaces-store';
import { makeSpace } from '@/features/explore/test-fixtures';
import { DeleteAccountScreen } from './delete-account-screen';

// Exclusão de ponta a ponta no app: tela → `signOut` da sessão real → histórico local apagado.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { document: {} } }));
jest.mock('expo-image', () => ({
  Image: { clearMemoryCache: jest.fn(async () => true), clearDiskCache: jest.fn(async () => true) },
}));
jest.mock('@/features/auth/token-storage', () => ({
  getSessionToken: jest.fn(async () => 'tok.sig'),
  clearSessionToken: jest.fn(async () => undefined),
}));
jest.mock('@/features/auth/social-sign-in', () => ({
  clearSocialSession: jest.fn(async () => undefined),
}));
jest.mock('@/features/notifications/push-device', () => ({
  unregisterPushDevice: jest.fn(async () => undefined),
}));

const mockMe: MeResponse = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  name: 'Ana',
  email: 'ana@example.com',
  emailVerified: true,
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
};
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  getMe: jest.fn(async () => mockMe),
  signOut: jest.fn(async () => ({})),
  requestMyAccountDeletion: jest.fn(async () => ({
    requestId: 'r1',
    requestedAt: '2026-10-29T15:00:00.000Z',
    dueAt: '2026-11-14T02:30:00.000Z',
  })),
}));

function Status() {
  const { state } = useSession();
  return state.status === 'signed-in' ? <DeleteAccountScreen /> : null;
}

// Sem gc: o timer de 5 min do TanStack (consulta do /me e a mutation) seguraria o Jest no fim.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
});
afterAll(() => client.clear());

beforeEach(() => {
  resetRecentSpacesForTests();
  jest.spyOn(recentSpacesFile, 'read').mockResolvedValue(null);
  jest.spyOn(recentSpacesFile, 'write').mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

describe('Excluir conta apaga os espaços recentes do aparelho (RF-AUTH-03, RF-SPACE-12)', () => {
  it('depois do pedido de exclusão, o histórico local some (memória e arquivo)', async () => {
    const remove = jest.spyOn(recentSpacesFile, 'remove').mockResolvedValue();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await recordRecentSpace({ ...makeSpace(1), viewedAt: '2026-11-03T10:00:00Z' });
    expect(getRecentSpaces()).toHaveLength(1);

    await render(
      <QueryClientProvider client={client}>
        <SessionProvider>
          <Status />
        </SessionProvider>
      </QueryClientProvider>,
    );
    await fireEvent.changeText(await screen.findByLabelText('Senha'), 'segredo123');
    await fireEvent.press(screen.getByTestId('excluir-conta-confirmar'));
    const [, , buttons] = alert.mock.calls.at(-1) ?? [];
    await act(async () => {
      buttons?.find((b: { style?: string }) => b.style === 'destructive')?.onPress?.();
    });

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(getRecentSpaces()).toEqual([]);
    expect(screen.queryByLabelText('Senha')).toBeNull();
  });
});
