import { View } from 'react-native';
import { cn } from '@/lib/utils';

/** Card comum (raio 16). O raio 24 é do card de espaço/quadra (`SpaceCard`). */
function Card({ className, ...props }: React.ComponentProps<typeof View>) {
  return (
    <View
      className={cn('gap-3 rounded-lg border border-border bg-card p-4', className)}
      {...props}
    />
  );
}

export { Card };
