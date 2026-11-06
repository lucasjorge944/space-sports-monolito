import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { Field, FormError } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorMessage } from '@/features/auth/errors';
import { validateNewPassword } from '@/features/auth/validation';

/**
 * Destino do link do e-mail de redefinição (`spacesports://redefinir-senha?token=...`; com
 * `?error=INVALID_TOKEN` quando o link venceu ou já foi usado). Fica fora da guarda de sessão,
 * porque o link pode ser aberto logado ou não.
 */
export default function RedefinirSenhaScreen() {
  const router = useRouter();
  const { token, error: linkError } = useLocalSearchParams<{ token?: string; error?: string }>();
  const { resetPassword } = useAuthActions();
  const password = useFormField({ validate: validateNewPassword });
  const mutation = useMutation({ mutationFn: resetPassword });
  const goToLogin = () => router.replace('/');

  if (!token || linkError) {
    return (
      <AuthLayout
        title="Link inválido"
        subtitle="O link para redefinir a senha é inválido ou expirou. Peça um novo."
      >
        <Button onPress={() => router.replace('/esqueci-senha')}>
          <Text>Pedir novo link</Text>
        </Button>
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout title="Senha alterada" subtitle="Entre com a nova senha.">
        <Button onPress={goToLogin}>
          <Text>Continuar</Text>
        </Button>
      </AuthLayout>
    );
  }

  const submit = () => {
    if (validateFields([password])) mutation.mutate({ token, newPassword: password.value });
  };

  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma senha com pelo menos 8 caracteres.">
      <View className="gap-4">
        <FormError message={mutation.error ? authErrorMessage(mutation.error) : null} />
        <Field
          label="Nova senha"
          {...password.bind}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={submit}
          editable={!mutation.isPending}
        />
        <Button onPress={submit} disabled={mutation.isPending}>
          <Text>{mutation.isPending ? 'Salvando…' : 'Redefinir senha'}</Text>
        </Button>
      </View>
    </AuthLayout>
  );
}
