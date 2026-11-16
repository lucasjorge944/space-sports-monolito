import {
  type ConnectedAppList,
  disconnectConnectedApp,
  getListConnectedAppsQueryKey,
  listConnectedApps,
} from '@space-sports/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// Hooks do app (não os gerados): o api-client resolve outra cópia do React/TanStack no Jest.

/** Apps conectados da pessoa (RF-MCP-05), do mais recente para o mais antigo. */
export function useConnectedApps() {
  return useQuery({
    queryKey: getListConnectedAppsQueryKey(),
    queryFn: ({ signal }): Promise<ConnectedAppList> => listConnectedApps({ signal }),
  });
}

/** Desconecta pelo id da conexão (não o `client_id`) e recarrega a lista. */
export function useDisconnectApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => disconnectConnectedApp(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConnectedAppsQueryKey() }),
  });
}
