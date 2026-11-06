'use client';

import { getGetMeQueryKey, isApiError, useUpdateMyProfile } from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormError } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { SubmitButton } from '@/components/auth/submit-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { aboutIsEmpty, phoneToE164, validatePhone } from '@/lib/account/profile';
import { aboutYouPath, destinationFor } from '@/lib/auth/navigation';
import { useMe } from '@/lib/auth/use-me';
import { collectErrors, type FieldErrors, validateName } from '@/lib/auth/validation';
import { apiErrorMessage } from '@/lib/painel/errors';
import { focusFirstInvalid } from '@/lib/utils';
import { PhoneField } from './phone-field';

/**
 * Completar cadastro (decisão 66): conta sem nome ou telefone (conta antiga, login com Google) não
 * usa o `/painel` nem o `/super` antes de informar o que falta. O `proxy.ts` traz para cá; a tela pede
 * só os campos de `profile.missing`. Quem não tem nada de "Sobre você" (conta do Google ou antiga)
 * segue uma vez para essa etapa (`/cadastro/sobre-voce`), com "Pular"; depois, o `next` ou a área.
 */
export function CompleteProfile({ next }: { next: string | undefined }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const update = useUpdateMyProfile();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'name' | 'phone'>>();

  if (me.isPending) {
    return (
      <AuthCard title="Complete seu cadastro">
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </AuthCard>
    );
  }
  if (me.isError) {
    return (
      <AuthCard title="Complete seu cadastro">
        <FormError message={apiErrorMessage(me.error)} />
        <Button variant="outline" size="xl" onClick={() => void me.refetch()}>
          Tentar de novo
        </Button>
        <SignOutButton />
      </AuthCard>
    );
  }

  const missing = me.data.profile.missing;
  if (missing.length === 0 && !update.isSuccess) {
    return (
      <AuthCard title="Cadastro completo" description="Seu cadastro já está em dia.">
        <Button asChild size="xl">
          <a href={next ?? destinationFor(me.data)}>Continuar</a>
        </Button>
      </AuthCard>
    );
  }

  const askName = missing.includes('name');
  const askPhone = missing.includes('phone');

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = collectErrors({
      name: askName ? validateName(name) : undefined,
      phone: askPhone ? validatePhone(phone) : undefined,
    });
    setFieldErrors(errors);
    if (errors) return focusFirstInvalid(event.currentTarget);
    update.mutate(
      {
        data: {
          ...(askName ? { name: name.trim() } : {}),
          ...(askPhone ? { phone: phoneToE164(phone) as string } : {}),
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetMeQueryKey(), updated);
          const target = next ?? destinationFor(updated);
          // Quem ainda não preencheu nada de "Sobre você" (conta do Google ou antiga) passa uma vez
          // por essa etapa, opcional e com "Pular" (decisões 66 e 70).
          window.location.assign(aboutIsEmpty(updated) ? aboutYouPath(target) : target);
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'INVALID_PHONE_NUMBER') {
            setFieldErrors({ phone: apiErrorMessage(error) });
          }
        },
      },
    );
  }

  const phoneError = isApiError(update.error) && update.error.code === 'INVALID_PHONE_NUMBER';
  const leaving = update.isSuccess;
  return (
    <AuthCard
      title="Complete seu cadastro"
      description={
        askName && askPhone
          ? 'Antes de continuar, informe seu nome e telefone.'
          : askName
            ? 'Antes de continuar, informe seu nome.'
            : 'Antes de continuar, informe seu telefone.'
      }
      footer={
        <p>
          Entrou como <span className="text-foreground font-medium">{me.data.email}</span>.
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError
          message={update.error && !phoneError ? apiErrorMessage(update.error) : undefined}
        />
        {askName ? (
          <FormField
            large
            name="name"
            label="Nome"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors?.name}
          />
        ) : null}
        {askPhone ? (
          <PhoneField
            large
            value={phone}
            onValueChange={setPhone}
            error={fieldErrors?.phone}
            hint="Para os espaços falarem com você. Não enviamos SMS."
          />
        ) : null}
        <div className="flex flex-col gap-2">
          <SubmitButton size="xl" pending={update.isPending || leaving} pendingLabel="Salvando…">
            Continuar
          </SubmitButton>
          <SignOutButton />
        </div>
      </form>
    </AuthCard>
  );
}
