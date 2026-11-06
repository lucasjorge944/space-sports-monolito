import { cva } from 'class-variance-authority';
import { Pressable } from 'react-native';
import { useFocusRing } from '@/components/ui/focus-ring';
import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type ChipProps = Omit<React.ComponentProps<typeof Pressable>, 'children'> & {
  selected?: boolean;
  /** `pill`: esporte, duração, forma de pagamento. `slot`: horário (cantos 12, prancha 06). */
  shape?: 'pill' | 'slot';
  children: React.ReactNode;
};

// Neutro nos dois temas, com o Sol só no selecionado (doc 05, "Chips e badges"), pelos tokens `chip*`.
const chipVariants = cva(
  'min-h-11 min-w-11 flex-row items-center justify-center gap-1.5 border-[1.5px] px-4 py-2',
  {
    variants: {
      shape: { pill: 'rounded-full', slot: 'rounded-md' },
      selected: {
        true: 'border-chip-selected-border bg-chip-selected',
        false: 'border-chip-border bg-chip active:bg-chip-hover',
      },
    },
    compoundVariants: [
      // Horário (prancha 06): selecionado em Mar; no escuro, Sol.
      { shape: 'slot', selected: true, className: 'border-primary bg-primary' },
    ],
    defaultVariants: { shape: 'pill', selected: false },
  },
);

/** Opção selecionável (esporte, duração, horário, forma de pagamento). Alvo de toque ≥ 44pt. */
function Chip({
  selected = false,
  shape,
  disabled,
  className,
  children,
  style,
  onFocus,
  onBlur,
  role = 'radio',
  ...props
}: ChipProps) {
  const ring = useFocusRing(onFocus, onBlur);
  return (
    <TextClassContext.Provider
      value={cn(
        'text-sm font-medium',
        selected
          ? shape === 'slot'
            ? 'text-primary-foreground'
            : 'text-chip-selected-foreground'
          : 'text-chip-foreground',
        disabled && 'text-muted-foreground',
      )}
    >
      <Pressable
        role={role}
        // `aria-checked` só vale no papel de rádio; o atalho do Explorar usa `button` + `aria-selected`.
        aria-checked={role === 'radio' ? selected : undefined}
        aria-disabled={disabled ?? false}
        disabled={disabled}
        className={cn(chipVariants({ shape, selected }), disabled && 'opacity-50', className)}
        style={(state) => [typeof style === 'function' ? style(state) : style, ring.style]}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        {...props}
      >
        {children}
      </Pressable>
    </TextClassContext.Provider>
  );
}

export { Chip };
