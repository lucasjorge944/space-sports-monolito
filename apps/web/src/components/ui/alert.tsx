import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:top-3.5 [&>svg]:left-4 [&>svg]:size-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        // Status tingidos das pranchas 06/07: borda do status, fundo e texto `-subtle`.
        destructive:
          'border-destructive bg-destructive-subtle text-destructive-subtle-foreground [&>svg]:text-current',
        warning:
          'border-warning bg-warning-subtle text-warning-subtle-foreground [&>svg]:text-current',
        success:
          'border-success bg-success-subtle text-success-subtle-foreground [&>svg]:text-current',
        info: 'border-info bg-info-subtle text-info-subtle-foreground [&>svg]:text-current',
        // Faixa "Ambiente de teste" (docs/05, "Pagamento online"): cores do selo do gateway simulado.
        sandbox:
          'border-[1.5px] border-sandbox-border bg-sandbox text-sandbox-foreground [&>svg]:text-current',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert, alertVariants };
