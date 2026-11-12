import { MessageSquareQuote } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ReviewPage, ReviewSummary as Summary } from '@/server/modules/review';

import { ReviewList } from './review-list';
import { ReviewSummary } from './review-summary';

/**
 * Product page reviews (§10.2, ADR-0008): summary + list of approved verified-purchase reviews,
 * or the empty state. Only buyers can review (from the account or the e-mailed link).
 */
export function ReviewsSection({
  productId,
  locale,
  summary,
  page,
}: {
  productId: string;
  locale: 'vi' | 'en';
  summary: Summary;
  page: ReviewPage;
}) {
  const t = useTranslations('reviews');
  return (
    <section
      id="reviews"
      aria-labelledby="product-reviews"
      className="flex scroll-mt-24 flex-col gap-8"
      data-testid="product-reviews"
    >
      <div className="flex flex-col gap-2">
        <h2 id="product-reviews" className="text-h2">
          {t('title')}
        </h2>
        <p className="text-small text-taupe-600">{t('intro')}</p>
      </div>
      {summary.count === 0 ? (
        <div className="border-line-200 flex flex-col items-start gap-3 border p-6">
          <MessageSquareQuote aria-hidden className="text-gold-500 size-8" />
          <p className="text-h3">{t('empty.title')}</p>
          <p className="text-taupe-600">{t('empty.description')}</p>
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
          <ReviewSummary summary={summary} />
          <ReviewList productId={productId} locale={locale} initial={page} />
        </div>
      )}
    </section>
  );
}
