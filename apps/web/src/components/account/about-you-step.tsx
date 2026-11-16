'use client';

import { getGetMeQueryKey, useUpdateMyProfile } from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { FormError } from '@/components/auth/form-alert';
import { SubmitButton } from '@/components/auth/submit-button';
import { Button } from '@/components/ui/button';
import {
  type AboutDraft,
  aboutPayload,
  EMPTY_ABOUT,
  validateBirthDate,
} from '@/lib/account/profile';
import { destinationFor } from '@/lib/auth/navigation';
import { useMe } from '@/lib/auth/use-me';
import { apiErrorMessage } from '@/lib/painel/errors';
import { type AboutErrors, AboutFields } from './about-fields';

/**
 * Etapa "Sobre você" (decisão 70) em `/cadastro/sobre-voce`: nascimento, gênero e esportes, tudo
 * opcional, com "Pular" e sem cobrança depois. Vem logo após criar a conta (cadastro) e após o
 * completar cadastro de quem ainda não preencheu nada disso (Google, conta antiga). Ao salvar ou
 * pular, segue para `next` (no cadastro, a confirmação do e-mail com o convite) ou a área do perfil.
 */
export function AboutYouStep({ next }: { next: string | undefined }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const update = useUpdateMyProfile();
  const [draft, setDraft] = useState<AboutDraft>(EMPTY_ABOUT);
  const [errors, setErrors] = useState<AboutErrors>();
  const [leaving, setLeaving] = useState(false);

  // Sem `next` nem `/v1/me`, o `/painel`: o `proxy.ts` leva cada perfil à sua área.
  const target = next ?? (me.data ? destinationFor(me.data) : '/painel');

  function finish() {
    setLeaving(true);
    window.location.assign(target);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const birthDate = validateBirthDate(draft.birthDate);
    setErrors(birthDate ? { birthDate } : undefined);
    if (birthDate) return;
    update.mutate(
      { data: aboutPayload(draft) },
      {
        onSuccess: (me) => {
          queryClient.setQueryData(getGetMeQueryKey(), me);
          finish();
        },
      },
    );
  }

  const busy = update.isPending || leaving;
  return (
    <AuthCard
      title="Sobre você"
      description="Conte um pouco sobre você. É opcional: dá para preencher depois em Meu perfil."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={update.error ? apiErrorMessage(update.error) : undefined} />
        <AboutFields value={draft} onChange={setDraft} errors={errors} />
        <div className="flex flex-col gap-2">
          <SubmitButton size="xl" pending={busy} pendingLabel="Salvando…">
            Salvar e continuar
          </SubmitButton>
          {/* Link, não botão: "Pular" só navega e precisa funcionar também antes da hidratação (a
              página já aparece, mas o clique vindo cedo demais se perderia). */}
          <Button asChild variant="ghost" size="xl">
            <a
              href={target}
              aria-disabled={busy || undefined}
              tabIndex={busy ? -1 : undefined}
              className={busy ? 'pointer-events-none opacity-50' : undefined}
              onClick={(event) => {
                if (busy) return event.preventDefault();
                setLeaving(true);
              }}
            >
              Pular
            </a>
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
