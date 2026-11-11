import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex min-h-11 items-center justify-center gap-2 rounded-none whitespace-nowrap',
    'text-button font-medium uppercase transition-colors duration-(--duration-hover) ease-luxe',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-80',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-ink-950 text-ivory-50 hover:bg-ink-700',
        secondary:
          'border border-ink-950 bg-transparent text-ink-950 hover:bg-ink-950 hover:text-ivory-50',
        ghost: 'bg-transparent text-ink-950 hover:bg-sand-100',
        link: 'min-h-0 bg-transparent px-0 text-gold-700 normal-case tracking-normal underline-offset-4 hover:underline',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'min-h-9 px-4',
        md: 'px-6',
        lg: 'min-h-13 px-8',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a Link) with button styles. */
    asChild?: boolean;
    /** Shows a spinner, sets aria-busy and blocks clicks. Keeps the label for screen readers. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner />}
          {children}
        </>
      )}
    </Component>
  );
}
