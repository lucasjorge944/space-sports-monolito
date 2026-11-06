import { Redirect } from 'expo-router';
import { homeHref } from '@/features/auth/route-access';
import { useSession } from '@/features/auth/session';

/**
 * Rota bloqueada pela guarda de sessão (ex.: abrir `/` deslogado, ou um link para uma aba sem
 * estar logado) não casa com nenhuma tela; levamos para o início que a sessão atual permite.
 */
export default function NotFoundScreen() {
  const { state } = useSession();
  return <Redirect href={homeHref(state)} />;
}
