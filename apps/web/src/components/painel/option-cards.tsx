'use client';

import { CheckCircle2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OptionCard<T extends string> = {
  value: T;
  label: string;
  description: string;
  icon: LucideIcon;
};

type OptionCardsProps<T extends string> = {
  label: string;
  /** `name` dos rádios: agrupa as opções e dá a navegação por setas. */
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: OptionCard<T>[];
  disabled?: boolean;
  /** Grade das opções (padrão: duas colunas a partir de `sm`). */
  className?: string;
};

/** Escolha entre poucas opções que precisam de explicação: um cartão com ícone para cada uma. */
export function OptionCards<T extends string>({
  label,
  name,
  value,
  onChange,
  options,
  disabled,
  className,
}: OptionCardsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-3 sm:grid-cols-2', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-3 rounded-lg border-[1.5px] p-4 transition-colors',
              'has-focus-visible:ring-ring has-focus-visible:ring-offset-ring-offset has-focus-visible:ring-2 has-focus-visible:ring-offset-2',
              selected ? 'border-chip-selected-border bg-accent' : 'border-border',
              disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              !disabled && !selected && 'hover:bg-accent',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground text-sm">{option.description}</span>
            </span>
            {selected ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
          </label>
        );
      })}
    </div>
  );
}
