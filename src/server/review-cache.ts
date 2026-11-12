import { cacheLife, cacheTag } from 'next/cache';

import { getDb } from '@/server/db/client';
import { catalogTags } from '@/server/modules/catalog';
import {
  getReviewSummary,
  listPublishedReviews,
  reviewTags,
  type ReviewPage,
  type ReviewSummary,
} from '@/server/modules/review';

/*
 * Next-only cached wrappers of the published-review reads (§14.1), tagged so moderation
 * (`revalidateTag` in the admin action + the `cache.revalidate` outbox job) refreshes them.
 * `server/modules` cannot import `next/cache` (ADR-0023), hence this file.
 */

function tag(productId: string) {
  cacheTag(reviewTags.product(productId), catalogTags.product(productId));
}

export async function getProductReviewSummary(productId: string): Promise<ReviewSummary> {
  'use cache';
  cacheLife('hours');
  tag(productId);
  return getReviewSummary(getDb(), productId);
}

export async function getProductReviews(
  productId: string,
  locale: 'vi' | 'en',
  page: number,
): Promise<ReviewPage> {
  'use cache';
  cacheLife('hours');
  tag(productId);
  return listPublishedReviews(getDb(), { productId, locale, page });
}
