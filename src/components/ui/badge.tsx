import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** New, Only X left, Verified purchase, Authentic (§8.1). Sized by content, never fixed width. */
const badgeVariants = cva(
  'eyebrow inline-flex items-center gap-1 px-2 py-1 whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-sand-100 text-ink-950',
        outline: 'border border-line-200 text-ink-950',
        gold: 'border border-gold-500 text-gold-700',
        success: 'border border-success text-success',
        warning: 'border border-warning text-warning',
        dark: 'bg-ink-950 text-ivory-50',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
