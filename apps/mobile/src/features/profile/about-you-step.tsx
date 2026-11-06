import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthActions } from '@/features/auth/actions';
import { AuthLayout } from '@/features/auth/components/auth-layout';
import { FormError } from '@/features/auth/components/field';
import { authErrorMessage } from '@/features/auth/errors';
import { AboutYouFields, useAboutYou } from './about-you';

/**
 * Etapa "Sobre você" (decisão 70): nascimento, gênero e esportes favoritos, todos opcionais, com
 * "Pular" e sem cobrança depois. Vem logo após a conta criada (cadastro) ou o cadastro completado
 * (conta nova pelo Google). `onFinish` segue o fluxo (relê o /me e libera o app); voltar pelo
 * sistema vale como pular, porque a conta já existe.
 */
export function AboutYouStep({ onFinish }: { onFinish: () => Promise<void> }) {
  const { updateProfile } = useAuthActions();
  const state = useAboutYou();
  const save = useMutation({
    mutationFn: async () => {
      await updateProfile(state.toInput());
      await onFinish();
    },
  });
  const skip = useMutation({ mutationFn: onFinish });
  const busy = save.isPending || skip.isPending;
  const skipNow = skip.mutate;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) skipNow();
      return true;
    });
    return () => subscription.remove();
  }, [busy, skipNow]);

  const submit = () => {
    if (state.validate()) save.mutate();
  };

  const error = save.error ?? skip.error;
  return (
    <AuthLayout
      title="Sobre você"
      subtitle="Conte um pouco sobre você e os esportes que joga. Tudo é opcional e dá para mudar depois no perfil."
      testID="sobre-voce-titulo"
    >
      {/* A conta já existe: o gesto de voltar não pode levar de novo ao formulário da conta. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View className="gap-6">
        <FormError message={error ? authErrorMessage(error) : null} />
        <AboutYouFields state={state} disabled={busy} />
        <View className="gap-3">
          <Button onPress={submit} disabled={busy} testID="sobre-voce-salvar">
            <Text>{save.isPending ? 'Salvando…' : 'Salvar e continuar'}</Text>
          </Button>
          <Button
            variant="ghost"
            onPress={() => skip.mutate()}
            disabled={busy}
            testID="sobre-voce-pular"
          >
            <Text>Pular</Text>
          </Button>
        </View>
      </View>
    </AuthLayout>
  );
}
