'use client';

import {
  isApiError,
  useAcceptStaffInvite,
  useGetMe,
  useGetStaffInvite,
} from '@space-sports/api-client';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormError } from '@/components/auth/form-alert';
import { storeId } from '@/components/shell/selected-space';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { signOut } from '@/lib/auth/sign-out';
import { formatDateTime } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { ROLE_LABEL } from '@/lib/painel/labels';

/** Aceite do convite de equipe (RN-AUTH-01/03; RF-NOTIF-02): prévia pública + aceite com a conta logada. */
export function AcceptInvite({ token }: { token: string }) {
  const nextPath = `/convite/${token}`;
  const next = encodeURIComponent(nextPath);
  const preview = useGetStaffInvite(token, { query: { retry: false } });
  // Sem redirecionar para o login (o `useMe` do painel faria isso): aqui a pessoa decide entre entrar e criar conta.
  const me = useGetMe({ query: { retry: false } });
  const accept = useAcceptStaffInvite();
  const [switching, setSwitching] = useState(false);

  if (preview.isPending) {
    return (
      <AuthCard title="Convite para a equipe">
        <div role="status" aria-label="Carregando convite" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  }

  if (preview.isError) {
    const code = isApiError(preview.error) ? preview.error.code : '';
    const unreachable = !isApiError(preview.error) || preview.error.status >= 500;
    return (
      <AuthCard
        title="Convite indisponível"
        description={
          unreachable
            ? apiErrorMessage(preview.error)
            : code === 'STAFF_INVITE_NOT_FOUND'
              ? 'Este link de convite não existe. Confira se copiou o link inteiro.'
              : apiErrorMessage(preview.error)
        }
      >
        {unreachable ? (
          <Button size="xl" onClick={() => void preview.refetch()}>
            Tentar novamente
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">Peça ao espaço para reenviar o convite.</p>
        )}
      </AuthCard>
    );
  }

  const invite = preview.data;
  const loggedIn = me.isSuccess;
  const sameEmail =
    loggedIn && me.data.email != null && me.data.email.toLowerCase() === invite.email.toLowerCase();
  // A conta do convite: entra se já existe, cria se não. O e-mail fica travado nas duas telas.
  const signInPath = `${invite.hasAccount ? '/entrar' : '/cadastro'}?next=${next}`;

  return (
    <AuthCard
      title="Convite para a equipe"
      description={
        <>
          Você foi convidado para o espaço <strong>{invite.space.name}</strong> como{' '}
          <strong>{ROLE_LABEL[invite.role]}</strong>.
        </>
      }
    >
      <p className="text-muted-foreground text-sm">
        Convite enviado para <strong className="text-foreground">{invite.email}</strong>, válido até{' '}
        {formatDateTime(invite.expiresAt)}.
      </p>

      {me.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : loggedIn && !sameEmail ? (
        <>
          <Alert variant="warning" role="status">
            Você está com a conta {me.data.email ?? 'sem e-mail'}, mas o convite é para{' '}
            {invite.email}. Para aceitar, troque para a conta do convite.
          </Alert>
          <Button
            size="xl"
            disabled={switching}
            onClick={() => {
              setSwitching(true);
              // Sai antes de ir ao login: com a sessão aberta, o `proxy.ts` tira a pessoa de lá.
              void signOut(signInPath);
            }}
          >
            {switching ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Trocar de conta
          </Button>
        </>
      ) : loggedIn ? (
        <>
          {accept.error ? <FormError message={apiErrorMessage(accept.error)} /> : null}
          <Button
            size="xl"
            disabled={accept.isPending}
            onClick={() =>
              accept.mutate(
                { token },
                {
                  onSuccess: () => {
                    storeId(invite.space.id);
                    // Navegação completa: recarrega o `/v1/me` com o novo vínculo.
                    window.location.assign('/painel');
                  },
                },
              )
            }
          >
            {accept.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Aceitar convite
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {invite.hasAccount
              ? 'Já existe uma conta com este e-mail. Entre para aceitar o convite.'
              : 'Crie uma conta com este e-mail para aceitar o convite.'}
          </p>
          <Button asChild size="xl">
            <Link href={signInPath}>{invite.hasAccount ? 'Entrar' : 'Criar conta'}</Link>
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
