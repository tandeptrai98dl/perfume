'use client';

import NextImage from 'next/image';
import type { RefObject } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/** Zoom dialog of the PDP gallery, loaded on first use (§14.1 "next/dynamic for gallery zoom"). */
export default function ProductGalleryZoom({
  open,
  onOpenChange,
  src,
  alt,
  title,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  title: string;
  /** Focus returns to the zoom button on close (it is not a Radix trigger). */
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl p-2 md:p-4"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative aspect-[4/5] max-h-[85dvh] w-full">
          <NextImage src={src} alt={alt} fill sizes="90vw" className="object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
