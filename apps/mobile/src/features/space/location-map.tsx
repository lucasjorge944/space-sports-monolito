import type { GeoPoint } from '@space-sports/api-client';
import { Pressable, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useThemeName } from '@/theme/theme-provider';

/** Prévia do mapa, parada: tocar abre o app de mapas, e a rolagem da página continua livre. */
export function LocationMap({
  location,
  label,
  onPress,
}: {
  location: GeoPoint;
  label: string;
  onPress: () => void;
}) {
  const theme = useThemeName();
  const coordinate = { latitude: location.lat, longitude: location.lng };
  return (
    <Pressable
      testID="espaco-mapa"
      role="link"
      accessibilityLabel={`Abrir ${label} no mapa`}
      className="h-40 overflow-hidden rounded-lg border border-border active:opacity-90"
      onPress={onPress}
    >
      <View className="flex-1" pointerEvents="none">
        <MapView
          style={{ flex: 1 }}
          liteMode
          userInterfaceStyle={theme}
          initialRegion={{ ...coordinate, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          <Marker coordinate={coordinate} title={label} />
        </MapView>
      </View>
    </Pressable>
  );
}
