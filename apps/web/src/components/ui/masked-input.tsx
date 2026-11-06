'use client';

import type * as React from 'react';
import { applyMask, MASKS, type MaskName } from '@/lib/masks';
import { cn } from '@/lib/utils';
import { Input } from './input';

type MaskedInputProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  mask: MaskName;
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Campo com máscara: o valor é o texto formatado; a normalização para a API (`normalizePhone`,
 * `parseMoneyToCents`…) fica no envio. Dinheiro leva o prefixo R$ e completa os centavos ao sair.
 */
function MaskedInput({
  mask,
  value,
  onValueChange,
  onBlur,
  className,
  ...props
}: MaskedInputProps) {
  const config = MASKS[mask];

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const raw = input.value;
    const pasted = (event.nativeEvent as InputEvent).inputType === 'insertFromPaste';
    const next = applyMask(mask, raw, input.selectionStart ?? raw.length, pasted);
    // No próprio elemento: o valor pode não mudar (ex.: letra no CEP), e o React não mexeria no cursor.
    input.value = next.value;
    input.setSelectionRange(next.caret, next.caret);
    onValueChange(next.value);
  }

  const input = (
    <Input
      inputMode={config.inputMode}
      placeholder={'placeholder' in config ? config.placeholder : undefined}
      {...('type' in config ? { type: config.type } : {})}
      {...props}
      value={value}
      onChange={handleChange}
      onBlur={(event) => {
        if ('finish' in config) {
          const finished = config.finish(value);
          if (finished !== value) onValueChange(finished);
        }
        onBlur?.(event);
      }}
      className={cn(mask === 'money' && 'pl-9', 'tabular-nums', className)}
    />
  );
  if (mask !== 'money') return input;
  return (
    <div className="relative w-full">
      <span
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm"
      >
        R$
      </span>
      {input}
    </div>
  );
}

export { MaskedInput };
