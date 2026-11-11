'use client';

import { ZoomIn } from 'lucide-react';
import { useTranslations } from 'next-intl';
import NextImage from 'next/image';
import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { mediaUrl } from '@/lib/media-url';
import { cn } from '@/lib/utils';
import type { MediaImage } from '@/server/modules/catalog';

import { ImagePlaceholder } from './product-image';
import { useSelectedSku } from './variant-store';

/**
 * PDP gallery (§10.2): 4:5 main image, thumbnails, zoom dialog. Follows the selected variant
 * when it has its own photo.
 */
export function ProductGallery({
  images,
  productName,
  variantIdsBySku,
}: {
  images: MediaImage[];
  productName: string;
  variantIdsBySku: Record<string, string>;
}) {
  const sku = useSelectedSku();
  const variantId = sku ? variantIdsBySku[sku] : undefined;
  const variantIndex = variantId ? images.findIndex((image) => image.variantId === variantId) : -1;
  const start = Math.max(variantIndex, 0);

  if (images.length === 0) {
    return <ImagePlaceholder ratio="4/5" className="w-full" />;
  }
  // Remount when the variant changes so the gallery jumps to that variant's photo.
  return (
    <Gallery key={variantId ?? 'default'} images={images} productName={productName} start={start} />
  );
}

function Gallery({
  images,
  productName,
  start,
}: {
  images: MediaImage[];
  productName: string;
  start: number;
}) {
  const t = useTranslations('product.gallery');
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const active = images[index] ?? images[0]!;
  const src = mediaUrl(active.storageKey, active.url);
  const alt = active.alt || productName;

  return (
    <div className="flex flex-col gap-3" aria-label={t('label')} role="group">
      <div className="bg-sand-100 relative aspect-[4/5] overflow-hidden">
        {src ? (
          <NextImage
            src={src}
            alt={alt}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            placeholder={active.blurDataUrl ? 'blur' : 'empty'}
            blurDataURL={active.blurDataUrl ?? undefined}
            className="object-cover"
          />
        ) : (
          <ImagePlaceholder ratio="4/5" className="absolute inset-0" />
        )}
        {src && (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="bg-ivory-50/90 hover:bg-ivory-50 absolute right-3 bottom-3 inline-flex size-11 items-center justify-center"
            aria-label={t('zoom')}
          >
            <ZoomIn aria-hidden className="size-5" />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <ul className="grid grid-cols-5 gap-2">
          {images.map((image, i) => {
            const thumb = mediaUrl(image.storageKey, image.url);
            return (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t('thumbnail', { index: i + 1, total: images.length })}
                  aria-current={i === index ? 'true' : undefined}
                  className={cn(
                    'bg-sand-100 relative block aspect-[4/5] w-full overflow-hidden border',
                    i === index ? 'border-ink-950' : 'border-transparent',
                  )}
                >
                  {thumb && (
                    <NextImage src={thumb} alt="" fill sizes="96px" className="object-cover" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {src && (
        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent className="max-w-4xl p-2 md:p-4">
            <DialogTitle className="sr-only">
              {t('zoomTitle', { name: productName, index: index + 1 })}
            </DialogTitle>
            <div className="relative aspect-[4/5] max-h-[85dvh] w-full">
              <NextImage src={src} alt={alt} fill sizes="90vw" className="object-contain" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
