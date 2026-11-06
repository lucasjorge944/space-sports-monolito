'use client';

import type { MeResponse } from '@space-sports/api-client';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useMe } from '@/lib/auth/use-me';
import { useSupportSession } from '@/lib/support/session';

export type SpaceMembership = MeResponse['memberships'][number];

type SelectedSpaceValue = {
  status: 'loading' | 'error' | 'ready';
  memberships: SpaceMembership[];
  /** Espaço em contexto no `/painel`; `null` se o usuário não tem vínculo com nenhum. */
  selected: SpaceMembership | null;
  /** Tem mais de um espaço e ainda não escolheu qual abrir (RN-AUTH-03). */
  needsChoice: boolean;
  select: (spaceId: string) => void;
  retry: () => void;
};

const SelectedSpaceContext = createContext<SelectedSpaceValue | null>(null);

const STORAGE_KEY = 'space-sports:selected-space';

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Guarda o espaço escolhido neste navegador (também usado ao aceitar um convite). */
export function storeId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Sem armazenamento (modo privado, bloqueado): a escolha vale só até recarregar.
  }
}

/** Espaços do usuário vindos de `GET /v1/me`; a escolha fica salva neste navegador. */
export function SelectedSpaceProvider({ children }: { children: React.ReactNode }) {
  const { data: me, isPending, isError, refetch } = useMe();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const support = useSupportSession();

  const select = useCallback((spaceId: string) => {
    setChosenId(spaceId);
    storeId(spaceId);
  }, []);

  const value = useMemo<SelectedSpaceValue>(() => {
    const own = me?.memberships ?? [];
    // Modo suporte (RF-SUPER-04): o Super age como Dono só no espaço da sessão.
    const memberships: SpaceMembership[] =
      support && me?.access.super && !own.some((m) => m.space.id === support.spaceId)
        ? [
            {
              space: {
                id: support.spaceId,
                name: support.spaceName,
                slug: support.spaceSlug,
                status: support.spaceStatus,
                logoUrl: null,
              },
              roles: ['OWNER'],
            },
            ...own,
          ]
        : own;
    // `me` só existe no cliente (query), então ler o localStorage aqui não diverge do SSR.
    const wantedId =
      (support && me?.access.super ? support.spaceId : null) ??
      chosenId ??
      (me ? readStoredId() : null);
    const chosen = memberships.find((m) => m.space.id === wantedId) ?? null;
    const selected = chosen ?? memberships[0] ?? null;
    return {
      status: isPending ? 'loading' : isError ? 'error' : 'ready',
      memberships,
      selected,
      needsChoice: !chosen && memberships.length > 1,
      select,
      retry: () => {
        void refetch();
      },
    };
  }, [me, chosenId, support, isPending, isError, select, refetch]);

  return <SelectedSpaceContext.Provider value={value}>{children}</SelectedSpaceContext.Provider>;
}

export function useSelectedSpace(): SelectedSpaceValue {
  const value = useContext(SelectedSpaceContext);
  if (!value) throw new Error('useSelectedSpace precisa estar dentro de SelectedSpaceProvider.');
  return value;
}

/** Como `useSelectedSpace`, mas `null` fora do provider (o menu também serve ao `/super`). */
export function useOptionalSelectedSpace(): SelectedSpaceValue | null {
  return useContext(SelectedSpaceContext);
}
