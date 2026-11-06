import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useSession } from '../session';

/** Há sessão guardada, mas não deu para validá-la (sem rede ou resposta inesperada): não deslogamos, só pedimos para tentar de novo. */
export function OfflineScreen({ kind = 'offline' }: { kind?: 'offline' | 'error' }) {
  const { refresh, signOut } = useSession();
  const [retrying, setRetrying] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-4 px-6">
        <Text variant="h3">{kind === 'error' ? 'Algo deu errado' : 'Sem conexão'}</Text>
        <Text variant="muted">
          {kind === 'error'
            ? 'Não conseguimos carregar sua conta. Se o problema continuar, atualize o app.'
            : 'Não conseguimos falar com o servidor. Verifique sua internet e tente novamente.'}
        </Text>
        <Button
          disabled={retrying}
          onPress={() => {
            setRetrying(true);
            void refresh().finally(() => setRetrying(false));
          }}
        >
          <Text>{retrying ? 'Tentando…' : 'Tentar novamente'}</Text>
        </Button>
        <Button variant="ghost" onPress={() => void signOut()}>
          <Text>Sair da conta</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
