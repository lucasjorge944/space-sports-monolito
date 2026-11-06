import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';

/** Seção da página do espaço: título + conteúdo. */
export function SpaceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="large" role="heading">
        {title}
      </Text>
      {children}
    </View>
  );
}
