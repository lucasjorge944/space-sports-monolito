'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient, webUrl } from '@/lib/auth/client';
import { authErrorMessage, thrownErrorMessage } from '@/lib/auth/errors';
import { LOGIN_PATH, verifiedEmailPath } from '@/lib/auth/navigation';
import { normalizeEmail, validateEmail } from '@/lib/auth/validation';
import { AuthCard } from './auth-card';
import { FormError, FormNotice } from './form-alert';
import { FormField } from './form-field';
import { SubmitButton } from './submit-button';

const RESEND_COOLDOWN_SECONDS = 30;

type VerifyEmailPanelProps = {
  /** `confirmado`: voltou do link do e-mail; `pendente`: acabou de se cadastrar. */
  state: 'confirmado' | 'pendente' | 'erro';
  email: string | undefined;
  next: string | undefined;
  /** Mensagem PT-BR do `?error=` do link (token inválido ou expirado). */
  linkError: string | undefined;
};

export function VerifyEmailPanel({ state, email, next, linkError }: VerifyEmailPanelProps) {
  const [typedEmail, setTypedEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const continueHref = next ?? LOGIN_PATH;

  if (state === 'confirmado') {
    return (
      <AuthCard title="E-mail confirmado" description="Pronto! Seu e-mail foi confirmado.">
        <Button asChild size="xl">
          <a href={continueHref}>Continuar</a>
        </Button>
      </AuthCard>
    );
  }

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = email ?? typedEmail;
    const invalid = validateEmail(target);
    setEmailError(invalid);
    setFormError(undefined);
    if (invalid) return;

    setPending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: normalizeEmail(target),
        callbackURL: webUrl(verifiedEmailPath(next)),
      });
      if (error) {
        setFormError(authErrorMessage(error));
      } else {
        setSent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (thrown) {
      setFormError(thrownErrorMessage(thrown));
    }
    setPending(false);
  }

  const title = state === 'erro' ? 'Não foi possível confirmar' : 'Confirme seu e-mail';
  const description =
    state === 'erro'
      ? (linkError ?? 'O link de confirmação não funcionou.')
      : email
        ? `Enviamos um link de confirmação para ${email}.`
        : 'Peça um novo link de confirmação.';

  return (
    <AuthCard title={title} description={description}>
      {sent ? <FormNotice>Link reenviado. Confira também a caixa de spam.</FormNotice> : null}
      <form onSubmit={resend} noValidate className="flex flex-col gap-4">
        <FormError message={formError} />
        {email ? null : (
          <FormField
            large
            name="email"
            label="E-mail"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={typedEmail}
            onChange={(event) => setTypedEmail(event.target.value)}
            error={emailError}
          />
        )}
        <SubmitButton
          size="xl"
          pending={pending}
          pendingLabel="Enviando…"
          variant="outline"
          disabled={pending || cooldown > 0}
        >
          {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar e-mail'}
        </SubmitButton>
      </form>
      {state === 'pendente' ? (
        <Button asChild size="xl">
          <a href={continueHref}>Continuar</a>
        </Button>
      ) : null}
    </AuthCard>
  );
}
