import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

import { fieldBase } from './input';

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={rows}
      data-slot="textarea"
      className={cn(fieldBase, 'py-2', className)}
      {...props}
    />
  );
}
