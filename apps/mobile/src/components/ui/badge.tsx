import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';
import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';

// Status tingidos (doc 05, "Chips e badges"): raio 6, texto 600, fundo, borda e texto `-subtle`.
const badgeVariants = cva('flex-row items-center self-start rounded-sm border px-2.5 py-[3px]', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary',
      secondary: 'border-transparent bg-secondary',
      muted: 'border-border bg-muted',
      success: 'border-success-subtle-border bg-success-subtle',
      warning: 'border-warning-subtle-border bg-warning-subtle',
      destructive: 'border-destructive-subtle-border bg-destructive-subtle',
      info: 'border-info-subtle-border bg-info-subtle',
      // Chip de esporte (não é status): neutro, pelos tokens `chip*`.
      sport: 'rounded-full border-chip-border bg-chip',
    },
  },
  defaultVariants: { variant: 'muted' },
});

const badgeTextVariants = cva('text-sm font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      muted: 'text-muted-foreground',
      success: 'text-success-subtle-foreground',
      warning: 'text-warning-subtle-foreground',
      destructive: 'text-destructive-subtle-foreground',
      info: 'text-info-subtle-foreground',
      sport: 'font-medium text-chip-foreground',
    },
  },
  defaultVariants: { variant: 'muted' },
});

type BadgeProps = React.ComponentProps<typeof View> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <View className={cn(badgeVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  );
}

export type { BadgeProps };
export { Badge };
