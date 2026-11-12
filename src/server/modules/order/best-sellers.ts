import { and, desc, eq, gte, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { orderItems, orders } from '@/server/db/schema';
import { enqueueThrottled } from '@/server/jobs/queue';
import type { Tx } from '@/server/lib/command-context';
import { catalogTags } from '@/server/modules/catalog/cache-tags';

/*
 * Storefront best sellers (§2 Discovery, §10.1 "best selling" sort). Read-only ranking of
 * products by units sold, owned by the order module because it reads `orders` / `order_items`;
 * the catalogue turns the ids into visible product cards (published translation, active
 * variants, ADR-0015/0021), so hidden products drop out there.
 *
 * An order counts once it is paid (online payment or deposit + delivery) or delivered:
 * `payment_status` paid / partially refunded, or `status` delivered / completed / return
 * requested. Cancelled and returned orders never count. The window is anchored to the start
 * of a Vietnam day so cached entries stay stable through the day.
 */

/** Ranking window of the home rail and the "best selling" sort. */
export const BEST_SELLER_WINDOW_DAYS = 90;
/** Ranked products kept for the listing sort (beyond that, featured order applies). */
export const BEST_SELLER_RANK_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Vietnam is UTC+7 all year (no daylight saving). */
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

const COUNTED_PAYMENT = ['paid', 'partially_refunded'] as const;
const COUNTED_STATUS = ['delivered', 'completed', 'return_requested'] as const;
const EXCLUDED_STATUS = ['cancelled', 'returned'] as const;

/** Start of the Vietnam day `days` days before `now`. */
export function bestSellerWindowStart(now: Date, days = BEST_SELLER_WINDOW_DAYS): Date {
  const local = now.getTime() + VIETNAM_OFFSET_MS;
  const dayStart = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  return new Date(dayStart - VIETNAM_OFFSET_MS - days * DAY_MS);
}

/**
 * Product ids by units sold in counted orders placed since `since` (ties: revenue, then id
 * for a stable order). Uses the `orders(placed_at)` index.
 */
export async function listBestSellingProductIds(
  db: Pick<Database, 'select'>,
  input: { since: Date; limit?: number },
): Promise<string[]> {
  const units = sql<number>`sum(${orderItems.quantity})::int`;
  const revenue = sql<string>`sum(${orderItems.lineTotal})`;
  const rows = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        gte(orders.placedAt, input.since),
        notInArray(orders.status, [...EXCLUDED_STATUS]),
        or(
          inArray(orders.paymentStatus, [...COUNTED_PAYMENT]),
          inArray(orders.status, [...COUNTED_STATUS]),
        ),
      ),
    )
    .groupBy(orderItems.productId)
    .orderBy(desc(units), desc(revenue), orderItems.productId)
    .limit(Math.min(input.limit ?? BEST_SELLER_RANK_LIMIT, BEST_SELLER_RANK_LIMIT));
  return rows.map((row) => row.productId);
}

/** Whether an order with this status / payment status is counted by the ranking above. */
export function countsAsBestSeller(order: { status: string; paymentStatus: string }): boolean {
  if ((EXCLUDED_STATUS as readonly string[]).includes(order.status)) return false;
  return (
    (COUNTED_PAYMENT as readonly string[]).includes(order.paymentStatus) ||
    (COUNTED_STATUS as readonly string[]).includes(order.status)
  );
}

/**
 * At most one best-seller refresh per slot: a burst of payments or deliveries expires the tag
 * once now and once at the start of the next slot (pg-boss singleton slot, outbox).
 */
export const BEST_SELLER_REFRESH_SECONDS = 5 * 60;

/**
 * Refreshes the home rail and the "best selling" sort (`catalogTags.bestSellers`) when an
 * order starts or stops counting — paid, delivered, cancelled or returned (§2 Discovery).
 * Called inside the business transaction by `transitionOrder` and the payment ledger; the
 * worker's `cache.revalidate` job then calls the web app. Without it the ranking would only
 * refresh with its hourly cache life.
 */
export async function refreshBestSellersOnChange(
  boss: PgBoss,
  tx: Tx,
  before: { status: string; paymentStatus: string },
  after: { status: string; paymentStatus: string },
): Promise<boolean> {
  if (countsAsBestSeller(before) === countsAsBestSeller(after)) return false;
  await enqueueThrottled(
    boss,
    tx,
    'cache.revalidate',
    { tags: [catalogTags.bestSellers], expire: 'max' },
    { key: catalogTags.bestSellers, seconds: BEST_SELLER_REFRESH_SECONDS, nextSlot: true },
  );
  return true;
}
