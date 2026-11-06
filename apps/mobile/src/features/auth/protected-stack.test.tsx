import { renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { ProtectedStack } from './protected-stack';
import { getRouteAccess, type SessionState } from './route-access';

let mockState: SessionState = { status: 'signed-out' };
jest.mock('./session', () => ({ useSession: () => ({ state: mockState }) }));

const page = (label: string) => () => <Text>{label}</Text>;

const routes = (state: SessionState) => {
  mockState = state;
  return {
    _layout: () => <ProtectedStack access={getRouteAccess(state)} />,
    '(auth)/_layout': require('../../app/(auth)/_layout').default,
    '(auth)/entrar': page('tela entrar'),
    '(auth)/cadastro': page('tela cadastro'),
    'completar-perfil': page('tela completar perfil'),
    '(tabs)/index': page('tela inicio'),
    '+not-found': require('../../app/+not-found').default,
    'redefinir-senha': page('tela redefinir senha'),
    'verificar-email': page('tela verificar email'),
    'convite/[token]': page('tela convite'),
    localizacao: page('tela localizacao'),
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

describe('guarda de rotas', () => {
  it('deslogado na raiz cai na tela de entrar', async () => {
    await renderRouter(routes({ status: 'signed-out' }), { initialUrl: '/' });
    expect(screen.getByText('tela entrar')).toBeTruthy();
    expect(screen.queryByText('tela inicio')).toBeNull();
  });

  it('deslogado não abre o app por deep link', async () => {
    await renderRouter(routes({ status: 'signed-out' }), { initialUrl: '/' });
    expect(screen).toHavePathname('/entrar');
  });

  it('logado com nome vai para o app e não vê as telas de auth', async () => {
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/entrar' });
    expect(screen.getByText('tela inicio')).toBeTruthy();
    expect(screen.queryByText('tela entrar')).toBeNull();
  });

  it('cadastro incompleto (profile.missing) é levado a completar o perfil', async () => {
    await renderRouter(routes(signedIn('')), { initialUrl: '/' });
    expect(screen.getByText('tela completar perfil')).toBeTruthy();
    expect(screen.queryByText('tela inicio')).toBeNull();
  });

  it('o link de redefinir senha abre logado ou não', async () => {
    await renderRouter(routes({ status: 'signed-out' }), {
      initialUrl: '/redefinir-senha?token=abc',
    });
    expect(screen.getByText('tela redefinir senha')).toBeTruthy();
  });

  it('o link do convite abre deslogado (guarda o token e leva ao login)', async () => {
    await renderRouter(routes({ status: 'signed-out' }), { initialUrl: '/convite/tok12345678' });
    expect(screen.getByText('tela convite')).toBeTruthy();
  });

  it('deslogado não abre o onboarding de localização', async () => {
    await renderRouter(routes({ status: 'signed-out' }), { initialUrl: '/localizacao' });
    expect(screen.queryByText('tela localizacao')).toBeNull();
    expect(screen).toHavePathname('/entrar');
  });

  it('cadastro incompleto também abre a rota do convite (a tela guarda o token)', async () => {
    await renderRouter(routes(signedIn('')), { initialUrl: '/convite/tok12345678' });
    expect(screen.getByText('tela convite')).toBeTruthy();
  });

  it('logado abre o convite direto', async () => {
    await renderRouter(routes(signedIn('Ana')), { initialUrl: '/convite/tok12345678' });
    expect(screen.getByText('tela convite')).toBeTruthy();
  });
});
