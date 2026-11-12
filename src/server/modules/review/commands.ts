import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { orderItems, orders, reviewInvitations, reviews } from '@/server/db/schema';
import { diffRecords, recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { catalogTags, setProductRating } from '@/server/modules/catalog';
import type { ReviewFormValues } from '@/lib/validation/review';

import { getReviewSummary } from './queries';
import {
  hashReviewToken,
  invitationState,
  isReviewableOrderStatus,
  type ReviewStatus,
} from './rules';
import type { ModerateReviewInput, ReplyReviewInput } from './schemas';

/*
 * Review writes (ADR-0008): verified purchases only, one review per order item
 * (`reviews.order_item_id` unique), every review moderated before publication. Moderation keeps
 * `products.rating_*` in step (catalogue API) and revalidates the product page tags through the
 * outbox (`cache.revalidate`).
 */

type Locale = 'vi' | 'en';

/** Cache tags of review reads (product page section, "load more" route). */
export const reviewTags = {
  product: (productId: string) => `reviews:product:${productId}`,
} as const;

function productTags(productId: string): string[] {
  return [catalogTags.product(productId), reviewTags.product(productId)];
}

const alreadyReviewed = () =>
  new DomainError('conflict', [{ path: 'orderItemId', code: 'alreadyReviewed' }]);
const notReviewable = () =>
  new DomainError('invalid', [{ path: 'orderItemId', code: 'notReviewable' }]);

async function insertReview(
  tx: Tx,
  input: {
    productId: string;
    orderItemId: string;
    userId: string | null;
    locale: Locale;
    values: ReviewFormValues;
  },
): Promise<string> {
  const [row] = await tx
    .insert(reviews)
    .values({
      productId: input.productId,
      orderItemId: input.orderItemId,
      userId: input.userId,
      reviewerName: input.values.reviewerName,
      locale: input.locale,
      rating: input.values.rating,
      longevity: input.values.longevity,
      sillage: input.values.sillage,
      title: input.values.title,
      body: input.values.body,
      status: 'pending',
    })
    .onConflictDoNothing({ target: reviews.orderItemId })
    .returning({ id: reviews.id });
  if (!row) throw alreadyReviewed();
  // A link e-mailed for the same line can no longer be used.
  await tx
    .update(reviewInvitations)
    .set({ usedAt: new Date() })
    .where(
      and(eq(reviewInvitations.orderItemId, input.orderItemId), isNull(reviewInvitations.usedAt)),
    );
  return row.id;
}

/**
 * A member reviews a line of their own delivered/completed order from the account. `locale` is
 * the language the review is written in (the page's locale).
 */
export async function submitMemberReview(
  db: Database,
  input: { userId: string; orderItemId: string; locale: Locale; values: ReviewFormValues },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        orderUserId: orders.userId,
        orderStatus: orders.status,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orderItems.id, input.orderItemId))
      .for('update', { of: orderItems });
    // Someone else's line is indistinguishable from a missing one (no IDOR oracle).
    if (!item || item.orderUserId !== input.userId) throw new DomainError('notFound');
    if (!isReviewableOrderStatus(item.orderStatus)) throw notReviewable();
    const id = await insertReview(tx, {
      productId: item.productId,
      orderItemId: item.id,
      userId: input.userId,
      locale: input.locale,
      values: input.values,
    });
    return { id };
  });
}

/** A guest reviews through the one-time e-mailed link (token hashed, 30 days, single use). */
export async function submitGuestReview(
  db: Database,
  input: { token: string; locale: Locale; values: ReviewFormValues; now?: Date },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select({
        id: reviewInvitations.id,
        usedAt: reviewInvitations.usedAt,
        expiresAt: reviewInvitations.expiresAt,
        orderItemId: orderItems.id,
        productId: orderItems.productId,
        orderUserId: orders.userId,
        orderStatus: orders.status,
      })
      .from(reviewInvitations)
      .innerJoin(orderItems, eq(orderItems.id, reviewInvitations.orderItemId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(reviewInvitations.tokenHash, hashReviewToken(input.token)))
      .for('update', { of: reviewInvitations });
    if (!invitation) throw new DomainError('notFound');
    const state = invitationState({
      usedAt: invitation.usedAt,
      expiresAt: invitation.expiresAt,
      orderStatus: invitation.orderStatus,
      hasReview: false,
      now: input.now,
    });
    if (state === 'used') throw alreadyReviewed();
    if (state === 'expired') {
      throw new DomainError('invalid', [{ path: 'token', code: 'linkExpired' }]);
    }
    if (state === 'unavailable') throw notReviewable();
    const id = await insertReview(tx, {
      productId: invitation.productId,
      orderItemId: invitation.orderItemId,
      userId: invitation.orderUserId,
      locale: input.locale,
      values: input.values,
    });
    return { id };
  });
}

// ---------- Moderation (admin) ----------

