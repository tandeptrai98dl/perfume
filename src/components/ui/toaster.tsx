'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Toasts (Sonner): "Added to cart", "Saved". Call `toast()` from `sonner`. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            'rounded-none! border! border-line-200! bg-white! text-ink-950! font-sans! shadow-overlay!',
          description: 'text-taupe-600!',
          actionButton: 'rounded-none! bg-ink-950! text-ivory-50!',
        },
      }}
      {...props}
    />
  );
}
