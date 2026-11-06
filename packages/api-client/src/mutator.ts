import { ApiError } from './errors';

export interface ApiClientRequest {
  /** URL final da requisição (baseUrl + caminho). */
  url: string;
  init: RequestInit;
}

export interface ApiClientConfig {
  /**
   * Origem da API, sem `/v1` (os caminhos gerados já começam com `/v1`). Ex.:
   * `http://localhost:3333`; vazio para chamar a mesma origem (web com proxy de `/v1` no Next).
   */
  baseUrl: string;
  /** `include` no web, para mandar o cookie de sessão. O app usa bearer e não precisa. */
  credentials?: RequestCredentials;
  /**
   * Headers de cada requisição; os passados na chamada têm prioridade. Pode ser assíncrono, ex.:
   * o app lê o token do SecureStore e devolve `{ Authorization: 'Bearer <token>' }`.
   */
  headers?: (
    request: ApiClientRequest,
  ) => HeadersInit | undefined | Promise<HeadersInit | undefined>;
  /** `fetch` alternativo (testes, SSR). Padrão: o `fetch` global. */
  fetch?: typeof fetch;
}

let config: ApiClientConfig = { baseUrl: '' };

/** Define a configuração do cliente (substitui a anterior). Chame uma vez no boot do app. */
export function configureApiClient(next: ApiClientConfig): void {
  config = { ...next };
}

export function getApiClientConfig(): Readonly<ApiClientConfig> {
  return config;
}

/**
 * Mutator do orval: todas as funções e hooks gerados passam por aqui. Devolve o corpo da resposta
 * já parseado e lança `ApiError` em respostas >= 400.
 */
export async function customFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = joinUrl(config.baseUrl, path);
  const headers = new Headers(await config.headers?.({ url, init }));
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  const credentials = init.credentials ?? config.credentials;
  const fetchImpl = config.fetch ?? globalThis.fetch;

  const response = await fetchImpl(url, {
    ...init,
    headers,
    ...(credentials ? { credentials } : {}),
  });
  const body = await readBody(response);
  if (!response.ok) throw ApiError.fromResponse(response, body);
  return body as T;
}

/** Tipo de erro dos hooks gerados (`useQuery`/`useMutation` → `error: ApiError | null`). */
export type ErrorType<_Error> = ApiError;
/** Tipo do corpo das mutations geradas. */
export type BodyType<Body> = Body;

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  if (!response.headers.get('content-type')?.includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
