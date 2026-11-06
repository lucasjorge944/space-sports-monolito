import { extractSessionToken } from './social-sign-in';

jest.mock('./auth-client', () => ({
  AUTH_COOKIE_PREFIX: 'space-sports',
  EXPO_COOKIE_KEY: 'space-sports_cookie',
  EXPO_SESSION_CACHE_KEY: 'space-sports_session_data',
  authClient: {},
}));
jest.mock('expo-secure-store', () => ({}));

const jar = (cookies: Record<string, { value: string; expires: string | null }>) =>
  JSON.stringify(cookies);

describe('extractSessionToken', () => {
  it('pega o token do cookie de sessão do plugin Expo', () => {
    expect(
      extractSessionToken(
        jar({
          'space-sports.oauth_state': { value: 'estado', expires: null },
          'space-sports.session_token': { value: 'tok.sig%3D', expires: null },
        }),
      ),
    ).toBe('tok.sig%3D');
  });

  it('aceita o prefixo __Secure- (HTTPS)', () => {
    expect(
      extractSessionToken(
        jar({ '__Secure-space-sports.session_token': { value: 'a.b', expires: null } }),
      ),
    ).toBe('a.b');
  });

  it('ignora cookie expirado', () => {
    expect(
      extractSessionToken(
        jar({
          'space-sports.session_token': { value: 'a.b', expires: '2000-01-01T00:00:00.000Z' },
        }),
      ),
    ).toBeNull();
  });

  it.each([null, undefined, '', '{}', 'não é json', '[]'])('sem sessão em %j', (raw) => {
    expect(extractSessionToken(raw)).toBeNull();
  });
});
