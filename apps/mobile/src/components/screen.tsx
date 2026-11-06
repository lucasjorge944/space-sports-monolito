import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Casca padrão das telas de aba; a área segura e o título ficam no `TabHeader`. */
export function Screen({ children }: { children?: ReactNode }) {
  return <View className="flex-1 gap-4 bg-background px-4 pt-4">{children}</View>;
}
