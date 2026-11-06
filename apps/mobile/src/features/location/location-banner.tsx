import { MapPin } from 'lucide-react-native';
import { Linking, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { useLocation } from './location-provider';

/** Convite para ligar a localização quando a vitrine está sem distância. */
export function LocationBanner() {
  const name = useThemeName();
  const { permission, canAskAgain, coords, request } = useLocation();
  if (permission === 'unknown' || permission === 'granted' || coords) return null;

  const needsSettings = permission === 'denied' && !canAskAgain;
  return (
    <View className="flex-row items-center gap-3 rounded-lg bg-accent p-3">
      <MapPin size={20} color={color(name, 'primary')} />
      <Text className="flex-1 text-sm">
        Ative a localização para ver a distância até os espaços.
      </Text>
      <Button
        size="sm"
        variant="outline"
        onPress={() => (needsSettings ? void Linking.openSettings() : void request())}
      >
        <Text>{needsSettings ? 'Configurações' : 'Ativar'}</Text>
      </Button>
    </View>
  );
}
