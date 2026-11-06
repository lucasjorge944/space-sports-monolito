'use client';

import { normalizeTime } from '@space-sports/shared';
import { useState } from 'react';
import { MaskedInput } from './masked-input';

type TimeInputProps = Omit<
  React.ComponentProps<typeof MaskedInput>,
  'mask' | 'value' | 'onValueChange'
> & {
  /** `HH:MM`. */
  value: string;
  onValueChange: (value: string) => void;
};

/** Hora digitada: só chega ao formulário completa; incompleta ou inválida, volta ao valor anterior ao sair. */
function TimeInput({ value, onValueChange, onBlur, ...props }: TimeInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <MaskedInput
      mask="time"
      {...props}
      value={draft ?? value}
      onValueChange={(text) => {
        setDraft(text);
        if (text.length === 5) {
          const time = normalizeTime(text);
          if (time) onValueChange(time);
        }
      }}
      onBlur={(event) => {
        const time = draft === null ? null : normalizeTime(draft);
        if (time && time !== value) onValueChange(time);
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}

export { TimeInput };
