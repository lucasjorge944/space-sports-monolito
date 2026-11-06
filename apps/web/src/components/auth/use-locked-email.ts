'use client';

import { useGetStaffInvite } from '@space-sports/api-client';
import { inviteTokenFromNext } from '@/lib/auth/navigation';

/**
 * E-mail do convite de equipe, quando o login ou o cadastro vieram dele (`next=/convite/<token>`). O
 * aceite exige a conta com esse e-mail, então a tela o trava. Vem da prévia da API, não da URL. Com o
 * convite indisponível o formulário fica livre, e a página do convite explica o que houve.
 */
export function useLockedEmail(next: string | undefined) {
  const token = inviteTokenFromNext(next);
  const invite = useGetStaffInvite(token ?? '', { query: { enabled: !!token, retry: false } });
  return { email: invite.data?.email, loading: !!token && invite.isPending };
}
