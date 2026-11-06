'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient, webUrl } from '@/lib/auth/client';
import { authErrorMessage, thrownErrorMessage } from '@/lib/auth/errors';
import {
  collectErrors,
  type FieldErrors,
  normalizeEmail,
  validateEmail,
} from '@/lib/auth/validation';
import { focusFirstInvalid, textLink } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { FormError, FormNotice } from './form-alert';
import { FormField } from './form-field';
import { SubmitButton } from './submit-button';

export function ForgotPasswordForm() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email'>>();
  const [formError, setFormError] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const errors = collectErrors({ email: validateEmail(email) });
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors) return focusFirstInvalid(event.currentTarget);

    setPending(true);
    try {
      const { error } = await authClient.requestPasswordReset({
        email: normalizeEmail(email),
        // O link do e-mail termina aqui, com `?token=` (ou `?error=` se o token for inválido).
        redirectTo: webUrl('/redefinir-senha'),
      });
      if (error) setFormError(authErrorMessage(error));
      else setSentTo(normalizeEmail(email));
    } catch (thrown) {
      setFormError(thrownErrorMessage(thrown));
    }
    setPending(false);
  }

  return (
    <AuthCard
      title="Esqueci minha senha"
      description="Informe seu e-mail para receber o link de redefinição."
      footer={
        <Link href="/entrar" className={textLink}>
          Voltar para entrar
        </Link>
      }
    >
      {sentTo ? (
        <FormNotice>
          Se existir uma conta para <strong>{sentTo}</strong>, enviamos um link para redefinir a
          senha. Ele vale por 1 hora.
        </FormNotice>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={formError} />
        <FormField
          large
          name="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={fieldErrors?.email}
        />
        <SubmitButton size="xl" pending={pending} pendingLabel="Enviando…">
          {sentTo ? 'Enviar novamente' : 'Enviar link'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
