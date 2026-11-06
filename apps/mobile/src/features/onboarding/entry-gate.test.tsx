import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { EntryGate } from './entry-gate';

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

const routes = {
  _layout: require('expo-router').Stack,
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
  'convite/[token]': page('tela convite'),
  'espaco/[slug]/index': page('tela espaco'),
  'verificar-email': page('tela verificar email'),
  localizacao: page('tela localizacao'),
};

// O `renderRouter` liga os timers falsos: um `setTimeout` aqui nunca dispararia.
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

describe('volta ao convite depois do login ou do cadastro', () => {
  beforeEach(() => mockStore.clear());

  it('convite aberto antes de entrar volta depois do login, uma vez só', async () => {
    mockStore.set('pending', 'tok12345678');
    await renderRouter(routes, { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/convite/tok12345678');
    expect(mockStore.has('pending')).toBe(false);
  });

  it('com a tela de verificação do cadastro por cima, o convite espera a saída dela', async () => {
    mockStore.set('pending', 'tok12345678');
    const { router } = require('expo-router');
    await renderRouter(routes, { initialUrl: '/' });
    await act(async () => router.push('/verificar-email'));
    await settle();
    await act(async () => router.back());
    await settle();
    expect(screen).toHavePathname('/convite/tok12345678');
  });

  it('o convite vem antes do onboarding de localização', async () => {
    mockStore.set('pending', 'tok12345678');
    await renderRouter(routes, { initialUrl: '/' });
    await settle();
    expect(screen.queryByText('tela localizacao')).toBeNull();
  });

  it('sem convite, segue o onboarding de localização', async () => {
    await renderRouter(routes, { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/localizacao');
  });

  it('link de espaço aberto antes de entrar abre o espaço depois do login, uma vez só', async () => {
    mockStore.set('space', 'arena-x');
    await renderRouter(routes, { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/espaco/arena-x');
    expect(mockStore.has('space')).toBe(false);
  });

  it('com convite e espaço guardados, o convite vence e o espaço é descartado', async () => {
    mockStore.set('pending', 'tok12345678');
    mockStore.set('space', 'arena-x');
    await renderRouter(routes, { initialUrl: '/' });
    await settle();
    expect(screen).toHavePathname('/convite/tok12345678');
    expect(mockStore.has('space')).toBe(false);
  });
});
