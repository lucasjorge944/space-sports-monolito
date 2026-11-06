'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient, webUrl } from '@/lib/auth/client';
import { authErrorMessage, thrownErrorMessage } from '@/lib/auth/errors';
import { LOGIN_PATH } from '@/lib/auth/navigation';
import type { SocialProvider } from '@/lib/auth/providers';
import { FormError } from './form-alert';

const LABELS: Record<SocialProvider, string> = {
  google: 'Continuar com Google',
  apple: 'Continuar com Apple',
};

/** Botões de login social; só renderiza os provedores habilitados (`AUTH_PROVIDERS`). */
export function SocialButtons({
  providers,
  next,
}: {
  providers: SocialProvider[];
  next: string | undefined;
}) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string>();

  if (providers.length === 0) return null;

  async function start(provider: SocialProvider) {
    setError(undefined);
    setPending(provider);
    try {
      // Volta para o web já com a sessão; o `proxy.ts` leva ao `next` ou à área do perfil.
      const { error: authError } = await authClient.signIn.social({
        provider,
        callbackURL: webUrl(next ?? LOGIN_PATH),
        errorCallbackURL: webUrl(LOGIN_PATH),
      });
      if (authError) {
        setError(authErrorMessage(authError));
        setPending(null);
      }
    } catch (thrown) {
      setError(thrownErrorMessage(thrown));
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          size="xl"
          disabled={pending !== null}
          onClick={() => start(provider)}
        >
          {pending === provider ? 'Redirecionando…' : LABELS[provider]}
        </Button>
      ))}
      <div className="text-muted-foreground flex items-center gap-3 text-xs" aria-hidden="true">
        <span className="bg-border h-px flex-1" />
        ou
        <span className="bg-border h-px flex-1" />
      </div>
    </div>
  );
}
