'use client';

import { useState } from 'react';
import { ChipButton } from '@/components/ui/chip';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import {
  spanToMinutes,
  splitMinutes,
  TIME_PRESETS,
  TIME_UNIT_OPTIONS,
  type TimeSpan,
  type TimeUnit,
} from '@/lib/painel/time-span';
import { Field } from './field';

type TimeSpanFieldProps = {
  label: string;
  /** Minutos da API, como texto; o que a tela mostra é número + unidade. */
  value: string;
  onChange: (minutes: string) => void;
  disabled?: boolean;
  error?: string | undefined;
  hint?: string;
  /** Rótulo do atalho de zero (ex.: "Na hora da aula"); sem ele, o atalho não aparece. */
  zeroLabel?: string;
};

/** Prazo com número + unidade ou atalho, sempre gravado em minutos. */
export function TimeSpanField({
  label,
  value,
  onChange,
  disabled,
  error,
  hint,
  zeroLabel,
}: TimeSpanFieldProps) {
  // A unidade é escolha de quem digita: "60 horas" não pode virar "2 dias e 12 horas" na digitação.
  const [span, setSpan] = useState<TimeSpan>(() => splitMinutes(value));
  const update = (next: TimeSpan) => {
    setSpan(next);
    onChange(spanToMinutes(next));
  };
  const presets = [...(zeroLabel ? [{ minutes: 0, label: zeroLabel }] : []), ...TIME_PRESETS];

  return (
    <Field label={label} error={error} hint={hint} group>
      <div className="grid gap-2">
        <div className="flex gap-2">
          <MaskedInput
            mask="integer"
            maxLength={5}
            className="w-20"
            aria-label={`${label}: quantidade`}
            disabled={disabled}
            value={span.amount}
            onValueChange={(amount) => update({ ...span, amount })}
          />
          <Select
            value={span.unit}
            disabled={disabled}
            onValueChange={(unit) => update({ ...span, unit: unit as TimeUnit })}
          >
            <SelectTrigger aria-label={`${label}: unidade`} className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_UNIT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <ChipButton
              key={preset.minutes}
              className="px-2.5 py-1 text-xs"
              disabled={disabled}
              selected={value === String(preset.minutes)}
              onClick={() => update(splitMinutes(String(preset.minutes)))}
            >
              {preset.label}
            </ChipButton>
          ))}
        </div>
      </div>
    </Field>
  );
}
