import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isApiError } from './errors';
import { getMe, signInEmail } from './generated/endpoints';
import { configureApiClient, customFetch } from './mutator';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });
}

function setup(
  response: Response | (() => Response),
  config: Partial<Parameters<typeof configureApiClient>[0]> = {},
): FetchMock {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    typeof response === 'function' ? response() : response,
  );
  configureApiClient({ baseUrl: 'http://api.test', fetch: fetchMock, ...config });
  return fetchMock;
}

/** URL e init da n-ésima chamada ao fetch. */
function call(fetchMock: FetchMock, index = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return { url: String(url), init: init ?? {} };
}

afterEach(() => {
  configureApiClient({ baseUrl: '' });
});

describe('baseUrl', () => {
  it('prefixa o caminho gerado (que já traz /v1)', async () => {
    const fetchMock = setup(json({ ok: true }));
    await customFetch('/v1/me');
    expect(call(fetchMock).url).toBe('http://api.test/v1/me');
  });

  it('ignora a barra final da baseUrl', async () => {
    const fetchMock = setup(json({}), { baseUrl: 'http://api.test/' });
    await customFetch('/v1/me');
    expect(call(fetchMock).url).toBe('http://api.test/v1/me');
  });

  it('baseUrl vazia chama a mesma origem (web com proxy de /v1)', async () => {
    const fetchMock = setup(json({}), { baseUrl: '' });
    await customFetch('/v1/me');
    expect(call(fetchMock).url).toBe('/v1/me');
  });

  it('usa a configuração atual nas funções geradas', async () => {
    const fetchMock = setup(json({ id: 'u1' }), { baseUrl: 'https://api.spacesports.app' });
    await expect(getMe()).resolves.toEqual({ id: 'u1' });
    expect(call(fetchMock).url).toBe('https://api.spacesports.app/v1/me');
    expect(call(fetchMock).init.method).toBe('GET');
  });
});

describe('headers e credenciais', () => {
  it('injeta os headers do hook (bearer do app), inclusive assíncrono', async () => {
    const headers = vi.fn(async () => ({ Authorization: 'Bearer token-123' }));
    const fetchMock = setup(json({}), { headers });
    await getMe();

    const sent = new Headers(call(fetchMock).init.headers);
    expect(sent.get('authorization')).toBe('Bearer token-123');
    expect(headers).toHaveBeenCalledWith({
      url: 'http://api.test/v1/me',
      init: expect.objectContaining({ method: 'GET' }),
    });
  });

  it('chama o hook a cada requisição (token novo depois do login)', async () => {
    let token = 'antigo';
    const fetchMock = setup(() => json({}), {
      headers: () => ({ Authorization: `Bearer ${token}` }),
    });
    await customFetch('/v1/me');
    token = 'novo';
    await customFetch('/v1/me');
    expect(new Headers(call(fetchMock, 1).init.headers).get('authorization')).toBe('Bearer novo');
  });

  it('headers da chamada têm prioridade sobre os do hook', async () => {
    const fetchMock = setup(json({}), {
      headers: () => ({ Authorization: 'Bearer do-hook', 'x-app': 'mobile' }),
    });
    await customFetch('/v1/me', { headers: { authorization: 'Bearer da-chamada' } });

    const sent = new Headers(call(fetchMock).init.headers);
    expect(sent.get('authorization')).toBe('Bearer da-chamada');
    expect(sent.get('x-app')).toBe('mobile');
  });

  it('mantém o Content-Type e o corpo das mutations geradas junto com os headers do hook', async () => {
    const fetchMock = setup(json({ redirect: false, token: 't', user: {} }), {
      headers: () => ({ Authorization: 'Bearer x' }),
    });
    await signInEmail({ email: 'maria@exemplo.com', password: 'senha-segura' });

    const { url, init } = call(fetchMock);
    const sent = new Headers(init.headers);
    expect(url).toBe('http://api.test/v1/auth/sign-in/email');
    expect(init.method).toBe('POST');
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.get('authorization')).toBe('Bearer x');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'maria@exemplo.com',
      password: 'senha-segura',
    });
  });

  it("aplica credentials: 'include' (cookie do web) quando configurado", async () => {
    const fetchMock = setup(json({}), { credentials: 'include' });
    await customFetch('/v1/me');
    expect(call(fetchMock).init.credentials).toBe('include');
  });

  it('não define credentials quando não configurado (app com bearer)', async () => {
    const fetchMock = setup(json({}));
    await customFetch('/v1/me');
    expect(call(fetchMock).init).not.toHaveProperty('credentials');
  });

  it('repassa o signal (cancelamento do TanStack Query)', async () => {
    const fetchMock = setup(json({}));
    const controller = new AbortController();
    await getMe({ signal: controller.signal });
    expect(call(fetchMock).init.signal).toBe(controller.signal);
  });
});

describe('respostas', () => {
  it('devolve o corpo JSON', async () => {
    setup(json({ id: 'u1', memberships: [] }));
    await expect(customFetch('/v1/me')).resolves.toEqual({ id: 'u1', memberships: [] });
  });

  it('devolve undefined em 204', async () => {
    setup(new Response(null, { status: 204 }));
    await expect(customFetch('/v1/auth/sign-out')).resolves.toBeUndefined();
  });

  it('devolve texto quando a resposta não é JSON', async () => {
    setup(new Response('OK', { headers: { 'content-type': 'text/plain' } }));
    await expect(customFetch('/v1/auth/ok')).resolves.toBe('OK');
  });
});

describe('ApiError', () => {
  it('converte o formato padrão { error: { code, message, details }, requestId }', async () => {
    const details = [{ field: 'email', message: 'Invalid email address', code: 'invalid_format' }];
    setup(
      json(
        {
          error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details },
          requestId: 'req-1',
        },
        { status: 400 },
      ),
    );

    const error = await customFetch('/v1/auth/sign-up/email').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
      details,
      requestId: 'req-1',
    });
  });

  it('erros das funções geradas também viram ApiError (ex.: 401 do /v1/me)', async () => {
    setup(
      json(
        { error: { code: 'UNAUTHENTICATED', message: 'Sessão inválida.' }, requestId: 'req-2' },
        { status: 401 },
      ),
    );
    await expect(getMe()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      details: undefined,
      requestId: 'req-2',
    });
  });

  it('corpo fora do padrão vira HTTP_ERROR com o status e o x-request-id do header', async () => {
    setup(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/html', 'x-request-id': 'req-3' },
      }),
    );

    const error = (await customFetch('/v1/me').catch((err: unknown) => err)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'Bad Gateway',
      requestId: 'req-3',
      body: '<html>Bad Gateway</html>',
    });
  });

  it('sem statusText nem corpo, a mensagem traz o status', async () => {
    setup(new Response(null, { status: 500 }));
    await expect(customFetch('/v1/me')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      message: 'HTTP 500',
      requestId: null,
    });
  });

  it('erro de rede não é ApiError (o fetch lança antes de haver resposta)', async () => {
    configureApiClient({
      baseUrl: 'http://api.test',
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    const error = await customFetch('/v1/me').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TypeError);
    expect(isApiError(error)).toBe(false);
  });
});
