import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Field, FormError } from '@/features/auth/components/field';
import { useSession } from '@/features/auth/session';
import {
  DELETION_DEADLINE_DAYS,
  deleteAccountErrorMessage,
  deletionReceiptMessage,
  passwordFieldError,
  requestAccountDeletion,
} from './delete-account';

const REASON_MAX_LENGTH = 500;

/**
 * Exclusão da conta pelo app (RF-AUTH-03, decisão 40). O pedido inativa a conta na hora e a equipe
 * do Space Sports confirma em até 15 dias; ao concluir, o app sai da conta e mostra o prazo.
 */
export function DeleteAccountScreen() {
  const { signOut } = useSession();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: requestAccountDeletion,
    onSuccess: (receipt) => {
      // O alerta do sistema sobrevive à troca de tela: a pessoa lê o prazo já fora da conta.
      Alert.alert('Pedido de exclusão enviado', deletionReceiptMessage(receipt));
      // A API já encerrou as sessões e apagou os dispositivos de push no pedido (tarefa 2.23): `signOut` só limpa o token local.
      void signOut();
    },
  });

  const passwordError = passwordFieldError(mutation.error);

  const submit = () => {
    mutation.mutate({ password, reason });
  };

  const confirm = () => {
    Alert.alert(
      'Excluir conta?',
      `Sua conta é inativada agora e você sai do app. A equipe confirma a exclusão em até ${DELETION_DEADLINE_DAYS} dias; reservas, assinaturas e confirmações de aula futuras serão canceladas. Para desistir, fale com o atendimento.`,
      [
        { text: 'Manter conta', style: 'cancel' },
        { text: 'Excluir minha conta', style: 'destructive', onPress: submit },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Excluir conta" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
          <Text testID="excluir-conta-resumo">
            Ao pedir a exclusão, sua conta é inativada na hora e você é desconectado de todos os
            aparelhos.
          </Text>
          <View className="gap-2" testID="excluir-conta-passos">
            <Text variant="muted">
              • A equipe do Space Sports confirma o pedido em até {DELETION_DEADLINE_DAYS} dias.
            </Text>
            <Text variant="muted">
              • Ao confirmar, suas reservas, mensalistas, assinaturas e confirmações de aula futuras
              são canceladas, e seus dados pessoais são apagados da conta.
            </Text>
            <Text variant="muted">
              • Os pagamentos já registrados continuam no histórico dos espaços, sem os seus dados
              pessoais.
            </Text>
            <Text variant="muted">
              • Para desistir, fale com o atendimento antes da confirmação. Depois dela, não há como
              recuperar a conta.
            </Text>
          </View>
          <FormError message={mutation.error ? deleteAccountErrorMessage(mutation.error) : null} />
          <Field
            label="Senha"
            hint="Entrou com Google, Apple ou telefone? Deixe em branco"
            testID="excluir-conta-senha"
            value={password}
            onChangeText={setPassword}
            error={passwordError}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!mutation.isPending}
          />
          <Field
            label="Motivo"
            optional
            testID="excluir-conta-motivo"
            value={reason}
            onChangeText={setReason}
            maxLength={REASON_MAX_LENGTH}
            multiline
            className="h-24 py-2"
            textAlignVertical="top"
            editable={!mutation.isPending}
          />
          <Button
            testID="excluir-conta-confirmar"
            variant="destructive"
            onPress={confirm}
            disabled={mutation.isPending}
          >
            <Text>{mutation.isPending ? 'Enviando pedido…' : 'Excluir minha conta'}</Text>
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
