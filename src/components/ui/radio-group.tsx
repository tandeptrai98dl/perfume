'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-3', className)} {...props} />;
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'peer inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-taupe-600 bg-white',
        'data-[state=checked]:border-ink-950 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="bg-ink-950 size-2.5 rounded-full" />
    </RadioGroupPrimitive.Item>
  );
}

/** Card-style option for payment and shipping methods (§8.1). The whole card is the target. */
export function RadioCard({
  className,
  title,
  description,
  aside,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item> & {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'group border-line-200 flex w-full items-start gap-4 border bg-white p-4 text-left',
        'transition-colors duration-(--duration-hover) hover:border-taupe-600',
        'data-[state=checked]:border-ink-950 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="group-data-[state=checked]:border-ink-950 mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-taupe-600"
      >
        <RadioGroupPrimitive.Indicator className="bg-ink-950 size-2.5 rounded-full" />
      </span>
      <span className="flex flex-1 flex-col gap-1">
        <span className="font-medium">{title}</span>
        {description && <span className="text-small text-taupe-600">{description}</span>}
      </span>
      {aside && <span className="shrink-0">{aside}</span>}
    </RadioGroupPrimitive.Item>
  );
}
