'use server';

import 'server-only';

import {
  moderateReview,
  moderateReviewSchema,
  replyReviewSchema,
  replyToReview,
} from '@/server/modules/review';

import { runAdminAction } from './run';

/*
 * Review moderation (§5.2 /admin/reviews, §11.2): `reviews.moderate` (Owner, Manager, Editor).
 * The commands audit, keep `products.rating_*` in step and enqueue the product page
 * revalidation; `runAdminAction` also revalidates the returned tags right away.
 */

export async function moderateReviewAction(raw: unknown) {
  return runAdminAction(moderateReviewSchema, raw, 'reviews.moderate', moderateReview);
}

export async function replyReviewAction(raw: unknown) {
  return runAdminAction(replyReviewSchema, raw, 'reviews.moderate', replyToReview);
}
