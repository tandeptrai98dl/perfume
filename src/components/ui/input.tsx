import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export const fieldBase = [
  'w-full rounded-input border border-line-200 bg-white px-3 text-body text-ink-950',
  'placeholder:text-taupe-300 transition-colors duration-(--duration-hover)',
  'hover:border-taupe-600 focus-visible:border-ink-950',
  'disabled:cursor-not-allowed disabled:bg-sand-100 disabled:opacity-70',
  'aria-invalid:border-danger',
].join(' ');

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldBase, 'min-h-11 py-2', className)}
      {...props}
    />
  );
}
