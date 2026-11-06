import {
  configureApiClient,
  getMe,
  isApiError,
  type MeResponse,
  meResponseSchema,
} from '@space-sports/api-client';

export const API_URL = process.env.API_URL ?? 'http://localhost:3333';

/** `ok`: sessão válida; `anonymous`: sem sessão (ou conta bloqueada); `unavailable`: API fora do ar. */
export type ServerSession =
  | { status: 'ok'; me: MeResponse }
  | { status: 'anonymous' }
  | { status: 'unavailable' };

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Valida a sessão no servidor (usado pelo `proxy.ts`): chama `GET /v1/me` direto na API,
 * repassando o cookie da requisição. O cookie é do domínio do web (o browser fala com a API pelo
 * proxy de `/v1`), por isso só o servidor do Next consegue ler e validar a sessão aqui.
 */
export async function fetchServerSession(cookieHeader: string): Promise<ServerSession> {
  configureApiClient({ baseUrl: API_URL });
  try {
    const body = await getMe({
      headers: { cookie: cookieHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = meResponseSchema.safeParse(body);
    return parsed.success ? { status: 'ok', me: parsed.data } : { status: 'unavailable' };
  } catch (error) {
    if (isApiError(error) && error.status >= 400 && error.status < 500) {
      return { status: 'anonymous' };
    }
    return { status: 'unavailable' };
  }
}
