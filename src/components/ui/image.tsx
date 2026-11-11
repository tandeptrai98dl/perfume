import NextImage, { type ImageProps as NextImageProps } from 'next/image';

import { cn } from '@/lib/utils';

const RATIOS = {
  '4/5': 'aspect-[4/5]',
  '16/9': 'aspect-video',
  '3/2': 'aspect-[3/2]',
  '1/1': 'aspect-square',
} as const;

export type ImageRatio = keyof typeof RATIOS;

/**
 * `next/image` in a fixed-ratio frame (no layout shift). `alt` and `sizes` are required:
 * pass `alt=""` only for purely decorative images.
 */
export type ImageProps = Omit<NextImageProps, 'fill' | 'width' | 'height' | 'alt' | 'sizes'> & {
  alt: string;
  sizes: string;
  ratio?: ImageRatio;
  frameClassName?: string;
};

export function Image({
  ratio = '4/5',
  className,
  frameClassName,
  blurDataURL,
  placeholder,
  ...props
}: ImageProps) {
  return (
    <div className={cn('bg-sand-100 relative overflow-hidden', RATIOS[ratio], frameClassName)}>
      <NextImage
        fill
        blurDataURL={blurDataURL}
        placeholder={placeholder ?? (blurDataURL ? 'blur' : 'empty')}
        className={cn('object-cover', className)}
        {...props}
      />
    </div>
  );
}
