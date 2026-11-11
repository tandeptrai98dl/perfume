import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const iconButtonVariants = cva(
  [
    'inline-flex size-11 shrink-0 items-center justify-center rounded-none text-ink-950',
    'transition-colors duration-(--duration-hover) ease-luxe disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-5 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        ghost: 'hover:bg-sand-100',
        outline: 'border border-line-200 hover:border-ink-950',
        solid: 'bg-ink-950 text-ivory-50 hover:bg-ink-700',
      },
    },
    defaultVariants: { variant: 'ghost' },
  },
);

/** Icon-only button. `aria-label` is required: icons alone are not an accessible name. */
export type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & { 'aria-label': string };

export function IconButton({ className, variant, type = 'button', ...props }: IconButtonProps) {
  return (
    <button type={type} className={cn(iconButtonVariants({ variant }), className)} {...props} />
  );
}
