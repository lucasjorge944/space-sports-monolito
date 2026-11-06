import {
  configureApiClient,
  getSpaceBySlug,
  getSpaceReviewSummary,
  isApiError,
  listSpaceReviews,
} from '@space-sports/api-client';
import { API_URL } from '@/lib/auth/server-session';

const REVALIDATE_SECONDS = 300;

/**
 * Página pública do espaço no servidor (SEO). `null` se o espaço não existe ou não está visível.
 * `configureApiClient` e a chamada rodam no mesmo tick: o cliente lê a configuração de forma
 * síncrona, então nenhuma outra requisição troca a `baseUrl` no meio.
 */
export async function fetchPublicSpace(slug: string) {
  try {
    configureApiClient({ baseUrl: API_URL });
    return await getSpaceBySlug(slug, {
      signal: AbortSignal.timeout(8000),
      // `next` é extensão do fetch do Next (cache com revalidação); não existe em RequestInit.
      next: { revalidate: REVALIDATE_SECONDS },
    } as RequestInit);
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/** `next.revalidate` do fetch do Next (não existe em `RequestInit`). */
const cached = (seconds: number) =>
  ({ signal: AbortSignal.timeout(8000), next: { revalidate: seconds } }) as RequestInit;

/** As avaliações mudam mais que o cadastro do espaço: cache curto. */
const REVIEWS_REVALIDATE_SECONDS = 60;

/**
 * Resumo das avaliações (RF-REVIEW-03) para a página pública. `null` se a API falhar: o bloco mostra
 * um aviso e o resto da página continua.
 */
export async function fetchReviewSummary(spaceId: string) {
  try {
    configureApiClient({ baseUrl: API_URL });
    return await getSpaceReviewSummary(spaceId, cached(REVIEWS_REVALIDATE_SECONDS));
  } catch {
    return null;
  }
}

/**
 * Uma página da lista pública (RF-REVIEW-04). `null` se a API falhar (inclusive cursor inválido ou
 * vencido, `INVALID_CURSOR`).
 */
export async function fetchSpaceReviews(
  spaceId: string,
  params: { rating?: number | undefined; cursor?: string | undefined; limit: number },
) {
  try {
    configureApiClient({ baseUrl: API_URL });
    return await listSpaceReviews(
      spaceId,
      {
        limit: params.limit,
        ...(params.rating ? { rating: params.rating } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
      cached(REVIEWS_REVALIDATE_SECONDS),
    );
  } catch {
    return null;
  }
}
