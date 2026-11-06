import type { MeResponse } from '@space-sports/api-client';
import { maskPhone } from '@space-sports/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { Field, FormError } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorField, authErrorMessage } from '@/features/auth/errors';
import { useMe, useSession } from '@/features/auth/session';
import { phoneToE164, validateName, validatePhone } from '@/features/auth/validation';
import { isAboutYouEmpty } from '@/features/profile/about-you';
import { AboutYouStep } from '@/features/profile/about-you-step';

/**
 * Completar cadastro (decisão 66): a API diz em `profile.missing` o que falta (nome e/ou telefone),
 * como na conta antiga sem telefone e na conta nova pelo Google. A tela pede só isso; sem completar,
 * o app não segue (a guarda de rotas só libera esta tela), e "Sair" fica sempre à mão. Quem ainda
 * não respondeu nada do "Sobre você" (conta nova) passa por essa etapa depois, com "Pular".
 */
export default function CompletarPerfilScreen() {
  const me = useMe();
  const { refresh } = useSession();
  // Fixado na abertura: o /me só é relido no fim, então a decisão não muda no meio do fluxo.
  const [withAboutYou] = useState(() => isAboutYouEmpty(me));
  const [step, setStep] = useState<'required' | 'about'>('required');

  if (step === 'about') return <AboutYouStep onFinish={refresh} />;
  return (
    <RequiredStep
      me={me}
      onSaved={async () => {
        if (withAboutYou) setStep('about');
        else await refresh();
      }}
    />
  );
}

function subtitleFor(missing: MeResponse['profile']['missing']): string {
  const name = missing.includes('name');
  const phone = missing.includes('phone');
  if (name && phone) return 'Para continuar, informe seu nome e um telefone com DDD.';
  if (phone) return 'Para continuar, falta só um telefone com DDD.';
  return 'Seu nome aparece para o espaço e para os outros jogadores.';
}

function RequiredStep({ me, onSaved }: { me: MeResponse; onSaved: () => Promise<void> }) {
  const { updateProfile } = useAuthActions();
  const { signOut } = useSession();
  const missing = me.profile.missing;
  const askName = missing.includes('name');
  const askPhone = missing.includes('phone');
  const name = useFormField({ initial: me.name, validate: validateName });
  // Decisão 64: obrigatório, sem verificação por SMS.
  const phone = useFormField({ validate: validatePhone, format: maskPhone });
  const mutation = useMutation({
    mutationFn: async () => {
      await updateProfile({
        ...(askName ? { name: name.value.trim() } : {}),
        ...(askPhone ? { phone: phoneToE164(phone.value) ?? '' } : {}),
      });
      await onSaved();
    },
    onError: (error) => {
      if (authErrorField(error) === 'phone') phone.setError(authErrorMessage(error));
    },
  });

  const submit = () => {
    const fields = [...(askName ? [name] : []), ...(askPhone ? [phone] : [])];
    if (validateFields(fields)) mutation.mutate();
  };

  return (
    <AuthLayout
      title={askName ? 'Como podemos te chamar?' : 'Complete seu cadastro'}
      subtitle={subtitleFor(missing)}
      testID="completar-perfil-titulo"
    >
      <View className="gap-4">
        <FormError
          message={
            mutation.error && authErrorField(mutation.error) !== 'phone'
              ? authErrorMessage(mutation.error)
              : null
          }
        />
        {askName ? (
          <Field
            label="Nome"
            {...name.bind}
            testID="completar-perfil-nome"
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            onSubmitEditing={askPhone ? () => phone.focus() : submit}
            editable={!mutation.isPending}
          />
        ) : null}
        {askPhone ? (
          <Field
            label="Telefone com DDD"
            {...phone.bind}
            testID="completar-perfil-telefone"
            placeholder="(31) 99999-8888"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            onSubmitEditing={submit}
            editable={!mutation.isPending}
          />
        ) : null}
        <Button testID="completar-perfil-continuar" onPress={submit} disabled={mutation.isPending}>
          <Text>{mutation.isPending ? 'Salvando…' : 'Continuar'}</Text>
        </Button>
        <Button
          variant="ghost"
          testID="completar-perfil-sair"
          onPress={() => void signOut()}
          disabled={mutation.isPending}
        >
          <Text>Sair</Text>
        </Button>
      </View>
    </AuthLayout>
  );
}
