import { eq, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { couponRedemptions, coupons } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';
import type { CouponScope, PricingCoupon } from '@/server/modules/checkout/pricing';

/*
 * Coupons of orders that already exist (admin order edits, ARCHITECTURE.md §3.4 step 8).
 * The coupon was granted when the order was placed, so its dates and usage limits are not
 * checked again: an edit re-applies its terms (scope, minimum subtotal, value) to the new
 * lines, and drops it only when those terms no longer hold (or the coupon was deleted).
 */

type Executor = Pick<Database, 'select'>;

/** Pricing terms of a coupon by code, regardless of dates/limits (null when it is gone). */
export async function getCouponTerms(
  db: Executor,
  code: string,
): Promise<(PricingCoupon & { id: string }) | null> {
  const [row] = await db.select().from(coupons).where(eq(coupons.code, code.trim())).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    maxDiscount: row.maxDiscount,
    minSubtotal: row.minSubtotal,
    scope: (row.scope ?? {}) as CouponScope,
    excludeSaleItems: row.excludeSaleItems,
  };
}

/**
 * Keeps the order's redemption in step with an edit: `amount = null` drops the coupon (the
 * redemption row is deleted and `used_count` given back, so the customer may use it again);
 * otherwise the redeemed value is updated. Locks the coupon row like `redeemCoupon`.
 */
export async function syncOrderRedemption(
  tx: Tx,
  input: { orderId: string; amount: number | null },
): Promise<void> {
  const [redemption] = await tx
    .select()
    .from(couponRedemptions)
    .where(eq(couponRedemptions.orderId, input.orderId))
    .limit(1);
  if (!redemption) return;
  if (input.amount === null) {
    await tx
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.id, redemption.couponId))
      .for('update');
    await tx.delete(couponRedemptions).where(eq(couponRedemptions.id, redemption.id));
    await tx
      .update(coupons)
      .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
      .where(eq(coupons.id, redemption.couponId));
    return;
  }
  if (redemption.amount !== input.amount) {
    await tx
      .update(couponRedemptions)
      .set({ amount: input.amount })
      .where(eq(couponRedemptions.id, redemption.id));
  }
}
