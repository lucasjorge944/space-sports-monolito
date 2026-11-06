import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn, textLink } from '@/lib/utils';

// Pranchas 06 (claro) e 07 (escuro). Desabilitado = botão "Indisponível" do kit (`disabled`), e não opacidade.
const filledDisabled =
  'disabled:bg-disabled disabled:text-disabled-foreground disabled:opacity-100';
const outlineDisabled =
  'disabled:border-disabled disabled:text-disabled-foreground disabled:opacity-100';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ring-offset disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground hover:bg-primary/90 ${filledDisabled}`,
        destructive: `bg-destructive text-destructive-foreground hover:bg-destructive/90 ${filledDisabled}`,
        outline: `border-[1.5px] border-outline-border bg-outline-background text-foreground hover:bg-accent hover:text-accent-foreground ${outlineDisabled}`,
        // "Destaque": Sol + Noite no claro, Mar 400 + branco no escuro.
        secondary: `bg-secondary text-secondary-foreground hover:bg-secondary/90 ${filledDisabled}`,
        // "Escuro" (prancha 06, "Entrar"): Noite + branco; no escuro inverte.
        inverse: `bg-inverse text-inverse-foreground hover:bg-inverse/90 ${filledDisabled}`,
        // "Cancelar" da prancha 06: transparente com texto Mar. Só ícone fica neutro e, desabilitado, apagado
        // (compoundVariants): o cinza do `disabled-foreground` quase não se distingue do `muted-foreground`.
        ghost: `text-link hover:bg-accent hover:text-link-hover ${outlineDisabled}`,
        link: `${textLink} ${outlineDisabled}`,
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        // 48 px (alvo de toque da marca): páginas públicas e telas de entrada. O painel usa os demais.
        xl: 'h-12 rounded-md px-6 text-base has-[>svg]:px-5',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    compoundVariants: [
      {
        variant: 'ghost',
        size: ['icon', 'icon-xs', 'icon-sm', 'icon-lg'],
        className: 'text-muted-foreground hover:text-foreground disabled:opacity-50',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
