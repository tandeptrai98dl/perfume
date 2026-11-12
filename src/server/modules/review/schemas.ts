import { z } from 'zod';

import { REVIEW_STATUSES, REVIEWS_MAX_PAGE } from './rules';

/** Admin moderation inputs (§11.2 Reviews, RBAC `reviews.moderate`). Messages are `admin.errors.*` codes. */

export const REPLY_MAX = 1000;

export const moderateReviewSchema = z.object({
  id: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
});
export type ModerateReviewInput = z.output<typeof moderateReviewSchema>;

export const replyReviewSchema = z.object({
  id: z.uuid(),
  /** Empty removes the reply. */
  reply: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().max(REPLY_MAX, 'tooLong'))
    .nullable()
    .transform((value) => (value ? value : null)),
});
export type ReplyReviewInput = z.output<typeof replyReviewSchema>;

export const moderationFilterSchema = z.object({
  status: z.enum(REVIEW_STATUSES).nullable().catch(null),
});

/** Public "load more" on the product page. */
export const reviewPageQuerySchema = z.object({
  productId: z.uuid(),
  locale: z.enum(['vi', 'en']),
  page: z.coerce.number().int().min(1).max(REVIEWS_MAX_PAGE),
});
