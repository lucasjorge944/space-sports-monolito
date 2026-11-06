'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale/pt-BR';
import { buttonVariants } from '@/components/ui/button';
import { cn, focusRing } from '@/lib/utils';

const navButton = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-foreground');

function Chevron({ orientation }: { orientation?: 'up' | 'down' | 'left' | 'right' }) {
  const Icon =
    orientation === 'left' ? ChevronLeft : orientation === 'down' ? ChevronDown : ChevronRight;
  return <Icon className="size-4" aria-hidden />;
}

/** Calendário do shadcn sobre o `react-day-picker`, em pt-BR e com a semana a partir do domingo. */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={ptBR}
      weekStartsOn={0}
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-3',
        nav: 'absolute inset-x-0 top-0 z-10 flex items-center justify-between',
        button_previous: navButton,
        button_next: navButton,
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-sm font-semibold capitalize',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground w-9 text-xs font-medium capitalize',
        week: 'mt-1 flex',
        day: 'size-9 p-0 text-center text-sm',
        day_button: cn(
          focusRing,
          'inline-flex size-9 cursor-pointer items-center justify-center rounded-md tabular-nums hover:bg-accent hover:text-accent-foreground',
        ),
        today: '[&>button]:font-semibold [&>button]:underline [&>button]:underline-offset-4',
        outside: 'text-muted-foreground',
        disabled:
          'text-disabled-foreground [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent [&>button]:hover:text-disabled-foreground',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{ Chevron }}
      {...props}
    />
  );
}

export { Calendar };
