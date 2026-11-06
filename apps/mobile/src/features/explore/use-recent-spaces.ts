import { useListRecentSpaces } from '@space-sports/api-client';
import { useMemo } from 'react';
import { useSession } from '@/features/auth/session';
import { mergeRecentSpaces, type RecentSpace, useLocalRecentSpaces } from './recent-spaces-store';

/**
 * Espaços recentes (RF-SPACE-12): o histórico do aparelho e, logado, os da conta
 * (`GET /v1/me/recent-spaces`). Erro da API fica só com o histórico local.
 */
export function useRecentSpaces({ enabled }: { enabled: boolean }) {
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const local = useLocalRecentSpaces();
  const remote = useListRecentSpaces({
    query: { enabled: enabled && signedIn, staleTime: 60_000 },
  });
  const remoteItems = signedIn ? remote.data?.items : undefined;
  const items: RecentSpace[] = useMemo(
    () => mergeRecentSpaces(local, remoteItems ?? []),
    [local, remoteItems],
  );
  // Só com conta, sem histórico local e com a API ainda respondendo.
  const loading = enabled && signedIn && local.length === 0 && remote.isPending;
  return {
    items,
    loading,
    refetch: () => (enabled && signedIn ? remote.refetch() : Promise.resolve()),
  };
}
