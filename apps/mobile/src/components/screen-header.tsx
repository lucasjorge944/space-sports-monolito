import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** Cabeçalho das telas empilhadas: voltar (alvo 44pt) + título. */
export function ScreenHeader({
  title,
  right,
  testID,
  onBack,
}: {
  title: string;
  right?: ReactNode;
  testID?: string;
  /** Voltar dentro da própria tela (etapa anterior), no lugar de sair dela. */
  onBack?: () => void;
}) {
  const router = useRouter();
  const name = useThemeName();
  return (
    <View className="flex-row items-center gap-1 px-2 py-1">
      <Pressable
        role="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-accent"
        onPress={() => {
          if (onBack) onBack();
          else if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
      >
        <ChevronLeft size={26} color={color(name, 'foreground')} />
      </Pressable>
      <Text variant="large" numberOfLines={1} className="flex-1" role="heading" testID={testID}>
        {title}
      </Text>
      {right}
    </View>
  );
}
