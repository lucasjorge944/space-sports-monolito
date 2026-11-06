import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';

export function Step({
  title,
  right,
  children,
}: {
  title: string;
  /** Algo à direita do título (ex.: o selo "Ambiente de teste"). */
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="small" role="heading" className="flex-1">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="flex-row flex-wrap gap-2" role="radiogroup" accessibilityLabel={label}>
      {children}
    </View>
  );
}
