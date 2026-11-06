import type * as React from 'react';
import { cn, focusRing } from '@/lib/utils';

const chipBase =
  'inline-flex items-center rounded-full border-[1.5px] px-3.5 py-2 text-sm font-medium whitespace-nowrap';
const chipSelected = 'border-chip-selected-border bg-chip-selected text-chip-selected-foreground';
const chipIdle = 'border-chip-border bg-chip text-chip-foreground';

/**
 * Chip de esporte e de filtro (docs/05-design-system.md, "Chips e badges"): neutro nos dois temas,
 * com o Sol só no selecionado. Tudo pelos tokens `chip*`.
 */
function Chip({
  selected = false,
  className,
  ...props
}: React.ComponentProps<'span'> & { selected?: boolean }) {
  return (
    <span
      data-slot="chip"
      data-selected={selected || undefined}
      className={cn(chipBase, selected ? chipSelected : chipIdle, className)}
      {...props}
    />
  );
}

/** Chip selecionável: botão com `aria-pressed`. Não muda de cor no erro. */
function ChipButton({
  selected = false,
  className,
  ...props
}: React.ComponentProps<'button'> & { selected?: boolean }) {
  return (
    <button
      type="button"
      data-slot="chip"
      aria-pressed={selected}
      className={cn(
        chipBase,
        focusRing,
        selected ? chipSelected : cn(chipIdle, 'hover:bg-chip-hover'),
        'disabled:cursor-not-allowed disabled:border-disabled disabled:bg-input-disabled disabled:text-disabled-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Chip, ChipButton };
