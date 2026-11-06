import { Image, type ImageProps } from 'expo-image';

/** Foto remota com cache e blurhash (placeholder enquanto carrega). */
export function RemoteImage({
  uri,
  blurhash,
  ...props
}: Omit<ImageProps, 'source' | 'placeholder'> & { uri: string; blurhash?: string | null }) {
  return (
    <Image
      source={{ uri }}
      placeholder={blurhash ? { blurhash } : undefined}
      contentFit="cover"
      transition={150}
      {...props}
    />
  );
}
