'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer bg-sand-100 inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-taupe-600 p-0.5',
        'data-[state=checked]:border-ink-950 data-[state=checked]:bg-ink-950 transition-colors duration-(--duration-hover)',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="ease-luxe data-[state=checked]:bg-ivory-50 block size-4.5 rounded-full bg-taupe-600 transition-transform duration-(--duration-hover) data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}
