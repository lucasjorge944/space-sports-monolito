'use client';

import { useGetMe } from '@space-sports/api-client';
import { useEffect, useState } from 'react';
import { LoadingBlock } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';
import { thrownErrorMessage } from '@/lib/auth/errors';
import { completeProfilePath, needsProfileCompletion } from '@/lib/auth/navigation';
import { isConsentRequestGone, oauthLoginPath, redirectTarget } from '@/lib/auth/oauth';
import type { SocialProvider } from '@/lib/auth/providers';
import { signOut } from '@/lib/auth/sign-out';
import { AuthCard } from './auth-card';
import { FormError } from './form-alert';
import { SignInForm } from './sign-in-form';

export const OAUTH_GONE_MESSAGE =
  'Este pedido de conexão venceu ou não é mais válido. Volte ao assistente e tente conectar de novo.';

/**
 * `/entrar` vindo do authorize do MCP (docs/14-mcp.md 3.5): sem sessão, o login normal (que volta ao
 * fluxo); com sessão no web, "Continuar como …" (`POST /oauth2/continue`) ou trocar de conta.
 * Qualquer perfil serve, inclusive jogador sem vínculo com espaço.
 */
export function OAuthEntry({
  providers,
  oauthQuery,
  initialError,
}: {
  providers: SocialProvider[];
  oauthQuery: string;
  initialError?: string | undefined;
}) {
  const me = useGetMe();
  // Cadastro incompleto (decisão 66): completa e volta a este `/entrar` com a mesma query.
  const incomplete = me.data ? needsProfileCompletion(me.data) : false;
  useEffect(() => {
    if (incomplete) window.location.assign(completeProfilePath(oauthLoginPath(oauthQuery)));
  }, [incomplete, oauthQuery]);
  if (me.isPending || incomplete) {
    return (
      <AuthCard title="Entrar">
        <LoadingBlock rows={2} label="Verificando a sessão" />
      </AuthCard>
    );
  }
  if (!me.data) {
    return (
      <SignInForm
        providers={providers}
        next={undefined}
        oauthQuery={oauthQuery}
        initialError={initialError}
      />
    );
  }
  return (
    <ContinueAs
      name={me.data.name}
      email={me.data.email}
      oauthQuery={oauthQuery}
      initialError={initialError}
    />
  );
}

function ContinueAs({
  name,
  email,
  oauthQuery,
  initialError,
}: {
  name: string;
  email: string | null;
  oauthQuery: string;
  initialError?: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError);
  const firstName = name.trim().split(/\s+/)[0] || name;

  async function proceed() {
    setPending(true);
    setError(undefined);
    try {
      const { data, error: failure } = await authClient.$fetch<unknown>('/oauth2/continue', {
        method: 'POST',
        body: { selected: true },
      });
      const target = redirectTarget(data);
      if (failure || !target) {
        setError(
          isConsentRequestGone(failure)
            ? OAUTH_GONE_MESSAGE
            : 'Não foi possível continuar. Tente novamente.',
        );
        setPending(false);
        return;
      }
      window.location.assign(target);
    } catch (thrown) {
      setError(thrownErrorMessage(thrown));
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Conectar ao Space Sports"
      description="Você já está com a sessão aberta neste navegador."
    >
      <FormError message={error} />
      <div className="bg-muted/50 rounded-lg border px-4 py-3 text-sm" data-testid="oauth-account">
        <p className="font-medium break-words">{name}</p>
        {email ? <p className="text-muted-foreground break-all">{email}</p> : null}
      </div>
      <Button size="xl" disabled={pending} onClick={() => void proceed()}>
        {pending ? 'Continuando…' : `Continuar como ${firstName}`}
      </Button>
      <Button
        variant="outline"
        size="xl"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void signOut(oauthLoginPath(oauthQuery));
        }}
      >
        Usar outra conta
      </Button>
    </AuthCard>
  );
}
