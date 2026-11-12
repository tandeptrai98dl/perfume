import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import {
  orderItems,
  orders,
  productTranslations,
  reviewInvitations,
  reviews,
  users,
} from '@/server/db/schema';
import { foldedContains } from '@/server/lib/sql-helpers';

import {
  EMPTY_SUMMARY,
  hashReviewToken,
  invitationState,
  REVIEWABLE_ORDER_STATUSES,
  REVIEWS_PAGE_SIZE,
  roundRating,
  suggestedReviewerName,
  type InvitationState,
  type RatingDistribution,
  type ReviewStatus,
  type ReviewSummary,
} from './rules';

/*
 * Read side of the review module. `orders`, `order_items` and `product_translations` are read
 * here (never written): a review is tied to the purchased line it verifies.
 */

type Executor = Pick<Database, 'select' | 'execute'>;
type Locale = 'vi' | 'en';

// ---------- Storefront: product page ----------

/** Aggregates of the approved reviews of a product (summary block, JSON-LD, products.rating_*). */
export async function getReviewSummary(db: Executor, productId: string): Promise<ReviewSummary> {
  const rows = await db
    .select({ rating: reviews.rating, n: count() })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, 'approved')))
    .groupBy(reviews.rating);
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  if (total === 0) return EMPTY_SUMMARY;
  const [means] = await db
    .select({
      average: sql<string>`avg(${reviews.rating})`,
      longevity: sql<string | null>`avg(${reviews.longevity})`,
      sillage: sql<string | null>`avg(${reviews.sillage})`,
    })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, 'approved')));
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) distribution[row.rating as 1 | 2 | 3 | 4 | 5] = row.n;
  const num = (value: string | null | undefined) =>
    value === null || value === undefined ? null : roundRating(Number(value));
  return {
    count: total,
    average: num(means?.average) ?? 0,
    longevity: num(means?.longevity),
    sillage: num(means?.sillage),
    distribution,
  };
}

export type PublishedReview = {
  id: string;
  reviewerName: string;
  locale: Locale;
  rating: number;
  longevity: number | null;
  sillage: number | null;
  title: string | null;
  body: string;
  adminReply: string | null;
  /** Size bought, from the order line snapshot ("100 ml"). */
  variantLabel: string;
  createdAt: Date;
};

