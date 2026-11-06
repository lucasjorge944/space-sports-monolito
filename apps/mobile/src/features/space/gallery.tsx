import type { Photo } from '@space-sports/api-client';
import { useState } from 'react';
import { FlatList, useWindowDimensions, View } from 'react-native';
import { RemoteImage } from '@/components/remote-image';
import { Text } from '@/components/ui/text';

/** Galeria de fotos em páginas (capa primeiro). Sem fotos, não ocupa espaço. */
export function Gallery({ photos, spaceName }: { photos: Photo[]; spaceName: string }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  if (photos.length === 0) return null;
  const height = Math.round(width * 0.75);

  return (
    <View>
      <FlatList
        data={photos}
        keyExtractor={(photo) => photo.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
        }
        renderItem={({ item, index: i }) => (
          <RemoteImage
            uri={item.url}
            blurhash={item.blurhash}
            style={{ width, height }}
            accessibilityLabel={`Foto ${i + 1} de ${photos.length} de ${spaceName}`}
            accessibilityIgnoresInvertColors
          />
        )}
      />
      {photos.length > 1 ? (
        <View
          className="absolute bottom-3 right-3 rounded-full bg-mar-900/70 px-2.5 py-1"
          accessibilityLabel={`Foto ${index + 1} de ${photos.length}`}
        >
          <Text className="text-xs text-neutral-50">
            {index + 1}/{photos.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
