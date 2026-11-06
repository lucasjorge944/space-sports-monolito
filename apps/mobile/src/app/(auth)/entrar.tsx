import { useMutation } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { Field, FormError } from '@/features/auth/components/field';
import { SocialButtons } from '@/features/auth/components/social-buttons';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorMessage } from '@/features/auth/errors';
import { validateEmail, validateRequired } from '@/features/auth/validation';

export default function EntrarScreen() {
  const router = useRouter();
  const { signInWithEmail } = useAuthActions();
  const email = useFormField({ validate: validateEmail });
  const password = useFormField({
    validate: (value) => validateRequired(value, 'Informe sua senha'),
  });
  const mutation = useMutation({ mutationFn: signInWithEmail });

  const submit = () => {
    if (validateFields([email, password])) {
      mutation.mutate({ email: email.value, password: password.value });
    }
  };

  return (
    <AuthLayout
      testID="login-titulo"
      title="Bem-vindo ao Space Sports"
      subtitle="Encontre quadras, reserve horários e jogue com a galera."
    >
      <View className="gap-4">
        <FormError message={mutation.error ? authErrorMessage(mutation.error) : null} />
        <Field
          testID="login-email"
          label="E-mail"
          {...email.bind}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={password.focus}
          editable={!mutation.isPending}
        />
        <Field
          testID="login-senha"
          label="Senha"
          {...password.bind}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!mutation.isPending}
        />
        <Button
          testID="login-entrar"
          onPress={submit}
          disabled={mutation.isPending}
          accessibilityLabel="Entrar"
        >
          <Text>{mutation.isPending ? 'Entrando…' : 'Entrar'}</Text>
        </Button>
        <Link href="/esqueci-senha" asChild>
          <Button variant="ghost" size="sm">
            <Text>Esqueci minha senha</Text>
          </Button>
        </Link>
      </View>

      <SocialButtons />

      <View className="gap-2">
        <Button variant="ghost" testID="login-criar-conta" onPress={() => router.push('/cadastro')}>
          <Text>Criar conta</Text>
        </Button>
      </View>
    </AuthLayout>
  );
}
