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

const page = (label: string) => () => <Text>{label}</Text>;

/** Navegação real do app (guardas + `EntryGate`), com as telas trocadas por marcadores. */
const routes = (state: SessionState) => {
  mockState = state;
  return {
    _layout: () => <ProtectedStack access={getRouteAccess(state)} />,
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
    'espaco/_layout': require('../../app/espaco/_layout').default,
    'espaco/[slug]/index': page('tela espaco'),
    'espaco/[slug]/avaliar': page('tela avaliar'),
    'espacos/[slug]': require('../../app/espacos/[slug]').default,
    'espacos/[slug]/avaliar': require('../../app/espacos/[slug]/avaliar').default,
  };
};

const signedIn = (name: string): SessionState => ({
  status: 'signed-in',
  me: {
    id: '0192f0a0-0000-7000-8000-000000000001',
    name,
    email: 'ana@exemplo.com',
    emailVerified: true,
    phone: null,
    phoneVerified: false,
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

describe('deep link spacesports://espacos/<slug> (link "Abrir no app" do web)', () => {
  beforeEach(() => {
    mockStore.clear();
    // Onboarding de localização já feito: não disputa o destino com o link.
    mockStore.set('location', '1');
  });

  it('logado abre a página do espaço (rota espaco/[slug])', async () => {
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/espacos/arena-x' });
    await settle();
    expect(screen).toHavePathname('/espaco/arena-x');
    expect(screen.getByText('tela espaco')).toBeTruthy();
    expect(mockStore.has('space')).toBe(false);
  });

  it('deslogado guarda o espaço e vai ao login', async () => {
    await renderRouter(routes({ status: 'signed-out' }), { initialUrl: '/espacos/arena-x' });
    await settle();
    expect(screen).toHavePathname('/entrar');
    expect(mockStore.get('space')).toBe('arena-x');
  });

  it('depois de entrar, as abas montam e o EntryGate abre o espaço guardado', async () => {
    mockStore.set('space', 'arena-x');
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/espaco/arena-x');
    expect(mockStore.has('space')).toBe(false);
  });

  it('cadastro incompleto guarda o espaço e completa o perfil antes', async () => {
    await renderRouter(routes(signedIn('')), { initialUrl: '/espacos/arena-x' });
    await settle();
    expect(screen).toHavePathname('/completar-perfil');
    expect(mockStore.get('space')).toBe('arena-x');
  });

  it('slug inválido não guarda nada e volta ao início', async () => {
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/espacos/Arena%20X' });
    await settle();
    expect(screen).toHavePathname('/');
    expect(mockStore.has('space')).toBe(false);
  });
});

describe('deep link spacesports://espacos/<slug>/avaliar (RF-REVIEW-02)', () => {
  beforeEach(() => {
    mockStore.clear();
    mockStore.set('location', '1');
  });

  it('logado abre a tela de avaliar', async () => {
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/espacos/arena-x/avaliar' });
    await settle();
    expect(screen).toHavePathname('/espaco/arena-x/avaliar');
    expect(screen.getByText('tela avaliar')).toBeTruthy();
  });

  it('deslogado guarda o destino, entra e volta para a tela de avaliar', async () => {
    await renderRouter(routes({ status: 'signed-out' }), {
      initialUrl: '/espacos/arena-x/avaliar',
    });
    await settle();
    expect(screen).toHavePathname('/entrar');
    expect(mockStore.get('space')).toBe('arena-x/avaliar');

    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/espaco/arena-x/avaliar');
    expect(mockStore.has('space')).toBe(false);
  });
});
