import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ReviewToWrite } from '@/components/account/review-to-write';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RatingDisplay } from '@/components/ui/rating';
import { Link } from '@/i18n/navigation';
import { requireCustomerPage } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import {
  listMemberReviews,
  listReviewableItems,
  memberReviewerName,
  type ReviewStatus,
} from '@/server/modules/review';

import {
  ACCOUNT_ROBOTS,
  AccountHeader,
  accountLocale,
  AccountSkeleton,
} from '../_lib/account-page';

type Props = PageProps<'/[locale]/account/reviews'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await accountLocale(params);
  const t = await getTranslations({ locale, namespace: 'reviews.account' });
  return { title: t('metaTitle'), robots: ACCOUNT_ROBOTS };
}

const STATUS_BADGE: Record<ReviewStatus, 'gold' | 'success' | 'outline'> = {
  pending: 'gold',
  approved: 'success',
  rejected: 'outline',
};

/** Account → Reviews (ADR-0008): delivered purchases to review, and the reviews written. */
export default function AccountReviewsPage({ params }: Props) {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <Reviews params={params} />
    </Suspense>
  );
}

async function Reviews({ params }: { params: Props['params'] }) {
  const locale = await accountLocale(params);
  const session = await requireCustomerPage(locale, { pathname: '/account/reviews' });
  const t = await getTranslations({ locale, namespace: 'reviews.account' });
  const format = await getFormatter({ locale });
  const db = getDb();
  const userId = session.user.id;
  const [items, written, defaultName] = await Promise.all([
    listReviewableItems(db, { userId, locale }),
    listMemberReviews(db, { userId, locale }),
    memberReviewerName(db, { userId, locale }),
  ]);

  return (
    <>
      <AccountHeader title={t('title')} intro={t('intro')} />
      <div className="flex flex-col gap-12">
        <section aria-labelledby="reviews-to-write" className="flex flex-col gap-4">
          <h2 id="reviews-to-write" className="text-h2">
            {t('toWrite')}
          </h2>
          {items.length === 0 ? (
            <div className="border-line-200 flex flex-col items-start gap-4 border p-6">
              <p className="text-taupe-600">{t('nothingToWrite')}</p>
              <Button asChild variant="secondary">
                <Link href="/account/orders">{t('viewOrders')}</Link>
              </Button>
            </div>
          ) : (
            <ul className="border-line-200 flex flex-col border-t" data-testid="reviews-to-write">
              {items.map((item) => (
                <li
                  key={item.orderItemId}
                  className="border-line-200 flex flex-wrap items-center justify-between gap-4 border-b py-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    {item.productSlug ? (
                      <Link
                        href={{ pathname: '/products/[slug]', params: { slug: item.productSlug } }}
                        className="font-medium wrap-anywhere hover:underline"
                      >
                        {item.productName}
                      </Link>
                    ) : (
                      <span className="font-medium wrap-anywhere">{item.productName}</span>
                    )}
                    <span className="text-small text-taupe-600">
                      {t('itemMeta', {
                        variant: item.variantLabel,
                        code: item.orderCode,
                      })}
                    </span>
                  </div>
                  <ReviewToWrite
                    orderItemId={item.orderItemId}
                    productName={item.productName}
                    variantLabel={item.variantLabel}
                    defaultName={defaultName}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="reviews-written" className="flex flex-col gap-4">
          <h2 id="reviews-written" className="text-h2">
            {t('written')}
          </h2>
          {written.length === 0 ? (
            <p className="text-taupe-600">{t('noneWritten')}</p>
          ) : (
            <ul className="border-line-200 flex flex-col border-t" data-testid="reviews-written">
              {written.map((review) => (
                <li key={review.id} className="border-line-200 flex flex-col gap-2 border-b py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-medium wrap-anywhere">{review.productName}</span>
                    <Badge variant={STATUS_BADGE[review.status]}>
                      {t(`status.${review.status}`)}
                    </Badge>
                  </div>
                  <RatingDisplay value={review.rating} />
                  {review.title && <p className="font-medium wrap-anywhere">{review.title}</p>}
                  <p className="text-ink-700 line-clamp-3 wrap-anywhere whitespace-pre-line">
                    {review.body}
                  </p>
                  <p className="text-small text-taupe-600">
                    {format.dateTime(review.createdAt, { dateStyle: 'medium' })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
