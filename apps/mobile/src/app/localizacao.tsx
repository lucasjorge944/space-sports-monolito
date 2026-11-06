import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useLocation } from '@/features/location/location-provider';
import { STORAGE_KEYS, setStored } from '@/lib/storage';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** Onboarding da permissão de localização (RF-SPACE-05/06): explica o motivo antes do pedido do sistema. */
export default function LocalizacaoScreen() {
  const router = useRouter();
  const name = useThemeName();
  const { permission, canAskAgain, request } = useLocation();
  const [asking, setAsking] = useState(false);

  const finish = async () => {
    await setStored(STORAGE_KEYS.locationOnboardingDone, '1');
    router.replace('/');
  };

  const allow = async () => {
    setAsking(true);
    try {
      const result = await request();
      // Negou: segue sem localização (a vitrine lista por nome). Pode ligar depois no Mapa/Explorar.
      if (result === 'granted' || result === 'denied') await finish();
    } finally {
      setAsking(false);
    }
  };

  const blocked = permission === 'denied' && !canAskAgain;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-accent">
          <MapPin size={32} color={color(name, 'primary')} />
        </View>
        <View className="gap-2">
          <Text variant="h3">Encontre espaços perto de você</Text>
          <Text variant="muted">
            Usamos a sua localização só para mostrar os espaços mais próximos e a distância até
            eles. Ela não é compartilhada com os espaços.
          </Text>
        </View>
        <View className="gap-3">
          {blocked ? (
            <Button onPress={() => void Linking.openSettings()}>
              <Text>Abrir as configurações</Text>
            </Button>
          ) : (
            <Button disabled={asking} onPress={() => void allow()}>
              <Text>{asking ? 'Aguardando…' : 'Permitir localização'}</Text>
            </Button>
          )}
          <Button
            testID="localizacao-agora-nao"
            variant="ghost"
            disabled={asking}
            onPress={() => void finish()}
          >
            <Text>Agora não</Text>
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
