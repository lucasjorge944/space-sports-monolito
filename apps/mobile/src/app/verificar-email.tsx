import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { FormError } from '@/features/auth/components/field';
import { authErrorMessage } from '@/features/auth/errors';
import { useSession } from '@/features/auth/session';

/**
 * Confirmação de e-mail. Abre depois do cadastro e quando o link do e-mail volta ao app
 * (`spacesports://verificar-email`, com `?error=...` se o link venceu). Confirmar não é
 * obrigatório para usar o app (decisão 19), então há sempre a saída "Agora não".
 */
export default function VerificarEmailScreen() {
  const router = useRouter();
  const { error: linkError } = useLocalSearchParams<{ error?: string }>();
  const { state, refresh } = useSession();
  const { resendVerificationEmail } = useAuthActions();
  const resend = useMutation({ mutationFn: resendVerificationEmail });
  const check = useMutation({ mutationFn: refresh });

  const me = state.status === 'signed-in' ? state.me : null;
  const verified = me?.emailVerified === true;

  // O link do e-mail abre o app já com a sessão criada no navegador; revalida ao chegar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só ao abrir a tela
  useEffect(() => {
    if (state.status === 'signed-in') void refresh();
  }, []);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (verified) {
    return (
      <AuthLayout title="E-mail confirmado" subtitle="Tudo certo com a sua conta.">
        <Button onPress={leave}>
          <Text>Continuar</Text>
        </Button>
      </AuthLayout>
    );
  }

  const email = me?.email;
  return (
    <AuthLayout
      title="Confirme seu e-mail"
      subtitle={
        email
          ? `Enviamos um link para ${email}. Abra-o neste aparelho para confirmar.`
          : 'Abra o link que enviamos por e-mail para confirmar.'
      }
    >
      {linkError ? <FormError message="O link expirou ou já foi usado. Peça um novo." /> : null}
      <FormError message={resend.error ? authErrorMessage(resend.error) : null} />
      {resend.isSuccess ? (
        <Text variant="muted">E-mail reenviado. Confira sua caixa de entrada.</Text>
      ) : null}
      {me && email ? (
        <>
          <Button onPress={() => check.mutate()} disabled={check.isPending}>
            <Text>{check.isPending ? 'Verificando…' : 'Já confirmei'}</Text>
          </Button>
          <Button
            variant="outline"
            onPress={() => resend.mutate(email)}
            disabled={resend.isPending}
          >
            <Text>{resend.isPending ? 'Enviando…' : 'Reenviar e-mail'}</Text>
          </Button>
        </>
      ) : null}
      <Button variant="ghost" testID="verificar-email-agora-nao" onPress={leave}>
        <Text>Agora não</Text>
      </Button>
    </AuthLayout>
  );
}
