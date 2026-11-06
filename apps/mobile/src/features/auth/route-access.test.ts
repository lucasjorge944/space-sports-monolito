import type { MeResponse } from '@space-sports/api-client';
import {
  getRouteAccess,
  isManagement,
  isProfileIncomplete,
  type SessionState,
} from './route-access';

const me = (overrides: Partial<MeResponse> = {}): MeResponse => ({
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
  ...overrides,
});

const signedIn = (overrides?: Partial<MeResponse>): SessionState => ({
  status: 'signed-in',
  me: me(overrides),
});

describe('getRouteAccess', () => {
  it('deslogado só acessa o grupo de auth', () => {
    expect(getRouteAccess({ status: 'signed-out' })).toEqual({
      auth: true,
      completeProfile: false,
      app: false,
    });
  });

  it('cadastro completo (profile.missing vazio) acessa só o app', () => {
    expect(getRouteAccess(signedIn())).toEqual({ auth: false, completeProfile: false, app: true });
  });

  it.each([
    ['conta antiga sem telefone', ['phone']],
    ['conta nova pelo Google (sem telefone)', ['phone']],
    ['conta sem nome nem telefone', ['name', 'phone']],
  ] as const)('%s cai em completar o perfil (decisão 66)', (_, missing) => {
    expect(getRouteAccess(signedIn({ profile: { missing: [...missing] } }))).toEqual({
      auth: false,
      completeProfile: true,
      app: false,
    });
  });

  it('segue o profile.missing da API, não os campos', () => {
    // Nome vazio e telefone nulo, mas a API não exige nada: o app libera.
    expect(getRouteAccess(signedIn({ name: '', phone: null })).app).toBe(true);
  });

  it.each([{ status: 'loading' }, { status: 'offline' }, { status: 'error' }] as const)(
    'em %j nenhum grupo fica liberado',
    (state) => {
      expect(getRouteAccess(state)).toEqual({ auth: false, completeProfile: false, app: false });
    },
  );
});

describe('modo gestão', () => {
  it('segue access.management de /v1/me', () => {
    expect(isManagement(me())).toBe(false);
    expect(isManagement(me({ access: { super: false, management: true } }))).toBe(true);
    expect(isManagement(null)).toBe(false);
  });

  it('isProfileIncomplete olha profile.missing', () => {
    expect(isProfileIncomplete({ profile: { missing: [] } })).toBe(false);
    expect(isProfileIncomplete({ profile: { missing: ['phone'] } })).toBe(true);
  });
});
