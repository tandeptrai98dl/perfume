'use server';

import 'server-only';

import { updateTag } from 'next/cache';

import { catalogTags } from '@/server/modules/catalog';
import {
  moderateReview,
  moderateReviewSchema,
  replyReviewSchema,
  replyToReview,
  reviewTags,
  type ModerationResult,
} from '@/server/modules/review';

import { runAdminAction, type ActionResult } from './run';

/*
 * Review moderation (§5.2 /admin/reviews, §11.2): `reviews.moderate` (Owner, Manager, Editor).
 * The commands audit, keep `products.rating_*` in step and enqueue the product page
 * revalidation (outbox). On top of `runAdminAction`'s stale-while-revalidate, the product's
 * tags are expired right away (`updateTag`): an unpublished review must not be served again.
 */

function expireProduct(result: ActionResult<ModerationResult>) {
  if (!result.ok) return result;
  updateTag(reviewTags.product(result.data.productId));
  updateTag(catalogTags.product(result.data.productId));
  return result;
}

export async function moderateReviewAction(raw: unknown) {
  return expireProduct(
    await runAdminAction(moderateReviewSchema, raw, 'reviews.moderate', moderateReview),
  );
}

export async function replyReviewAction(raw: unknown) {
  return expireProduct(
    await runAdminAction(replyReviewSchema, raw, 'reviews.moderate', replyToReview),
  );
}
