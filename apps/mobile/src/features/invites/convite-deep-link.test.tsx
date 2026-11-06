import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { ProtectedStack } from '@/features/auth/protected-stack';
import { getRouteAccess, type SessionState } from '@/features/auth/route-access';
import { EntryGate } from '@/features/onboarding/entry-gate';

let mockState: SessionState = { status: 'signed-out' };
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ state: mockState }) }));

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  STORAGE_KEYS: {
    pendingInviteToken: 'pending',
    pendingSpaceSlug: 'space',
    locationOnboardingDone: 'location',
  },
  getStored: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setStored: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeStored: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

// Só a navegação importa aqui: os hooks da API ficam parados (com o perfil incompleto a tela
// nem consulta o convite).
const mockIdle = { isPending: false, mutate: jest.fn() };
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetInvite: () => ({ data: undefined, isPending: true, isError: false, refetch: jest.fn() }),
  useAcceptInvite: () => mockIdle,
  useDeclineInvite: () => mockIdle,
}));

const page = (label: string) => () => <Text>{label}</Text>;

/** Navegação real (guardas + `EntryGate` + tela do convite), com as demais telas como marcadores. */
const routes = (state: SessionState) => {
  mockState = state;
  const client = new QueryClient();
  return {
    _layout: () => (
      <QueryClientProvider client={client}>
        <ProtectedStack access={getRouteAccess(state)} />
      </QueryClientProvider>
    ),
    '(auth)/_layout': require('../../app/(auth)/_layout').default,
    '(auth)/entrar': page('tela entrar'),
    'completar-perfil': page('tela completar perfil'),
    '(tabs)/_layout': () => {
      const { Slot } = require('expo-router');
      return (
        <>
          <EntryGate />
          <Slot />
        </>
      );
    },
    '(tabs)/index': page('tela inicio'),
    'convite/[token]': require('../../app/convite/[token]').default,
  };
};

const signedIn = (name: string): SessionState => ({
  status: 'signed-in',
  me: {
    id: '0192f0a0-0000-7000-8000-000000000001',
    name,
    email: null,
    emailVerified: false,
    phone: '+5531999998888',
    phoneVerified: true,
    avatarUrl: null,
    birthDate: null,
    gender: null,
    favoriteSports: [],
    // Decisão 66: o que falta vem da API; nos testes, nome vazio = conta sem nome nem telefone.
    profile: { missing: name ? [] : ['name', 'phone'] },
    platformRole: 'USER',
    memberships: [],
    access: { super: false, management: false },
  },
});

// O `renderRouter` liga os timers falsos: um `setTimeout` aqui nunca dispararia.
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

describe('deep link spacesports://convite/<token> com perfil incompleto', () => {
  beforeEach(() => {
    mockStore.clear();
    mockStore.set('location', '1');
  });

  it('cadastro incompleto guarda o token e vai completar o perfil', async () => {
    await renderRouter(routes(signedIn('')), { initialUrl: '/convite/tok12345678' });
    await settle();
    expect(screen).toHavePathname('/completar-perfil');
    expect(mockStore.get('pending')).toBe('tok12345678');
  });

  it('com o perfil completo, as abas montam e o EntryGate volta ao convite', async () => {
    mockStore.set('pending', 'tok12345678');
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/convite/tok12345678');
    expect(mockStore.has('pending')).toBe(false);
  });
});
