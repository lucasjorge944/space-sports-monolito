'use client';

import type * as React from 'react';
import { cn, fieldClasses } from '@/lib/utils';
import { useFieldControl } from './field-control';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  const control = useFieldControl(props);
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 px-3 py-1 selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none',
        fieldClasses,
        className,
      )}
      {...props}
      {...control}
    />
  );
}

export { Input };
