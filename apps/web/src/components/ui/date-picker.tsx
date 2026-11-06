'use client';

import { dateToInput, parseDateInput } from '@space-sports/shared';
import { format, parseISO } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { todayLocal } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Calendar } from './calendar';
import { MaskedInput } from './masked-input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './popover';

/** `yyyy-MM-dd` ↔ dia do calendário. O dia não tem fuso: nunca passa por UTC. */
const toDay = (date: string) => (date ? parseISO(date) : undefined);
const fromDay = (day: Date) => format(day, 'yyyy-MM-dd');

/**
 * Texto da digitação (opcional): só chega ao formulário uma data completa e permitida. Ao sair do campo
 * o texto volta ao valor salvo, como no campo de data do navegador.
 */
function useDateDraft(
  value: string,
  onCommit: (date: string) => void,
  allowed: (date: string) => boolean = () => true,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft ? parseDateInput(draft) : null;
  return {
    value: draft ?? dateToInput(value),
    'aria-invalid': draft?.length === 10 && !(parsed && allowed(parsed)) ? true : undefined,
    onValueChange: (text: string) => {
      setDraft(text);
      const date = parseDateInput(text);
      if (text === '') onCommit('');
      else if (date && allowed(date)) onCommit(date);
    },
    onBlur: () => setDraft(null),
  };
}

type DatePickerProps = {
  id?: string;
  /** `yyyy-MM-dd`, ou vazio. */
  value: string;
  onValueChange: (date: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  /** Mês e ano em listas no calendário, para datas distantes (ex.: nascimento). Exige `min` e `max`. */
  yearDropdown?: boolean;
};

/** Mês e ano como listas: o rótulo visível fica por cima do `<select>` nativo, transparente. */
const dropdownClassNames = {
  month_caption: 'flex h-8 items-center justify-center px-9',
  dropdowns: 'flex items-center gap-1.5',
  dropdown_root:
    'relative inline-flex h-8 items-center rounded-md border border-input bg-input-background has-focus-visible:ring-2 has-focus-visible:ring-ring',
  dropdown: 'absolute inset-0 cursor-pointer opacity-0',
  caption_label: 'flex items-center gap-1 px-2 text-sm font-semibold capitalize [&>svg]:size-3.5',
};

/** Data única: digitada em dd/mm/aaaa ou escolhida no calendário. O valor segue em `yyyy-MM-dd`. */
function DatePicker({
  id,
  value,
  onValueChange,
  min,
  max,
  disabled,
  className,
  'aria-label': ariaLabel,
  yearDropdown = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const allowed = (date: string) => (!min || date >= min) && (!max || date <= max);
  const draft = useDateDraft(value, onValueChange, allowed);
  const selected = toDay(value);
  const blocked = [
    ...(min ? [{ before: parseISO(min) }] : []),
    ...(max ? [{ after: parseISO(max) }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative w-full', className)}>
          <MaskedInput
            mask="date"
            {...(id ? { id } : {})}
            {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
            {...(disabled ? { disabled } : {})}
            className="pr-10"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') setOpen(true);
            }}
            {...draft}
          />
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label="Abrir calendário"
              className="text-muted-foreground absolute top-1/2 right-0.5 -translate-y-1/2"
            >
              <CalendarDays />
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Calendar
          autoFocus
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (yearDropdown && max ? parseISO(max) : undefined)}
          today={parseISO(todayLocal())}
          disabled={blocked}
          {...(yearDropdown
            ? {
                captionLayout: 'dropdown' as const,
                ...(min ? { startMonth: parseISO(min) } : {}),
                ...(max ? { endMonth: parseISO(max) } : {}),
                classNames: dropdownClassNames,
              }
            : {})}
          onSelect={(day) => {
            if (day) onValueChange(fromDay(day));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export type DateRange = { from: string; to: string };

type DateRangePickerProps = {
  id?: string;
  from: string;
  to: string;
  onValueChange: (range: DateRange) => void;
  fromLabel?: string;
  toLabel?: string;
  disabled?: boolean;
  className?: string;
};

const rangeInput =
  'h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 aria-invalid:bg-transparent aria-invalid:focus-visible:bg-transparent disabled:border-0 disabled:bg-transparent';

/**
 * Período: as duas datas lado a lado, digitáveis, e um calendário para escolher início e fim. As pontas
 * são independentes: quem filtra decide se aceita período aberto e avisa se o início passar do fim.
 */
function DateRangePicker({
  id,
  from,
  to,
  onValueChange,
  fromLabel = 'De',
  toLabel = 'Até',
  disabled,
  className,
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Primeiro clique no calendário: a outra ponta só é escolhida no segundo.
  const [start, setStart] = useState<string | null>(null);
  const fromDraft = useDateDraft(from, (date) => onValueChange({ from: date, to }));
  const toDraft = useDateDraft(to, (date) => onValueChange({ from, to: date }));

  function pick(day: Date) {
    const date = fromDay(day);
    if (start === null) {
      setStart(date);
      return;
    }
    onValueChange(start <= date ? { from: start, to: date } : { from: date, to: start });
    setStart(null);
    setOpen(false);
  }

  const shown = start === null ? { from, to } : { from: start, to: '' };
  const field = {
    mask: 'date',
    className: rangeInput,
    ...(disabled ? { disabled } : {}),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') setOpen(true);
    },
  } as const;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setStart(null);
      }}
    >
      <PopoverAnchor asChild>
        <div
          data-slot="date-range"
          className={cn(
            'flex h-9 w-full min-w-64 items-center rounded-md border-[1.5px] border-input bg-input-background pr-0.5 transition-[background-color,border-color,box-shadow]',
            'focus-within:border-input-focus focus-within:bg-input-focus-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-ring-offset',
            'has-[input[aria-invalid=true]]:border-input-error has-[input[aria-invalid=true]]:bg-input-error-background',
            disabled && 'border-disabled bg-input-disabled',
            className,
          )}
        >
          <MaskedInput
            {...field}
            {...(id ? { id: `${id}-from` } : {})}
            aria-label={fromLabel}
            {...fromDraft}
          />
          <span aria-hidden className="text-muted-foreground text-sm">
            –
          </span>
          <MaskedInput
            {...field}
            {...(id ? { id: `${id}-to` } : {})}
            aria-label={toLabel}
            {...toDraft}
          />
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label="Abrir calendário"
              className="text-muted-foreground"
            >
              <CalendarDays />
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Calendar
          autoFocus
          mode="range"
          numberOfMonths={isMobile ? 1 : 2}
          selected={{ from: toDay(shown.from), to: toDay(shown.to) }}
          defaultMonth={toDay(from) ?? toDay(to)}
          today={parseISO(todayLocal())}
          onSelect={(_, day) => pick(day)}
          classNames={{
            selected: '',
            range_start:
              'rounded-l-md bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
            range_end:
              'rounded-r-md bg-accent [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
            range_middle: 'bg-accent [&>button]:text-accent-foreground',
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker, DateRangePicker };