/** Serializes moderation per product so the denormalized aggregate never misses a change. */
async function lockProductRating(tx: Tx, productId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`review-rating:${productId}`}, 0))`,
  );
}

async function refreshProductRating(tx: Tx, productId: string) {
  const summary = await getReviewSummary(tx, productId);
  await setProductRating(tx, productId, { average: summary.average, count: summary.count });
}

async function lockReview(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: reviews.id,
      productId: reviews.productId,
      status: reviews.status,
      adminReply: reviews.adminReply,
    })
    .from(reviews)
    .where(eq(reviews.id, id))
    .for('update');
  if (!row) throw new DomainError('notFound');
  return row;
}

export type ModerationResult = {
  id: string;
  productId: string;
  status: ReviewStatus;
  adminReply: string | null;
};

/** Approve (publish) or reject (hide) a review; re-approving or re-rejecting is a no-op. */
export async function moderateReview(
  ctx: CommandContext,
  input: ModerateReviewInput,
): Promise<CommandResult<ModerationResult>> {
  assertCan(ctx.actor, 'reviews.moderate');
  return ctx.db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ productId: reviews.productId })
      .from(reviews)
      .where(eq(reviews.id, input.id));
    if (!peek) throw new DomainError('notFound');
    await lockProductRating(tx, peek.productId);
    const review = await lockReview(tx, input.id);
    if (review.status === input.decision) {
      return {
        data: {
          id: review.id,
          productId: review.productId,
          status: review.status,
          adminReply: review.adminReply,
        },
        tags: [],
      };
    }
    await tx
      .update(reviews)
      .set({ status: input.decision, moderatedBy: ctx.actor.id, moderatedAt: new Date() })
      .where(eq(reviews.id, review.id));
    await refreshProductRating(tx, review.productId);
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: input.decision === 'approved' ? 'review.approve' : 'review.reject',
      entityType: 'review',
      entityId: review.id,
      diff: diffRecords({ status: review.status }, { status: input.decision }),
      ip: ctx.ip,
    });
    const tags = await enqueueRevalidation(ctx.boss, tx, productTags(review.productId));
    return {
      data: {
        id: review.id,
        productId: review.productId,
        status: input.decision,
        adminReply: review.adminReply,
      },
      tags,
    };
  });
}

/** Public shop reply under a review (shown once the review is approved); empty removes it. */
export async function replyToReview(
  ctx: CommandContext,
  input: ReplyReviewInput,
): Promise<CommandResult<ModerationResult>> {
  assertCan(ctx.actor, 'reviews.moderate');
  return ctx.db.transaction(async (tx) => {
    const review = await lockReview(tx, input.id);
    if (review.adminReply === input.reply) {
      return {
        data: {
          id: review.id,
          productId: review.productId,
          status: review.status,
          adminReply: review.adminReply,
        },
        tags: [],
      };
    }
    await tx
      .update(reviews)
      .set({ adminReply: input.reply, moderatedBy: ctx.actor.id, moderatedAt: new Date() })
      .where(eq(reviews.id, review.id));
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'review.reply',
      entityType: 'review',
      entityId: review.id,
      diff: diffRecords({ adminReply: review.adminReply }, { adminReply: input.reply }),
      ip: ctx.ip,
    });
    // Only a published review's reply is visible on the product page.
    const tags =
      review.status === 'approved'
        ? await enqueueRevalidation(ctx.boss, tx, productTags(review.productId))
        : [];
    return {
      data: {
        id: review.id,
        productId: review.productId,
        status: review.status,
        adminReply: input.reply,
      },
      tags,
    };
  });
}

/**
 * Privacy deletion step (PDPL 91/2025; `ErasureStep` of the customer module): the subject's
 * reviews stay published as anonymous (empty reviewer name, rendered as "anonymous customer")
 * and their guest invitations, which hold the e-mail, are deleted. Matches member reviews by
 * user id and guest reviews through the invitation e-mail.
 */
export async function anonymizeReviewsForSubject(
  tx: Tx,
  subject: { userId: string | null; email: string },
): Promise<{ reviews: number; invitations: number }> {
  const invited = await tx
    .select({ orderItemId: reviewInvitations.orderItemId })
    .from(reviewInvitations)
    .where(eq(reviewInvitations.email, subject.email));
  const itemIds = invited.map((row) => row.orderItemId);

  const conditions = [];
  if (subject.userId) conditions.push(eq(reviews.userId, subject.userId));
  if (itemIds.length > 0) conditions.push(inArray(reviews.orderItemId, itemIds));
  let anonymized = 0;
  if (conditions.length > 0) {
    const updated = await tx
      .update(reviews)
      .set({ reviewerName: '', userId: null })
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .returning({ id: reviews.id });
    anonymized = updated.length;
  }
  const deleted = await tx
    .delete(reviewInvitations)
    .where(eq(reviewInvitations.email, subject.email))
    .returning({ id: reviewInvitations.id });
  return { reviews: anonymized, invitations: deleted.length };
}
