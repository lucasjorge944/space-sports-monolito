import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** Linha de menu do Perfil, com alvo de toque de 44pt+. */
export function MenuRow({
  icon,
  label,
  detail,
  destructive,
  onPress,
  testID,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  destructive?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const name = useThemeName();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      className="min-h-12 flex-row items-center gap-3 px-1 active:bg-accent"
    >
      {icon}
      <Text className={cn('flex-1', destructive && 'text-destructive')}>{label}</Text>
      {detail ? <Text variant="muted">{detail}</Text> : null}
      <View>
        <ChevronRight size={18} color={color(name, 'mutedForeground')} />
      </View>
    </Pressable>
  );
}
