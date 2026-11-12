'use client';

import { BadgeCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RatingDisplay } from '@/components/ui/rating';
import type { PublishedReview, ReviewPage } from '@/server/modules/review';

type ReviewRow = Omit<PublishedReview, 'createdAt'> & { createdAt: Date | string };

function ReviewItem({ review }: { review: ReviewRow }) {
  const t = useTranslations('reviews');
  const format = useFormatter();
  return (
    <li className="border-line-200 flex flex-col gap-3 border-t py-6" data-testid="review-item">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <RatingDisplay value={review.rating} />
        <Badge variant="success">
          <BadgeCheck aria-hidden />
          {t('verified')}
        </Badge>
      </div>
      <div lang={review.locale} className="flex flex-col gap-2">
        {review.title && <h3 className="text-h3">{review.title}</h3>}
        <p className="text-ink-700 wrap-anywhere whitespace-pre-line">{review.body}</p>
      </div>
      <p className="text-small text-taupe-600">
        {t('byline', {
          name: review.reviewerName || t('anonymousReviewer'),
          date: format.dateTime(new Date(review.createdAt), { dateStyle: 'medium' }),
        })}
        {' · '}
        {t('purchased', { variant: review.variantLabel })}
      </p>
      {(review.longevity !== null || review.sillage !== null) && (
        <p className="text-small text-taupe-600">
          {[
            review.longevity !== null && t('longevityValue', { value: review.longevity }),
            review.sillage !== null && t('sillageValue', { value: review.sillage }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {review.adminReply && (
        <div className="bg-sand-100 flex flex-col gap-1 p-4">
          <p className="eyebrow text-taupe-600">{t('reply')}</p>
          <p className="text-small text-ink-700 wrap-anywhere whitespace-pre-line">
            {review.adminReply}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * ReviewList (§8.3): approved reviews, "Verified purchase", shop replies; "Show more" loads the
 * next page from `/api/reviews` (cached, refreshed by moderation).
 */
export function ReviewList({
  productId,
  locale,
  initial,
}: {
  productId: string;
  locale: 'vi' | 'en';
  initial: ReviewPage;
}) {
  const t = useTranslations('reviews');
  const [rows, setRows] = useState<ReviewRow[]>(initial.rows);
  const [page, setPage] = useState(initial.page);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const hasMore = page < initial.pageCount;

  function loadMore() {
    setFailed(false);
    startTransition(async () => {
      const params = new URLSearchParams({ productId, locale, page: String(page + 1) });
      try {
        const response = await fetch(`/api/reviews?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { rows: ReviewRow[]; page: number };
        setRows((current) => {
          const seen = new Set(current.map((row) => row.id));
          return [...current, ...data.rows.filter((row) => !seen.has(row.id))];
        });
        setPage(data.page);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t('listLabel')} className="border-line-200 border-b">
        {rows.map((review) => (
          <ReviewItem key={review.id} review={review} />
        ))}
      </ul>
      <p className="text-small text-taupe-600" aria-live="polite">
        {t('showing', { shown: rows.length, total: initial.total })}
      </p>
      {failed && (
        <p role="alert" className="text-small text-danger">
          {t('loadFailed')}
        </p>
      )}
      {hasMore && (
        <Button
          variant="secondary"
          className="self-start"
          loading={pending}
          onClick={loadMore}
          data-testid="reviews-more"
        >
          {t('showMore')}
        </Button>
      )}
    </div>
  );
}
