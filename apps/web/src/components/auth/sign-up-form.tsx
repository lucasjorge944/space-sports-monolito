'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PhoneField } from '@/components/account/phone-field';
import { phoneToE164, validatePhone } from '@/lib/account/profile';
import { signUpWithPhone, webUrl } from '@/lib/auth/client';
import { authErrorMessage, getAuthErrorCode, thrownErrorMessage } from '@/lib/auth/errors';
import { aboutYouPath, verifiedEmailPath } from '@/lib/auth/navigation';
import type { SocialProvider } from '@/lib/auth/providers';
import {
  collectErrors,
  type FieldErrors,
  normalizeEmail,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
} from '@/lib/auth/validation';
import { focusFirstInvalid, textLink } from '@/lib/utils';
import { AuthCard } from './auth-card';
import { EmailField } from './email-field';
import { FormError } from './form-alert';
import { FormField } from './form-field';
import { SocialButtons } from './social-buttons';
import { SubmitButton } from './submit-button';
import { useLockedEmail } from './use-locked-email';

type SignUpFormProps = { providers: SocialProvider[]; next: string | undefined };

type Field = 'name' | 'email' | 'phone' | 'password' | 'confirmPassword';

/**
 * Cadastro em duas etapas (decisão 70): "Conta" (nome, e-mail, telefone obrigatório e senha) e, com a
 * conta criada e a sessão aberta, "Sobre você" (opcional, com "Pular"). Depois segue para a
 * confirmação do e-mail, mantendo o `next` (convite de equipe, convite de reserva etc.).
 */
export function SignUpForm({ providers, next }: SignUpFormProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<Field>>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [phone, setPhone] = useState('');
  const invite = useLockedEmail(next);
  const withNext = next ? `?next=${encodeURIComponent(next)}` : '';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '');
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    const errors = collectErrors({
      name: validateName(name),
      email: validateEmail(email),
      phone: validatePhone(phone),
      password: validateNewPassword(password),
      confirmPassword: validatePasswordConfirmation(password, confirmPassword),
    });
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors) return focusFirstInvalid(event.currentTarget);

    setPending(true);
    try {
      const normalizedEmail = normalizeEmail(email);
      const { error } = await signUpWithPhone({
        name: name.trim(),
        email: normalizedEmail,
        password,
        // Decisão 64: obrigatório, em E.164, gravado sem verificação.
        phone: phoneToE164(phone) as string,
        // Link do e-mail de verificação: volta para o web (a API só aceita origens confiáveis).
        callbackURL: webUrl(verifiedEmailPath(next)),
      });
      if (error) {
        if (getAuthErrorCode(error) === 'INVALID_PHONE_NUMBER') {
          setFieldErrors({ phone: authErrorMessage(error) });
        } else {
          setFormError(authErrorMessage(error));
        }
        setPending(false);
        return;
      }
      // O cadastro já abre a sessão (a verificação de e-mail não bloqueia o login): segue para o
      // "Sobre você", em rota própria (recarregar não perde o passo), e depois para a confirmação
      // do e-mail, que leva o `next` adiante.
      const params = new URLSearchParams({ email: normalizedEmail });
      if (next) params.set('next', next);
      window.location.assign(aboutYouPath(`/verificar-email?${params}`));
    } catch (thrown) {
      setFormError(thrownErrorMessage(thrown));
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Criar conta"
      description={
        invite.email
          ? 'Crie a conta com o e-mail do convite.'
          : 'Cadastre-se para acessar o Space Sports.'
      }
      footer={
        <p>
          Já tem conta?{' '}
          <Link href={`/entrar${withNext}`} className={textLink}>
            Entrar
          </Link>
        </p>
      }
    >
      <SocialButtons providers={providers} next={next} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={formError} />
        <FormField large name="name" label="Nome" autoComplete="name" error={fieldErrors?.name} />
        <EmailField error={fieldErrors?.email} locked={invite.email} loading={invite.loading} />
        <PhoneField
          large
          value={phone}
          onValueChange={setPhone}
          error={fieldErrors?.phone}
          hint="Para o espaço falar com você. Não enviamos SMS."
        />
        <FormField
          large
          name="password"
          label="Senha"
          type="password"
          autoComplete="new-password"
          error={fieldErrors?.password}
        />
        <FormField
          large
          name="confirmPassword"
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          error={fieldErrors?.confirmPassword}
        />
        <SubmitButton size="xl" pending={pending} pendingLabel="Criando conta…">
          Criar conta
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
