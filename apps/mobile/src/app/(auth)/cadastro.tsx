import { maskPhone } from '@space-sports/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { Field, FormError } from '@/features/auth/components/field';
import { SocialButtons } from '@/features/auth/components/social-buttons';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorField, authErrorMessage } from '@/features/auth/errors';
import { useSession } from '@/features/auth/session';
import {
  MIN_PASSWORD_LENGTH,
  phoneToE164,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePhone,
} from '@/features/auth/validation';
import { AboutYouStep } from '@/features/profile/about-you-step';

/**
 * Cadastro em duas etapas (decisão 70): "Conta" (nome, e-mail, telefone e senha) e, com a conta já
 * criada, "Sobre você" (opcional, com "Pular"). A sessão só é validada no fim da segunda etapa: é aí
 * que as abas assumem e seguem o fluxo de sempre (verificar e-mail, localização, convite pendente).
 */
export default function CadastroScreen() {
  const router = useRouter();
  const { refresh } = useSession();
  const [step, setStep] = useState<'account' | 'about'>('account');

  if (step === 'about') {
    return (
      <AboutYouStep
        onFinish={async () => {
          await refresh();
          // A conta já nasce logada (decisão 19: e-mail não confirmado não bloqueia); a tela de
          // verificação abre por cima das abas, e a pessoa pode seguir sem confirmar.
          router.push('/verificar-email');
        }}
      />
    );
  }
  return <AccountStep onCreated={() => setStep('about')} />;
}

function AccountStep({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const { signUpWithEmail } = useAuthActions();
  const name = useFormField({ validate: validateName });
  const email = useFormField({ validate: validateEmail });
  const password = useFormField({ validate: validateNewPassword });
  // Decisão 64: obrigatório, sem verificação por SMS.
  const phone = useFormField({ validate: validatePhone, format: maskPhone });
  const mutation = useMutation({
    mutationFn: signUpWithEmail,
    onSuccess: onCreated,
    onError: (error) => {
      const field = authErrorField(error);
      if (field === 'email') email.setError(authErrorMessage(error));
      if (field === 'phone') phone.setError(authErrorMessage(error));
    },
  });

  const submit = () => {
    const e164 = phoneToE164(phone.value);
    if (validateFields([name, email, phone, password]) && e164) {
      mutation.mutate({
        name: name.value,
        email: email.value,
        password: password.value,
        phone: e164,
      });
    }
  };

  return (
    <AuthLayout title="Criar conta" subtitle="Leva menos de um minuto." testID="cadastro-titulo">
      <View className="gap-4">
        <FormError
          message={
            mutation.error && !authErrorField(mutation.error)
              ? authErrorMessage(mutation.error)
              : null
          }
        />
        <Field
          label="Nome"
          {...name.bind}
          testID="cadastro-nome"
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          editable={!mutation.isPending}
        />
        <Field
          label="E-mail"
          {...email.bind}
          testID="cadastro-email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!mutation.isPending}
        />
        <Field
          label="Telefone com DDD"
          {...phone.bind}
          testID="cadastro-telefone"
          placeholder="(31) 99999-8888"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          editable={!mutation.isPending}
        />
        <Field
          label="Senha"
          hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
          {...password.bind}
          testID="cadastro-senha"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={submit}
          editable={!mutation.isPending}
        />
        <Button
          testID="cadastro-criar"
          onPress={submit}
          disabled={mutation.isPending}
          accessibilityLabel="Criar conta"
        >
          <Text>{mutation.isPending ? 'Criando…' : 'Criar conta'}</Text>
        </Button>
      </View>

      <SocialButtons />

      <Button variant="ghost" onPress={() => router.back()}>
        <Text>Já tenho conta</Text>
      </Button>
    </AuthLayout>
  );
}
