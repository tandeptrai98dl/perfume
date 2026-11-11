'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

const STARS = [1, 2, 3, 4, 5] as const;

/** Read-only stars, e.g. on product cards and review summaries. */
export function RatingDisplay({
  value,
  count,
  className,
}: {
  value: number;
  count?: number;
  className?: string;
}) {
  const t = useTranslations('ui.rating');
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        role="img"
        aria-label={t('label', { value: rounded })}
        className="text-gold-700 inline-flex gap-0.5"
      >
        {STARS.map((star) => (
          <Star
            key={star}
            aria-hidden
            className={cn(
              'size-4',
              star <= rounded
                ? 'fill-current'
                : star - 0.5 === rounded
                  ? 'fill-current opacity-50'
                  : 'fill-none',
            )}
          />
        ))}
      </span>
      {count !== undefined && (
        <span className="text-small text-taupe-600">{t('count', { count })}</span>
      )}
    </span>
  );
}

/** Star input for the review form: native radios, so it is keyboard and form friendly. */
export function RatingInput({
  name,
  value,
  defaultValue,
  onValueChange,
  invalid,
}: {
  name: string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  invalid?: boolean;
}) {
  const t = useTranslations('ui.rating');
  const id = useId();
  const [internal, setInternal] = useState(defaultValue ?? 0);
  const [hover, setHover] = useState(0);
  const current = value ?? internal;
  const shown = hover || current;

  return (
    <fieldset
      className="inline-flex"
      aria-invalid={invalid || undefined}
      onMouseLeave={() => setHover(0)}
    >
      <legend className="sr-only">{t('inputLegend')}</legend>
      {STARS.map((star) => (
        <label
          key={star}
          htmlFor={`${id}-${star}`}
          className="inline-flex size-11 cursor-pointer items-center justify-center"
          onMouseEnter={() => setHover(star)}
        >
          <input
            id={`${id}-${star}`}
            type="radio"
            name={name}
            value={star}
            checked={current === star}
            onChange={() => {
              setInternal(star);
              onValueChange?.(star);
            }}
            className="peer sr-only"
          />
          <Star
            aria-hidden
            className={cn(
              'text-gold-700 peer-focus-visible:outline-gold-700 size-6 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
              star <= shown ? 'fill-current' : 'fill-none',
            )}
          />
          <span className="sr-only">{t('star', { count: star })}</span>
        </label>
      ))}
    </fieldset>
  );
}
