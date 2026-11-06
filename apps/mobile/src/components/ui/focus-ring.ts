import { useState } from 'react';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/**
 * Anel de foco da marca para teclado e acessibilidade (prancha 04): faixa `ring-offset` (Mar no
 * claro) por dentro e anel `ring` (Sol) por fora. A faixa é o que garante os 3:1 sobre o fundo claro.
 * Devolve os handlers de foco e o estilo (`boxShadow`, sem blur) para o componente aplicar.
 */
export function useFocusRing(
  onFocus?: PressableProps['onFocus'],
  onBlur?: PressableProps['onBlur'],
): {
  onFocus: NonNullable<PressableProps['onFocus']>;
  onBlur: NonNullable<PressableProps['onBlur']>;
  style: StyleProp<ViewStyle>;
} {
  const name = useThemeName();
  const [focused, setFocused] = useState(false);
  return {
    onFocus: (e) => {
      setFocused(true);
      onFocus?.(e);
    },
    onBlur: (e) => {
      setFocused(false);
      onBlur?.(e);
    },
    style: focused
      ? { boxShadow: `0 0 0 2px ${color(name, 'ringOffset')}, 0 0 0 4px ${color(name, 'ring')}` }
      : undefined,
  };
}