export type ReviewPage = {
  rows: PublishedReview[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Approved reviews of a product, newest first, reviews written in the visitor's language
 * before the others (both are shown: a verified review is useful in any language).
 */
export async function listPublishedReviews(
  db: Executor,
  input: { productId: string; locale: Locale; page?: number; pageSize?: number },
): Promise<ReviewPage> {
  const pageSize = input.pageSize ?? REVIEWS_PAGE_SIZE;
  const page = Math.max(1, input.page ?? 1);
  const where = and(eq(reviews.productId, input.productId), eq(reviews.status, 'approved'));
  const [totalRow] = await db.select({ n: count() }).from(reviews).where(where);
  const total = totalRow?.n ?? 0;
  const rows =
    total === 0
      ? []
      : await db
          .select({
            id: reviews.id,
            reviewerName: reviews.reviewerName,
            locale: reviews.locale,
            rating: reviews.rating,
            longevity: reviews.longevity,
            sillage: reviews.sillage,
            title: reviews.title,
            body: reviews.body,
            adminReply: reviews.adminReply,
            variantLabel: orderItems.variantLabel,
            createdAt: reviews.createdAt,
          })
          .from(reviews)
          .innerJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
          .where(where)
          .orderBy(
            sql`case when ${reviews.locale} = ${input.locale} then 0 else 1 end`,
            desc(reviews.createdAt),
            desc(reviews.id),
          )
          .limit(pageSize)
          .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---------- Account: reviews to write + own reviews ----------

export type ReviewableItem = {
  orderItemId: string;
  orderCode: string;
  productId: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  /** Product page slug in the requested locale, when that translation is published. */
  productSlug: string | null;
  deliveredAt: Date | null;
};

const MAX_ACCOUNT_ROWS = 100;

/** Delivered/completed order lines of the member that have no review yet. */
export async function listReviewableItems(
  db: Executor,
  input: { userId: string; locale: Locale },
): Promise<ReviewableItem[]> {
  return db
    .select({
      orderItemId: orderItems.id,
      orderCode: orders.code,
      productId: orderItems.productId,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      imageUrl: orderItems.imageUrl,
      productSlug: productTranslations.slug,
      deliveredAt: orders.deliveredAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(reviews, eq(reviews.orderItemId, orderItems.id))
    .leftJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, orderItems.productId),
        eq(productTranslations.locale, input.locale),
        eq(productTranslations.isPublished, true),
      ),
    )
    .where(
      and(
        eq(orders.userId, input.userId),
        inArray(orders.status, [...REVIEWABLE_ORDER_STATUSES]),
        isNull(reviews.id),
      ),
    )
    .orderBy(desc(orders.deliveredAt), desc(orders.placedAt), asc(orderItems.id))
    .limit(MAX_ACCOUNT_ROWS);
}

export type MemberReview = {
  id: string;
  productName: string;
  variantLabel: string;
  productSlug: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  adminReply: string | null;
  createdAt: Date;
};

/** Reviews the member wrote (any status), newest first. */
export async function listMemberReviews(
  db: Executor,
  input: { userId: string; locale: Locale },
): Promise<MemberReview[]> {
  return db
    .select({
      id: reviews.id,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      productSlug: productTranslations.slug,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      status: reviews.status,
      adminReply: reviews.adminReply,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, reviews.productId),
        eq(productTranslations.locale, input.locale),
        eq(productTranslations.isPublished, true),
      ),
    )
    .where(or(eq(reviews.userId, input.userId), eq(orders.userId, input.userId)))
    .orderBy(desc(reviews.createdAt))
    .limit(MAX_ACCOUNT_ROWS);
}

/** Suggested public name for a member's review form (given name of the account name). */
export async function memberReviewerName(db: Executor, input: { userId: string }): Promise<string> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  return suggestedReviewerName(row?.name ?? null);
}

// ---------- Guest link ----------

export type InvitationView = {
  state: InvitationState;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  productSlug: string | null;
  orderCode: string;
  suggestedName: string;
};

