import {
  getGetMeQueryKey,
  getMe,
  isApiError,
  type MeResponse,
  meResponseSchema,
  signOut as signOutRequest,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { clearRecentSpaces } from '@/features/explore/recent-spaces-store';
import { unregisterPushDevice } from '@/features/notifications/push-device';
import { onSessionRejected } from './api';
import { isManagement, type SessionState } from './route-access';
import { clearSocialSession } from './social-sign-in';
import { clearSessionToken, getSessionToken } from './token-storage';

interface SessionContextValue {
  state: SessionState;
  /** Lê o token e valida a sessão em GET /v1/me. Chamar depois de login, cadastro ou editar o perfil. */
  refresh: () => Promise<void>;
  /** Encerra a sessão na API (se der) e apaga o token do aparelho. */
  signOut: () => Promise<void>;
}

/** Rede lenta no logout não pode prender a saída: o servidor limpa o token inválido depois. */
const PUSH_UNREGISTER_TIMEOUT_MS = 3000;

/** Espera `promise` por até `ms`; o que vier primeiro encerra a espera (e o timer é desfeito). */
async function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fotos baixadas (do perfil e dos espaços) ficam no cache do expo-image; ao sair, nada da conta
 * fica no aparelho (LGPD). Falha na limpeza não pode prender a saída.
 */
async function clearImageCache(): Promise<void> {
  try {
    await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
  } catch {
    // O sistema limpa o cache do app depois.
  }
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  // Evita que uma resposta antiga de /me sobrescreva um logout feito enquanto ela voltava.
  const generation = useRef(0);

  const endSession = useCallback(async () => {
    generation.current += 1;
    // Espaços recentes também saem: nada de rastro de onde a pessoa joga (RF-SPACE-12). Vale para
    // sair, excluir e inativar a conta, que terminam aqui.
    await Promise.all([
      clearSessionToken(),
      clearSocialSession(),
      clearImageCache(),
      clearRecentSpaces(),
    ]);
    queryClient.clear();
    setState({ status: 'signed-out' });
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const token = await getSessionToken();
    if (current !== generation.current) return;
    if (!token) {
      setState({ status: 'signed-out' });
      return;
    }
    try {
      const raw = await queryClient.fetchQuery({
        queryKey: getGetMeQueryKey(),
        queryFn: ({ signal }) => getMe({ signal }),
        staleTime: 0,
        retry: false,
      });
      if (current !== generation.current) return;
      // Resposta fora do contrato não é falta de rede: tentar de novo não resolve sozinho.
      const parsed = meResponseSchema.safeParse(raw);
      setState(parsed.success ? { status: 'signed-in', me: parsed.data } : { status: 'error' });
    } catch (error) {
      if (current !== generation.current) return;
      // Token recusado ou conta bloqueada/inativa: não há sessão. Qualquer outra falha (rede, 5xx)
      // mantém o token e deixa a pessoa tentar de novo.
      if (
        isApiError(error) &&
        (error.status === 401 || error.code === 'USER_BLOCKED' || error.code === 'ACCOUNT_INACTIVE')
      ) {
        await endSession();
      } else {
        setState({ status: 'offline' });
      }
    }
  }, [queryClient, endSession]);

  const signOut = useCallback(async () => {
    // Antes de encerrar a sessão: a remoção do token push precisa do Bearer ainda válido.
    await withTimeout(unregisterPushDevice(), PUSH_UNREGISTER_TIMEOUT_MS);
    try {
      await signOutRequest({});
    } catch {
      // Sem rede ou token já inválido: o token local é apagado de qualquer jeito.
    }
    await endSession();
  }, [endSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onSessionRejected(() => void endSession()), [endSession]);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession precisa estar dentro de <SessionProvider>');
  return value;
}

/** Usuário logado de GET /v1/me. Só para telas atrás da guarda de sessão. */
export function useMe(): MeResponse {
  const { state } = useSession();
  if (state.status !== 'signed-in') throw new Error('useMe só vale com a sessão ativa');
  return state.me;
}

/** Mostra a aba "Meu Espaço" (modo gestão) só para quem tem vínculo com algum espaço. */
export function useIsManager(): boolean {
  const { state } = useSession();
  return state.status === 'signed-in' && isManagement(state.me);
}
