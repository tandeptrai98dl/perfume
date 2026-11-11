import { and, eq, or, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { couponRedemptions, coupons } from '@/server/db/schema';
import { DomainError, type Tx } from '@/server/lib/command-context';
import type { CouponScope, PricingCoupon } from '@/server/modules/checkout/pricing';

/**
 * Coupon lookup, eligibility and redemption (§10.3, §12 abuse: once per phone). Admin coupon
 * CRUD lives in the admin stream (`commands.ts`). Pricing itself is in `checkout/pricing.ts`.
 */

export type CouponRejectionReason =
  'not_found' | 'inactive' | 'not_started' | 'expired' | 'usage_limit' | 'per_customer_limit';

export type CouponLookup =
  | { ok: true; coupon: PricingCoupon & { id: string } }
  | { ok: false; reason: CouponRejectionReason };

type Executor = Pick<Database, 'select'>;

/**
 * Loads a coupon by code (case-insensitive) and checks dates and limits. When `customer` is
 * given, the per-customer limit counts past redemptions by phone, email or user.
 * Minimum subtotal and scope are checked by `priceCart`.
 */
export async function findCoupon(
  db: Executor,
  code: string,
  options: {
    now?: Date;
    customer?: { phone?: string; email?: string; userId?: string | null };
  } = {},
): Promise<CouponLookup> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: 'not_found' };
  const [row] = await db.select().from(coupons).where(eq(coupons.code, trimmed)).limit(1);
  if (!row) return { ok: false, reason: 'not_found' };
  const now = options.now ?? new Date();
  if (!row.isActive) return { ok: false, reason: 'inactive' };
  if (row.startsAt && row.startsAt > now) return { ok: false, reason: 'not_started' };
  if (row.endsAt && row.endsAt <= now) return { ok: false, reason: 'expired' };
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit)
    return { ok: false, reason: 'usage_limit' };

  const customer = options.customer;
  if (row.perCustomerLimit !== null && customer) {
    const matches = [
      customer.phone ? eq(couponRedemptions.phone, customer.phone) : undefined,
      customer.email ? eq(couponRedemptions.email, customer.email) : undefined,
      customer.userId ? eq(couponRedemptions.userId, customer.userId) : undefined,
    ].filter((c) => c !== undefined);
    if (matches.length > 0) {
      const [used] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(couponRedemptions)
        .where(and(eq(couponRedemptions.couponId, row.id), or(...matches)));
      if ((used?.n ?? 0) >= row.perCustomerLimit)
        return { ok: false, reason: 'per_customer_limit' };
    }
  }

  return {
    ok: true,
    coupon: {
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      maxDiscount: row.maxDiscount,
      minSubtotal: row.minSubtotal,
      scope: (row.scope ?? {}) as CouponScope,
      excludeSaleItems: row.excludeSaleItems,
    },
  };
}

/**
 * Records a redemption inside `placeOrder`'s transaction. Locks the coupon row and re-checks the
 * global usage limit so two concurrent checkouts cannot exceed it.
 */
export async function redeemCoupon(
  tx: Tx,
  input: {
    couponId: string;
    orderId: string;
    userId: string | null;
    phone: string;
    email: string;
    amount: number;
  },
): Promise<void> {
  const [row] = await tx.select().from(coupons).where(eq(coupons.id, input.couponId)).for('update');
  if (!row || !row.isActive)
    throw new DomainError('invalid', [{ path: 'couponCode', code: 'inactive' }]);
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) {
    throw new DomainError('invalid', [{ path: 'couponCode', code: 'usage_limit' }]);
  }
  await tx
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(eq(coupons.id, row.id));
  await tx.insert(couponRedemptions).values(input);
}

// Coupons of existing orders (order-edits stream, wave 2).
export { getCouponTerms, syncOrderRedemption } from './redemptions';

// ---------- Admin (admin-orders stream): coupon management ----------
export { promotionTags, saveCoupon, setCouponActive } from './commands';
export {
  getCouponForEdit,
  listCoupons,
  type AdminCouponRow,
  type CouponForEdit,
  type CouponListQuery,
  type CouponUsage,
} from './admin-queries';
export {
  COUPON_CODE,
  COUPON_SORTS,
  COUPON_STATES,
  COUPON_TYPES,
  couponActiveSchema,
  couponSchema,
  couponScopeSchema,
  couponState,
  type CouponActiveInput,
  type CouponInput,
  type CouponScopeInput,
  type CouponSort,
  type CouponState,
  type CouponTypeValue,
} from './admin-schemas';
// ---------- End admin ----------
