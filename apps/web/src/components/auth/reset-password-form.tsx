'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';
import { authErrorMessage, thrownErrorMessage } from '@/lib/auth/errors';
import {
  collectErrors,
  type FieldErrors,
  validateNewPassword,
  validatePasswordConfirmation,
} from '@/lib/auth/validation';
import { focusFirstInvalid } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { FormError } from './form-alert';
import { FormField } from './form-field';
import { SubmitButton } from './submit-button';

type ResetPasswordFormProps = {
  token: string | undefined;
  /** Mensagem PT-BR quando o link veio com erro (token inválido ou expirado). */
  linkError: string | undefined;
};

export function ResetPasswordForm({ token, linkError }: ResetPasswordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'password' | 'confirmPassword'>>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  if (!token || linkError) {
    return (
      <AuthCard
        title="Link inválido"
        description={linkError ?? 'O link de redefinição está incompleto. Peça um novo.'}
      >
        <Button asChild size="xl">
          <Link href="/esqueci-senha">Pedir novo link</Link>
        </Button>
      </AuthCard>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    const errors = collectErrors({
      password: validateNewPassword(password),
      confirmPassword: validatePasswordConfirmation(password, confirmPassword),
    });
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors) return focusFirstInvalid(event.currentTarget);
    if (!token) return;

    setPending(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) {
        setFormError(authErrorMessage(error));
        setPending(false);
        return;
      }
      // A API encerra as outras sessões; a pessoa entra de novo com a senha nova.
      window.location.assign('/entrar?senha=redefinida');
    } catch (thrown) {
      setFormError(thrownErrorMessage(thrown));
      setPending(false);
    }
  }

  return (
    <AuthCard title="Nova senha" description="Escolha a nova senha da sua conta.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={formError} />
        <FormField
          large
          name="password"
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          error={fieldErrors?.password}
        />
        <FormField
          large
          name="confirmPassword"
          label="Confirmar nova senha"
          type="password"
          autoComplete="new-password"
          error={fieldErrors?.confirmPassword}
        />
        <SubmitButton size="xl" pending={pending} pendingLabel="Salvando…">
          Redefinir senha
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
