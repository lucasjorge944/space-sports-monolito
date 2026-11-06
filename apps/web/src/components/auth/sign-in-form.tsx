'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { authErrorMessage, thrownErrorMessage } from '@/lib/auth/errors';
import { LOGIN_PATH } from '@/lib/auth/navigation';
import type { SocialProvider } from '@/lib/auth/providers';
import {
  collectErrors,
  type FieldErrors,
  normalizeEmail,
  validateEmail,
  validateRequiredPassword,
} from '@/lib/auth/validation';
import { cn, focusFirstInvalid, textLink } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { EmailField } from './email-field';
import { FormError, FormNotice } from './form-alert';
import { FormField } from './form-field';
import { SocialButtons } from './social-buttons';
import { SubmitButton } from './submit-button';
import { useLockedEmail } from './use-locked-email';

type SignInFormProps = {
  providers: SocialProvider[];
  next: string | undefined;
  /** Erro vindo da URL (`?error=`), já traduzido. */
  initialError?: string | undefined;
  /** Aviso vindo da URL (ex.: senha redefinida). */
  notice?: string | undefined;
};

export function SignInForm({ providers, next, initialError, notice }: SignInFormProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email' | 'password'>>();
  const [formError, setFormError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const invite = useLockedEmail(next);
  const withNext = next ? `?next=${encodeURIComponent(next)}` : '';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const errors = collectErrors({
      email: validateEmail(email),
      password: validateRequiredPassword(password),
    });
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors) return focusFirstInvalid(event.currentTarget);

    setPending(true);
    try {
      const { error } = await authClient.signIn.email({ email: normalizeEmail(email), password });
      if (error) {
        setFormError(authErrorMessage(error));
        setPending(false);
        return;
      }
      // Navegação completa: o `proxy.ts` decide o destino pelo perfil quando não há `next`.
      window.location.assign(next ?? LOGIN_PATH);
    } catch (thrown) {
      setFormError(thrownErrorMessage(thrown));
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Entrar"
      description={invite.email ? 'Entre com a conta do convite.' : 'Use a conta do Space Sports.'}
      footer={
        <p>
          Ainda não tem conta?{' '}
          <Link href={`/cadastro${withNext}`} className={textLink}>
            Criar conta
          </Link>
        </p>
      }
    >
      {notice ? <FormNotice>{notice}</FormNotice> : null}
      <SocialButtons providers={providers} next={next} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={formError} />
        <EmailField error={fieldErrors?.email} locked={invite.email} loading={invite.loading} />
        <FormField
          large
          name="password"
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={fieldErrors?.password}
        />
        <Link href="/esqueci-senha" className={cn(textLink, '-mt-2 self-end text-sm')}>
          Esqueci minha senha
        </Link>
        <SubmitButton size="xl" pending={pending} pendingLabel="Entrando…">
          Entrar
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
