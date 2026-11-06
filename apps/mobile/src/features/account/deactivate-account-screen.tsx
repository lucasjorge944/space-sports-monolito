import { useMutation } from '@tanstack/react-query';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormError } from '@/features/auth/components/field';
import { useSession } from '@/features/auth/session';
import { deactivateAccountErrorMessage, requestAccountDeactivation } from './deactivate-account';

/** Inativação da conta pelo app (RF-AUTH-03). Só o suporte ou o espaço reativam. */
export function DeactivateAccountScreen() {
  const { signOut } = useSession();
  const mutation = useMutation({
    mutationFn: requestAccountDeactivation,
    // As sessões já foram encerradas: `signOut` remove o token push e o token local.
    onSuccess: () => signOut(),
  });

  const confirm = () => {
    Alert.alert(
      'Inativar conta?',
      'Você perde o acesso ao app. Suas reservas e mensalistas não são cancelados: o espaço cuida deles. Só o suporte ou o espaço podem reativar sua conta.',
      [
        { text: 'Manter conta', style: 'cancel' },
        { text: 'Inativar', style: 'destructive', onPress: () => mutation.mutate() },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Inativar conta" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Text>
          Ao inativar sua conta você é desconectado de todos os aparelhos e não consegue mais entrar
          no app até que ela seja reativada.
        </Text>
        <Text variant="muted">
          Suas reservas, mensalistas e pagamentos continuam como estão: nada é cancelado ou apagado.
          Se não for comparecer, avise o espaço. Para reativar a conta, fale com o espaço ou com o
          suporte da plataforma.
        </Text>
        <FormError
          message={mutation.error ? deactivateAccountErrorMessage(mutation.error) : null}
        />
        <Button variant="destructive" onPress={confirm} disabled={mutation.isPending}>
          <Text>{mutation.isPending ? 'Inativando…' : 'Inativar minha conta'}</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
