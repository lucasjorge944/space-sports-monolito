'use client';

import { ChevronDown } from 'lucide-react';
import type * as React from 'react';
import { cn, fieldClasses } from '@/lib/utils';
import { useFieldControl } from './field-control';

/** `<select>` nativo com o visual dos campos: acessível e funciona bem em telas pequenas. */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  const control = useFieldControl(props);
  return (
    <div className="relative w-full">
      <select
        data-slot="select"
        className={cn(
          'h-9 appearance-none py-1 pr-8 pl-3 disabled:pointer-events-none [&>option]:bg-popover [&>option]:text-popover-foreground',
          fieldClasses,
          className,
        )}
        {...props}
        {...control}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 opacity-60"
      />
    </div>
  );
}

export { Select };
