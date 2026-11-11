import { useTranslations } from 'next-intl';

import { Image, type ImageRatio } from '@/components/ui/image';
import { mediaUrl } from '@/lib/media-url';
import { cn } from '@/lib/utils';
import type { MediaImage } from '@/server/modules/catalog';

const RATIO_CLASS: Record<ImageRatio, string> = {
  '4/5': 'aspect-[4/5]',
  '16/9': 'aspect-video',
  '3/2': 'aspect-[3/2]',
  '1/1': 'aspect-square',
};

/**
 * Product photo in a fixed-ratio frame, or a token-based placeholder when the product has no
 * media yet (the demo catalogue ships without images).
 */
export function ProductImage({
  image,
  alt,
  sizes,
  ratio = '4/5',
  priority = false,
  className,
  frameClassName,
}: {
  image: MediaImage | null | undefined;
  alt: string;
  sizes: string;
  ratio?: ImageRatio;
  priority?: boolean;
  className?: string;
  frameClassName?: string;
}) {
  const src = image ? mediaUrl(image.storageKey, image.url) : null;
  if (!image || !src) return <ImagePlaceholder ratio={ratio} className={frameClassName} />;
  return (
    <Image
      src={src}
      alt={image.alt || alt}
      sizes={sizes}
      ratio={ratio}
      priority={priority}
      blurDataURL={image.blurDataUrl ?? undefined}
      className={className}
      frameClassName={frameClassName}
    />
  );
}

export function ImagePlaceholder({
  ratio = '4/5',
  className,
}: {
  ratio?: ImageRatio;
  className?: string;
}) {
  const t = useTranslations('catalog');
  return (
    <div
      role="img"
      aria-label={t('noImage')}
      className={cn(
        'bg-sand-100 flex items-center justify-center text-taupe-300',
        RATIO_CLASS[ratio],
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 64 96"
        className="h-2/5 w-auto"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="26" y="4" width="12" height="10" />
        <path d="M22 14h20v8H22z" />
        <path d="M14 30c0-4.4 3.6-8 8-8h20c4.4 0 8 3.6 8 8v54c0 4.4-3.6 8-8 8H22c-4.4 0-8-3.6-8-8V30z" />
        <path d="M22 52h20" />
      </svg>
    </div>
  );
}
