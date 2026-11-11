'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

import { DialogOverlay } from './dialog';

/** Side panel for the mini-cart, mobile menu and mobile filters (§8.1). */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 overflow-y-auto bg-ivory-50 p-6 shadow-overlay',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-dvh w-full max-w-md border-l border-line-200 data-[state=open]:animate-sheet-in-right',
        left: 'inset-y-0 left-0 h-dvh w-full max-w-sm border-r border-line-200 data-[state=open]:animate-sheet-in-left',
        bottom:
          'inset-x-0 bottom-0 max-h-[85dvh] border-t border-line-200 data-[state=open]:animate-fade-in',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export function SheetContent({
  className,
  children,
  side,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & VariantProps<typeof sheetVariants>) {
  const t = useTranslations('ui');
  return (
    <SheetPrimitive.Portal>
      <DialogOverlay />
      <SheetPrimitive.Content className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <SheetPrimitive.Close
          className="hover:bg-sand-100 absolute top-2 right-2 inline-flex size-11 items-center justify-center"
          aria-label={t('close')}
        >
          <X aria-hidden className="size-5" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-10', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('text-h2', className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description className={cn('text-small text-taupe-600', className)} {...props} />
  );
}