/** What the review link page shows for a raw token; null when the token is unknown. */
export async function getInvitationByToken(
  db: Executor,
  input: { token: string; locale: Locale; now?: Date },
): Promise<InvitationView | null> {
  const [row] = await db
    .select({
      usedAt: reviewInvitations.usedAt,
      expiresAt: reviewInvitations.expiresAt,
      orderStatus: orders.status,
      orderCode: orders.code,
      customerName: orders.customerName,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      imageUrl: orderItems.imageUrl,
      productSlug: productTranslations.slug,
      reviewId: reviews.id,
    })
    .from(reviewInvitations)
    .innerJoin(orderItems, eq(orderItems.id, reviewInvitations.orderItemId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(reviews, eq(reviews.orderItemId, orderItems.id))
    .leftJoin(
      productTranslations,
      and(
        eq(productTranslations.productId, orderItems.productId),
        eq(productTranslations.locale, input.locale),
        eq(productTranslations.isPublished, true),
      ),
    )
    .where(eq(reviewInvitations.tokenHash, hashReviewToken(input.token)))
    .limit(1);
  if (!row) return null;
  return {
    state: invitationState({
      usedAt: row.usedAt,
      expiresAt: row.expiresAt,
      orderStatus: row.orderStatus,
      hasReview: row.reviewId !== null,
      now: input.now,
    }),
    productName: row.productName,
    variantLabel: row.variantLabel,
    imageUrl: row.imageUrl,
    productSlug: row.productSlug,
    orderCode: row.orderCode,
    suggestedName: suggestedReviewerName(row.customerName),
  };
}

// ---------- Admin: moderation queue ----------

export const MODERATION_SORTS = ['createdAt', 'rating'] as const;

export type ModerationRow = {
  id: string;
  productId: string;
  productName: string;
  variantLabel: string;
  orderCode: string;
  reviewerName: string;
  isMember: boolean;
  locale: Locale;
  rating: number;
  longevity: number | null;
  sillage: number | null;
  title: string | null;
  body: string;
  status: ReviewStatus;
  adminReply: string | null;
  moderatedAt: Date | null;
  createdAt: Date;
};

export type ModerationQuery = {
  status?: ReviewStatus | null;
  q?: string;
  page: number;
  pageSize: number;
  sort?: string;
  dir?: 'asc' | 'desc';
};

/** Moderation queue (§11.2 Reviews): filter by status, search product/reviewer/order code. */
export async function listReviewsForModeration(
  db: Executor,
  query: ModerationQuery,
): Promise<{ rows: ModerationRow[]; total: number; page: number; pageSize: number }> {
  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(reviews.status, query.status));
  const q = query.q?.trim();
  if (q) {
    conditions.push(
      or(
        foldedContains(orderItems.productName, q),
        foldedContains(reviews.reviewerName, q),
        foldedContains(orders.code, q),
      )!,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [totalRow] = await db
    .select({ n: count() })
    .from(reviews)
    .innerJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(where);
  const direction = query.dir === 'asc' ? asc : desc;
  const order =
    query.sort === 'rating'
      ? [direction(reviews.rating), desc(reviews.createdAt)]
      : // Pending queue: oldest first is the natural work order; others newest first.
        [
          query.sort === 'createdAt'
            ? direction(reviews.createdAt)
            : query.status === 'pending'
              ? asc(reviews.createdAt)
              : desc(reviews.createdAt),
        ];
  const rows = await db
    .select({
      id: reviews.id,
      productId: reviews.productId,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      orderCode: orders.code,
      reviewerName: reviews.reviewerName,
      isMember: sql<boolean>`${reviews.userId} is not null`,
      locale: reviews.locale,
      rating: reviews.rating,
      longevity: reviews.longevity,
      sillage: reviews.sillage,
      title: reviews.title,
      body: reviews.body,
      status: reviews.status,
      adminReply: reviews.adminReply,
      moderatedAt: reviews.moderatedAt,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(where)
    .orderBy(...order, desc(reviews.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { rows, total: totalRow?.n ?? 0, page: query.page, pageSize: query.pageSize };
}

/** Review counts per status (filter tabs; the dashboard's "reviews awaiting moderation"). */
export async function countReviewsByStatus(db: Executor): Promise<Record<ReviewStatus, number>> {
  const rows = await db
    .select({ status: reviews.status, n: count() })
    .from(reviews)
    .groupBy(reviews.status);
  const out: Record<ReviewStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const row of rows) out[row.status] = row.n;
  return out;
}

export async function countPendingReviews(db: Executor): Promise<number> {
  return (await countReviewsByStatus(db)).pending;
}

// ---------- Privacy centre (export of the customer's own data) ----------

export type ReviewExportRow = {
  productName: string;
  rating: number;
  title: string | null;
  body: string;
  reviewerName: string;
  status: ReviewStatus;
  createdAt: Date;
};

/** The member's reviews for the personal-data export (privacy stream integration point). */
export async function exportUserReviews(db: Executor, userId: string): Promise<ReviewExportRow[]> {
  return db
    .select({
      productName: orderItems.productName,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      reviewerName: reviews.reviewerName,
      status: reviews.status,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(orderItems, eq(orderItems.id, reviews.orderItemId))
    .where(eq(reviews.userId, userId))
    .orderBy(desc(reviews.createdAt));
}
