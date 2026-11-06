import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/** "Arena Duna Sports" → "AD" (até duas iniciais; ignora conectivos como "de", "da"). */
export function spaceInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(d[aeo]s?|e)$/i.test(w));
  const first = words[0]?.[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
  return `${first}${last ?? ''}`.toUpperCase();
}

/**
 * Logo do espaço (RF-SPACE-11) em círculo; sem logo (ou se a imagem falhar), as iniciais do nome.
 * Decorativa: o nome do espaço sempre aparece ao lado, então fica fora da árvore de acessibilidade.
 * O app só exibe a logo; o envio é feito no painel web.
 */
export function SpaceAvatar({
  name,
  logoUrl,
  size = 40,
  className,
  testID = 'space-avatar',
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
  /** Prefixo dos `testID` da imagem (`<prefixo>-image`) e das iniciais (`<prefixo>-initials`). */
  testID?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!logoUrl && failed !== logoUrl;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        'items-center justify-center overflow-hidden rounded-full border border-border bg-info-subtle',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <Image
          testID={`${testID}-image`}
          source={{ uri: logoUrl }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(logoUrl)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          testID={`${testID}-initials`}
          className="font-display-semibold text-info-subtle-foreground"
          style={{ fontSize: Math.round(size * 0.4), lineHeight: Math.round(size * 0.5) }}
        >
          {spaceInitials(name)}
        </Text>
      )}
    </View>
  );
}
