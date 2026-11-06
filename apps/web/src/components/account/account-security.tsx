'use client';

import { type MeResponseDto, useListUserAccounts } from '@space-sports/api-client';
import { BadgeCheck, CircleAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormNotice } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { ErrorState, LoadingBlock } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient, webUrl } from '@/lib/auth/client';
import { authErrorMessage, getAuthErrorCode, thrownErrorMessage } from '@/lib/auth/errors';
import { verifiedEmailPath } from '@/lib/auth/navigation';
import {
  collectErrors,
  type FieldErrors,
  validateNewPassword,
  validatePasswordConfirmation,
  validateRequiredPassword,
} from '@/lib/auth/validation';
import { focusFirstInvalid } from '@/lib/utils';

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', apple: 'Apple' };

/** E-mail só leitura (decisão 67), com o selo de verificação e o reenvio do link. */
export function EmailCard({ me }: { me: MeResponseDto }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  async function resend() {
    if (!me.email) return;
    setPending(true);
    setError(undefined);
    try {
      const { error: authError } = await authClient.sendVerificationEmail({
        email: me.email,
        callbackURL: webUrl(verifiedEmailPath(pathname)),
      });
      if (authError) setError(authErrorMessage(authError));
      else setSent(true);
    } catch (thrown) {
      setError(thrownErrorMessage(thrown));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-mail</CardTitle>
        <CardDescription>É o seu login. Para trocar o e-mail, fale com o suporte.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all" data-testid="profile-email">
            {me.email ?? 'Sem e-mail'}
          </span>
          {me.email ? (
            me.emailVerified ? (
              <Badge variant="success">
                <BadgeCheck aria-hidden />
                Verificado
              </Badge>
            ) : (
              <Badge variant="warning">
                <CircleAlert aria-hidden />
                Não verificado
              </Badge>
            )
          ) : null}
        </div>
        <FormError message={error} />
        {sent ? (
          <FormNotice>
            Enviamos um novo link para {me.email}. Abra o e-mail para confirmar.
          </FormNotice>
        ) : null}
        {me.email && !me.emailVerified && !sent ? (
          <Button
            variant="outline"
            className="w-fit"
            disabled={pending}
            onClick={() => void resend()}
          >
            {pending ? 'Enviando…' : 'Reenviar verificação'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmPassword';

/**
 * Alterar senha (Better Auth `changePassword`), que encerra as outras sessões. Conta só com login
 * social (Google) não tem senha: a tela explica que o acesso é pelo provedor.
 */
export function PasswordCard() {
  const accounts = useListUserAccounts();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<PasswordField>>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    const errors = collectErrors({
      currentPassword: validateRequiredPassword(currentPassword),
      newPassword: validateNewPassword(newPassword),
      confirmPassword: validatePasswordConfirmation(newPassword, confirmPassword),
    });
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors) return focusFirstInvalid(formElement);

    setPending(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        if (getAuthErrorCode(error) === 'INVALID_PASSWORD') {
          setFieldErrors({ currentPassword: 'Senha atual incorreta' });
        } else {
          setFormError(authErrorMessage(error));
        }
        return;
      }
      formElement.reset();
      toast.success('Senha alterada. As outras sessões foram encerradas.');
    } catch (thrown) {
      setFormError(thrownErrorMessage(thrown));
    } finally {
      setPending(false);
    }
  }

  const social = (accounts.data ?? [])
    .map((account) => account.providerId)
    .filter((provider) => provider !== 'credential');
  const hasPassword = accounts.data?.some((account) => account.providerId === 'credential');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Senha</CardTitle>
        <CardDescription>
          {hasPassword === false
            ? 'Sua conta não tem senha.'
            : 'Ao trocar a senha, as outras sessões abertas são encerradas.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.isPending ? (
          <LoadingBlock rows={2} />
        ) : accounts.isError ? (
          <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
        ) : hasPassword ? (
          <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
            <FormError message={formError} />
            <FormField
              name="currentPassword"
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              error={fieldErrors?.currentPassword}
            />
            <FormField
              name="newPassword"
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              hint="Pelo menos 8 caracteres."
              error={fieldErrors?.newPassword}
            />
            <FormField
              name="confirmPassword"
              label="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              error={fieldErrors?.confirmPassword}
            />
            <SubmitButton className="w-fit" pending={pending} pendingLabel="Alterando…">
              Alterar senha
            </SubmitButton>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm" data-testid="social-only">
            Você entra com{' '}
            {social.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(' ou ') ||
              'um provedor externo'}
            . A senha é cuidada pela sua conta {PROVIDER_LABELS[social[0] ?? ''] ?? 'do provedor'}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
