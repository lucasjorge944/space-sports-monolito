import { View } from 'react-native';
import { cn } from '@/lib/utils';

/** Bloco cinza de carregamento (sem animação: respeita quem reduz movimento). */
function Skeleton({ className, ...props }: React.ComponentProps<typeof View>) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
