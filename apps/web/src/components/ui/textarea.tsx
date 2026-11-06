'use client';

import type * as React from 'react';
import { cn, fieldClasses } from '@/lib/utils';
import { useFieldControl } from './field-control';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  const control = useFieldControl(props);
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 px-3 py-2 placeholder:text-muted-foreground',
        fieldClasses,
        className,
      )}
      {...props}
      {...control}
    />
  );
}

export { Textarea };
