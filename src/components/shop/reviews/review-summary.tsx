import { useTranslations } from 'next-intl';

import { RatingDisplay } from '@/components/ui/rating';
import type { ReviewSummary as Summary } from '@/server/modules/review';

const STARS = [5, 4, 3, 2, 1] as const;

function Average({ label, value }: { label: string; value: number | null }) {
  const t = useTranslations('reviews.summary');
  if (value === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <dt className="eyebrow text-taupe-600">{label}</dt>
      <dd className="flex items-center gap-3">
        <span aria-hidden className="flex gap-1">
          {[1, 2, 3, 4, 5].map((step) => (
            <span
              key={step}
              className={Math.round(value) >= step ? 'bg-gold-700 h-1 w-6' : 'bg-line-200 h-1 w-6'}
            />
          ))}
        </span>
        <span className="text-small text-taupe-600">{t('scale', { value })}</span>
      </dd>
    </div>
  );
}

/** ReviewSummary (§8.3): average, count, star distribution, longevity/sillage as rated. */
export function ReviewSummary({ summary }: { summary: Summary }) {
  const t = useTranslations('reviews.summary');
  return (
    <div className="flex flex-col gap-6" data-testid="review-summary">
      <div className="flex flex-col gap-2">
        <p className="font-display text-h1 leading-none tabular-nums">
          {t('average', { value: summary.average })}
        </p>
        <RatingDisplay value={summary.average} count={summary.count} />
      </div>
      <dl className="flex flex-col gap-2">
        {STARS.map((star) => {
          const n = summary.distribution[star];
          const percent = summary.count > 0 ? Math.round((n / summary.count) * 100) : 0;
          return (
            <div
              key={star}
              className="text-small grid grid-cols-[4rem_1fr_2.5rem] items-center gap-3"
            >
              <dt className="text-taupe-600">{t('stars', { count: star })}</dt>
              <dd className="bg-line-200 h-1.5" aria-hidden>
                <span className="bg-gold-700 block h-full" style={{ width: `${percent}%` }} />
              </dd>
              <dd className="text-right tabular-nums">
                <span className="sr-only">{t('starsCount', { count: n, stars: star })}</span>
                <span aria-hidden>{n}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      {(summary.longevity !== null || summary.sillage !== null) && (
        <dl className="flex flex-col gap-4">
          <Average label={t('longevity')} value={summary.longevity} />
          <Average label={t('sillage')} value={summary.sillage} />
        </dl>
      )}
    </div>
  );
}
