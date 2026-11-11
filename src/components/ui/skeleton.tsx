import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** Placeholder with the real element's dimensions (pass width/height or an aspect ratio). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer bg-sand-100 bg-[linear-gradient(90deg,var(--color-sand-100)_0%,var(--color-ivory-50)_50%,var(--color-sand-100)_100%)] bg-size-[200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
