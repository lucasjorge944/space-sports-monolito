import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold whitespace-nowrap [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        // Status tingidos (docs/05-design-system.md, "Chips e badges"): fundo, borda e texto `-subtle`.
        success: 'border-success-subtle-border bg-success-subtle text-success-subtle-foreground',
        warning: 'border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground',
        destructive:
          'border-destructive-subtle-border bg-destructive-subtle text-destructive-subtle-foreground',
        info: 'border-info-subtle-border bg-info-subtle text-info-subtle-foreground',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
