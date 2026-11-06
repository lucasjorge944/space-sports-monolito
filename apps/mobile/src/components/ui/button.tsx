import { cva, type VariantProps } from 'class-variance-authority';
import { Platform, Pressable } from 'react-native';
import { useFocusRing } from '@/components/ui/focus-ring';
import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  cn(
    'group shrink-0 flex-row items-center justify-center gap-2 rounded-md',
    Platform.select({
      web: 'whitespace-nowrap outline-none transition-all disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
    }),
  ),
  {
    variants: {
      variant: {
        // Primário: Mar com texto branco no claro, Sol com texto Noite no escuro.
        default: cn(
          'bg-primary active:bg-primary/90',
          Platform.select({ web: 'hover:bg-primary/90' }),
        ),
        // Destaque: Sol com texto Noite no claro, Mar 400 com texto branco no escuro.
        secondary: cn(
          'bg-secondary active:bg-secondary/90',
          Platform.select({ web: 'hover:bg-secondary/90' }),
        ),
        // Escuro: Noite com texto branco (no escuro do app inverte, para não sumir no fundo).
        dark: cn(
          'bg-foreground active:bg-foreground/90',
          Platform.select({ web: 'hover:bg-foreground/90' }),
        ),
        destructive: cn(
          'bg-destructive active:bg-destructive/90',
          Platform.select({ web: 'hover:bg-destructive/90' }),
        ),
        outline: cn(
          'border-[1.5px] border-foreground bg-card active:bg-accent dark:border-muted-foreground dark:bg-transparent',
          Platform.select({ web: 'hover:bg-accent' }),
        ),
        ghost: cn('active:bg-accent', Platform.select({ web: 'hover:bg-accent' })),
      },
      size: {
        default: 'h-12 px-6',
        sm: 'h-11 gap-1.5 px-4',
        lg: 'h-14 px-8',
        icon: 'h-12 w-12',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const buttonTextVariants = cva('text-base font-semibold text-foreground', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      dark: 'text-background',
      destructive: 'text-destructive-foreground',
      outline: '',
      ghost: 'text-link',
    },
    size: { default: '', sm: '', lg: '', icon: '' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

type ButtonProps = React.ComponentProps<typeof Pressable> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, style, onFocus, onBlur, ...props }: ButtonProps) {
  const ring = useFocusRing(onFocus, onBlur);
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(props.disabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        role="button"
        style={(state) => [typeof style === 'function' ? style(state) : style, ring.style]}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export type { ButtonProps };
export { Button, buttonTextVariants, buttonVariants };
