import {
  getListAdsQueryKey,
  isApiError,
  type ListAdsParams,
  type ListAdsPlacement,
  listAds,
} from '@space-sports/api-client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { Coords } from '@/features/location/coords';
import type { Ad } from './feed';

/**
 * As peças ficam alguns minutos em cache (o token de entrega vale 2 h), mas cada abertura do
 * Explorar busca de novo (quem chama faz o `refetch`).
 */
export const ADS_STALE_MS = 5 * 60_000;
/** Busca uma nova entrega quando falta isso para o primeiro token vencer. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const NO_ADS: Ad[] = [];
/** Maior atraso que o `setTimeout` aceita (acima disso ele dispara na hora). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Coordenadas com 2 casas (~1 km): bastam para achar a cidade e não expõem a posição exata. */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Daqui a quanto tempo buscar uma nova entrega porque um token vai vencer, ou `null` se não precisa.
 * Entrega que já chegou perto de vencer não agenda nada (evita buscar em laço).
 */
export function tokenRefreshDelay(
  ads: readonly Pick<Ad, 'tokenExpiresAt'>[],
  fetchedAt: number,
  now: number,
): number | null {
  const expiries = ads.map((ad) => Date.parse(ad.tokenExpiresAt)).filter(Number.isFinite);
  if (expiries.length === 0) return null;
  const refreshAt = Math.min(...expiries) - TOKEN_REFRESH_MARGIN_MS;
  if (refreshAt <= fetchedAt) return null;
  return Math.min(Math.max(0, refreshAt - now), MAX_TIMEOUT_MS);
}

/** 4xx (inclusive o 429 `TOO_MANY_REQUESTS`) não tenta de novo; rede e 5xx, uma vez. */
export function shouldRetryAds(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status < 500) return false;
  return failureCount < 1;
}

/** Parâmetros de `GET /v1/ads`: a vaga, as coordenadas (a API acha a cidade) e o esporte atual. */
export function buildAdsParams(
  placement: ListAdsPlacement,
  coords: Coords | null,
  sport: string | null,
): ListAdsParams {
  return {
    placement,
    ...(coords ? { lat: roundCoord(coords.lat), lng: roundCoord(coords.lng) } : {}),
    ...(sport ? { sport } : {}),
  };
}

/**
 * Peças no ar para a vaga (RF-ADS-04, RF-ADS-05, RF-ADS-07). Nunca mostra erro: falha, 429 ou
 * lista vazia só deixam o Explorar sem anúncio. Com `active` (Explorar em foco e app ativo), busca
 * de novo antes de o primeiro token da entrega vencer.
 */
export function useAds(
  placement: ListAdsPlacement,
  coords: Coords | null,
  sport: string | null,
  { enabled = true, active = true }: { enabled?: boolean; active?: boolean } = {},
) {
  const params = useMemo(
    () => buildAdsParams(placement, coords, sport),
    [placement, coords, sport],
  );
  const query = useQuery({
    queryKey: getListAdsQueryKey(params),
    queryFn: ({ signal }) => listAds(params, { signal }),
    enabled,
    staleTime: ADS_STALE_MS,
    retry: shouldRetryAds,
    // Erro não volta a tentar só porque a tela remontou; o puxar para atualizar tenta.
    retryOnMount: false,
    // A nova busca vem da abertura do Explorar (uma por foco); nada de buscas extras por conta
    // própria, por causa do limite de 60 GET /v1/ads por minuto.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const ads: Ad[] = query.data?.items ?? NO_ADS;

  const { refetch, dataUpdatedAt } = query;
  useEffect(() => {
    if (!enabled || !active) return;
    const delay = tokenRefreshDelay(ads, dataUpdatedAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => void refetch({ cancelRefetch: false }), delay);
    return () => clearTimeout(timer);
  }, [enabled, active, ads, dataUpdatedAt, refetch]);

  return { ...query, ads };
}
