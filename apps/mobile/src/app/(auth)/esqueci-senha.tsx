import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { Field, FormError } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorMessage } from '@/features/auth/errors';
import { validateEmail } from '@/features/auth/validation';

export default function EsqueciSenhaScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuthActions();
  const email = useFormField({ validate: validateEmail });
  const mutation = useMutation({ mutationFn: requestPasswordReset });

  const submit = () => {
    if (validateFields([email])) mutation.mutate(email.value);
  };

  if (mutation.isSuccess) {
    return (
      <AuthLayout
        title="Verifique seu e-mail"
        subtitle={`Se existir uma conta para ${email.value.trim()}, enviamos um link para redefinir a senha. Abra-o neste aparelho.`}
      >
        <Button onPress={() => router.back()}>
          <Text>Voltar para entrar</Text>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Esqueci minha senha"
      subtitle="Enviaremos um link para criar uma nova senha."
    >
      <View className="gap-4">
        <FormError message={mutation.error ? authErrorMessage(mutation.error) : null} />
        <Field
          label="E-mail"
          {...email.bind}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          onSubmitEditing={submit}
          editable={!mutation.isPending}
        />
        <Button onPress={submit} disabled={mutation.isPending}>
          <Text>{mutation.isPending ? 'Enviando…' : 'Enviar link'}</Text>
        </Button>
      </View>
    </AuthLayout>
  );
}
