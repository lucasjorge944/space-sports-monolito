import { customFetch } from '@space-sports/api-client';
import { isAnonymousPath, onSessionRejected, setupApiClient } from './api';
import * as tokens from './token-storage';

jest.mock('./token-storage', () => ({
  getSessionToken: jest.fn(),
  setSessionToken: jest.fn(async () => undefined),
  clearSessionToken: jest.fn(async () => undefined),
}));

const mocked = jest.mocked(tokens);

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return jest.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );
}

const sentHeaders = (fetchMock: jest.Mock) =>
  new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);

beforeEach(() => jest.clearAllMocks());

describe('setupApiClient', () => {
  it('manda Authorization: Bearer com o token guardado', async () => {
    mocked.getSessionToken.mockResolvedValue('tok.sig');
    const fetchMock = respond(200, { ok: true });
    setupApiClient({ baseUrl: 'https://api.test', fetch: fetchMock as never });

    await customFetch('/v1/me');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/v1/me');
    expect(sentHeaders(fetchMock).get('authorization')).toBe('Bearer tok.sig');
  });

  it('não usa cookies nativos: o fetch recebe credentials: omit', async () => {
    mocked.getSessionToken.mockResolvedValue('tok.sig');
    const fetchMock = respond(200, {});
    setupApiClient({ baseUrl: 'https://api.test', fetch: fetchMock as never });

    await customFetch('/v1/auth/sign-in/email', { method: 'POST' });

    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].credentials).toBe('omit');
  });

  it('sem token não manda Authorization', async () => {
    mocked.getSessionToken.mockResolvedValue(null);
    const fetchMock = respond(200, {});
    setupApiClient({ baseUrl: 'https://api.test', fetch: fetchMock as never });

    await customFetch('/v1/auth/sign-in/email', { method: 'POST' });

    expect(sentHeaders(fetchMock).has('authorization')).toBe(false);
  });

  it.each(['/v1/ads?placement=EXPLORE_FEED&lat=-19.9', '/v1/ads/events'])(
    'anúncios vão sem Authorization mesmo logado (RN-ADS-03): %s',
    async (path) => {
      mocked.getSessionToken.mockResolvedValue('tok.sig');
      const fetchMock = respond(200, {});
      setupApiClient({ baseUrl: 'https://api.test', fetch: fetchMock as never });

      await customFetch(path, { method: path.endsWith('events') ? 'POST' : 'GET' });

      expect(sentHeaders(fetchMock).has('authorization')).toBe(false);
      expect(mocked.getSessionToken).not.toHaveBeenCalled();
    },
  );

  it('isAnonymousPath só pega as rotas dos anúncios', () => {
    expect(isAnonymousPath('https://api.test/v1/ads?placement=EXPLORE_HERO')).toBe(true);
    expect(isAnonymousPath('/v1/ads')).toBe(true);
    expect(isAnonymousPath('https://api.test/v1/ads/events')).toBe(true);
    expect(isAnonymousPath('https://api.test/v1/admin/ads')).toBe(false);
    expect(isAnonymousPath('https://api.test/v1/ads-x')).toBe(false);
    expect(isAnonymousPath('https://api.test/v1/me')).toBe(false);
  });

  it('guarda o token novo que vem em set-auth-token', async () => {
    mocked.getSessionToken.mockResolvedValue(null);
    const fetchMock = respond(200, { token: 'raw' }, { 'set-auth-token': 'signed.token' });
    setupApiClient({ baseUrl: 'https://api.test', fetch: fetchMock as never });

    await customFetch('/v1/auth/sign-in/email', { method: 'POST' });

    expect(mocked.setSessionToken).toHaveBeenCalledWith('signed.token');
  });

  it('401 num token enviado limpa a sessão e avisa quem escuta', async () => {
    mocked.getSessionToken.mockResolvedValue('tok.sig');
    const rejected = jest.fn();
    const off = onSessionRejected(rejected);
    setupApiClient({
      baseUrl: 'https://api.test',
      fetch: respond(401, {
        error: { code: 'UNAUTHENTICATED', message: 'x' },
        requestId: null,
      }) as never,
    });

    await expect(customFetch('/v1/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(mocked.clearSessionToken).toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledTimes(1);
    off();
  });

  it('401 de login (sem token enviado) não derruba nada', async () => {
    mocked.getSessionToken.mockResolvedValue(null);
    const rejected = jest.fn();
    const off = onSessionRejected(rejected);
    setupApiClient({
      baseUrl: 'https://api.test',
      fetch: respond(401, {
        error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' },
        requestId: null,
      }) as never,
    });

    await expect(customFetch('/v1/auth/sign-in/email', { method: 'POST' })).rejects.toMatchObject({
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });

    expect(mocked.clearSessionToken).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    off();
  });

  it('401 no sign-out não dispara o handler (o logout já limpa)', async () => {
    mocked.getSessionToken.mockResolvedValue('tok.sig');
    const rejected = jest.fn();
    const off = onSessionRejected(rejected);
    setupApiClient({
      baseUrl: 'https://api.test',
      fetch: respond(401, {
        error: { code: 'UNAUTHENTICATED', message: 'x' },
        requestId: null,
      }) as never,
    });

    await expect(customFetch('/v1/auth/sign-out', { method: 'POST' })).rejects.toBeDefined();

    expect(rejected).not.toHaveBeenCalled();
    off();
  });

  it('403 ACCOUNT_INACTIVE num token enviado limpa a sessão e avisa quem escuta', async () => {
    mocked.getSessionToken.mockResolvedValue('tok.sig');
    const rejected = jest.fn();
    const off = onSessionRejected(rejected);
    setupApiClient({
      baseUrl: 'https://api.test',
      fetch: respond(403, {
        error: { code: 'ACCOUNT_INACTIVE', message: 'x' },
        requestId: null,
      }) as never,
    });

    await expect(customFetch('/v1/me')).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });

    expect(mocked.clearSessionToken).toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledTimes(1);
    off();
  });

  it('outros 403 não derrubam a sessão', async () => {
    mocked.getSessionToken.mockResolvedValue('tok.sig');
    const rejected = jest.fn();
    const off = onSessionRejected(rejected);
    setupApiClient({
      baseUrl: 'https://api.test',
      fetch: respond(403, { error: { code: 'FORBIDDEN', message: 'x' }, requestId: null }) as never,
    });

    await expect(customFetch('/v1/me')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocked.clearSessionToken).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    off();
  });

  it('403 ACCOUNT_INACTIVE no login (sem token enviado) só mostra o erro', async () => {
    mocked.getSessionToken.mockResolvedValue(null);
    const rejected = jest.fn();
    const off = onSessionRejected(rejected);
    setupApiClient({
      baseUrl: 'https://api.test',
      fetch: respond(403, {
        error: { code: 'ACCOUNT_INACTIVE', message: 'x' },
        requestId: null,
      }) as never,
    });

    await expect(customFetch('/v1/auth/sign-in/email', { method: 'POST' })).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    });

    expect(rejected).not.toHaveBeenCalled();
    off();
  });
});
