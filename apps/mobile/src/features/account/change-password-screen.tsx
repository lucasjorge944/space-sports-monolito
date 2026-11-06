import { changePassword, useListUserAccounts } from '@space-sports/api-client';
import { useMutation } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { ErrorView, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Field, FormError } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { authErrorCode, authErrorMessage } from '@/features/auth/errors';
import { setSessionToken } from '@/features/auth/token-storage';
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '@/features/auth/validation';

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', apple: 'Apple' };

/**
 * Alterar senha (RF-AUTH-02, decisão 67), como no web: Better Auth `changePassword`, encerrando as
 * outras sessões. Conta só com login social (sem credencial `credential` em `listUserAccounts`)
 * não tem senha: a tela explica que o acesso é pelo provedor, sem opção de definir uma.
 */
export function ChangePasswordScreen() {
  const accounts = useListUserAccounts();
  const hasPassword = accounts.data?.some((account) => account.providerId === 'credential');
  const social = (accounts.data ?? [])
    .map((account) => account.providerId)
    .filter((provider) => provider !== 'credential');

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Alterar senha" testID="alterar-senha-titulo" />
      {accounts.isPending ? (
        <LoadingView />
      ) : accounts.isError ? (
        <ErrorView error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : hasPassword ? (
        <PasswordForm />
      ) : (
        <View className="gap-2 p-4" testID="alterar-senha-social">
          <Text variant="large">Sua conta não tem senha</Text>
          <Text variant="muted">
            Você entra com{' '}
            {social.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(' ou ') ||
              'um provedor externo'}
            . A senha é cuidada pela sua conta {PROVIDER_LABELS[social[0] ?? ''] ?? 'do provedor'}.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function PasswordForm() {
  const current = useFormField({ validate: (v) => (v ? null : 'Informe sua senha atual') });
  const next = useFormField({ validate: validateNewPassword });
  const confirm = useFormField({
    validate: (v) => (v === next.value ? null : 'As senhas não conferem'),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await changePassword({
        currentPassword: current.value,
        newPassword: next.value,
        revokeOtherSessions: true,
      });
      // As sessões antigas (inclusive a deste aparelho) foram encerradas: a API abre uma nova. O
      // token também vem no header `set-auth-token`, que o cliente já guarda.
      if (result.token) await setSessionToken(result.token);
    },
    onSuccess: () => {
      for (const field of [current, next, confirm]) field.setValue('');
    },
    onError: (error) => {
      if (authErrorCode(error) === 'INVALID_PASSWORD') {
        current.setError('Senha atual incorreta');
        current.focus();
      }
    },
  });
  const wrongCurrent = authErrorCode(mutation.error) === 'INVALID_PASSWORD';

  const submit = () => {
    mutation.reset();
    if (validateFields([current, next, confirm])) mutation.mutate();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
        <Text variant="muted">Ao trocar a senha, as outras sessões abertas são encerradas.</Text>
        <FormError
          message={mutation.error && !wrongCurrent ? authErrorMessage(mutation.error) : null}
        />
        {mutation.isSuccess ? (
          <View
            className="rounded-md border border-success-subtle-border bg-success-subtle p-3"
            accessibilityLiveRegion="polite"
            testID="alterar-senha-sucesso"
          >
            <Text className="text-sm font-medium text-success-subtle-foreground">
              Senha alterada. As outras sessões foram encerradas.
            </Text>
          </View>
        ) : null}
        <Field
          label="Senha atual"
          {...current.bind}
          testID="alterar-senha-atual"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={() => next.focus()}
          editable={!mutation.isPending}
        />
        <Field
          label="Nova senha"
          hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
          {...next.bind}
          testID="alterar-senha-nova"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={() => confirm.focus()}
          editable={!mutation.isPending}
        />
        <Field
          label="Confirmar nova senha"
          {...confirm.bind}
          testID="alterar-senha-confirmar"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={submit}
          editable={!mutation.isPending}
        />
        <Button testID="alterar-senha-salvar" onPress={submit} disabled={mutation.isPending}>
          <Text>{mutation.isPending ? 'Alterando…' : 'Alterar senha'}</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
