'use client';

import {
  getGetMeQueryKey,
  isApiError,
  type MeResponseDto,
  useUpdateMyProfile,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { SubmitButton } from '@/components/auth/submit-button';
import { ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ProfileForm,
  phoneToE164,
  profileChanges,
  profileFormOf,
  validateBirthDate,
  validatePhone,
} from '@/lib/account/profile';
import { useMe } from '@/lib/auth/use-me';
import { collectErrors, type FieldErrors, validateName } from '@/lib/auth/validation';
import { apiErrorMessage } from '@/lib/painel/errors';
import { focusFirstInvalid } from '@/lib/utils';
import { AboutFields } from './about-fields';
import { EmailCard, PasswordCard } from './account-security';
import { AvatarCard } from './avatar-card';
import { PhoneField } from './phone-field';

/**
 * Meu perfil (RF-AUTH-02, decisão 67), o mesmo no `/painel/perfil` e no `/super/perfil`: foto, nome,
 * telefone, e-mail (só leitura), nascimento, gênero, esportes favoritos e senha.
 */
export function ProfileView() {
  const me = useMe();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Meu perfil"
        description="Seus dados no Space Sports, no app e no painel."
      />
      {me.isPending ? (
        <LoadingBlock rows={6} label="Carregando o perfil" />
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <>
          <AvatarCard me={me.data} />
          <PersonalCard me={me.data} />
          <EmailCard me={me.data} />
          <PasswordCard />
        </>
      )}
    </div>
  );
}

type PersonalField = 'name' | 'phone' | 'birthDate';

function PersonalCard({ me }: { me: MeResponseDto }) {
  const queryClient = useQueryClient();
  const update = useUpdateMyProfile();
  const [form, setForm] = useState<ProfileForm>(() => profileFormOf(me));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<PersonalField>>();
  const changes = profileChanges(me, form);
  const dirty = Object.keys(changes).length > 0 || form.phone !== profileFormOf(me).phone;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = collectErrors({
      name: validateName(form.name),
      phone: validatePhone(form.phone),
      birthDate: validateBirthDate(form.birthDate),
    });
    setFieldErrors(errors);
    if (errors) return focusFirstInvalid(event.currentTarget);
    if (Object.keys(changes).length === 0) return;
    update.mutate(
      { data: changes },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetMeQueryKey(), updated);
          setForm(profileFormOf(updated));
          toast.success('Perfil atualizado.');
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados pessoais</CardTitle>
        <CardDescription>
          Nome e telefone são obrigatórios. Nascimento, gênero e esportes são opcionais.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError
            message={update.error && !phoneError ? apiErrorMessage(update.error) : undefined}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              name="name"
              label="Nome"
              autoComplete="name"
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              error={fieldErrors?.name}
            />
            <PhoneField
              id="profile-phone"
              value={form.phone}
              onValueChange={(phone) => setForm({ ...form, phone })}
              error={fieldErrors?.phone}
              hint={
                me.phoneVerified && phoneToE164(form.phone) === me.phone
                  ? 'Telefone verificado.'
                  : 'Não verificado: não enviamos SMS. Os espaços usam para falar com você.'
              }
            />
          </div>
          <AboutFields
            idPrefix="profile"
            savedSports={me.favoriteSports.map((favorite) => favorite.sport)}
            value={form}
            onChange={(about) => setForm({ ...form, ...about })}
            errors={fieldErrors?.birthDate ? { birthDate: fieldErrors.birthDate } : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              pending={update.isPending}
              pendingLabel="Salvando…"
              disabled={!dirty || update.isPending}
            >
              Salvar alterações
            </SubmitButton>
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                disabled={update.isPending}
                onClick={() => {
                  setForm(profileFormOf(me));
                  setFieldErrors(undefined);
                  update.reset();
                }}
              >
                Descartar
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
