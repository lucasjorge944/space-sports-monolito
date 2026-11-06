import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { Text } from '@/components/ui/text';

/** Cabeçalho fixo das abas: logo (Explorar) ou título à esquerda, ação à direita, sob a área segura. */
export function TabHeader({
  title,
  logo,
  right,
  testID,
}: {
  title: string;
  logo?: boolean;
  right?: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="min-h-11 flex-row items-center justify-between gap-2 border-b border-border bg-background pb-1 pl-4 pr-2"
      style={{ paddingTop: insets.top + 4 }}
    >
      {logo ? (
        <Logo variant="horizontal" width={160} testID={testID} />
      ) : (
        <Text variant="h3" numberOfLines={1} className="flex-1" testID={testID}>
          {title}
        </Text>
      )}
      {right}
    </View>
  );
}
