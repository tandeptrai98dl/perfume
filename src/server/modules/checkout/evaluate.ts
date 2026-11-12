import { inArray, sql } from 'drizzle-orm';

import type { Locale } from '@/i18n/routing';
import type { Database } from '@/server/db/client';
import { productVariants } from '@/server/db/schema';
import type { FieldIssue } from '@/server/lib/command-context';
import { getCartLines, type CartLine, type CartRow } from '@/server/modules/cart';
import { findCoupon, type CouponRejectionReason } from '@/server/modules/promotion';
import { getCommerceSettings, type CommerceSettings } from '@/server/modules/settings';
import { quoteShipping, type ShippingQuote } from '@/server/modules/shipping';

import { variantLabel, type SnapshotVariantType } from './labels';
import { getVariantLines, type LineRequest } from './manual-lines';
import { priceCart, type CouponRejection, type PricingCoupon, type PricingResult } from './pricing';
import { checkCartLines, type OrderPaymentMethod } from './rules';

/*
 * Loads everything a checkout price depends on and prices it with `priceCart` — the same code
 * for the live order summary (`quoteCheckout`) and inside the `placeOrder` transaction, so the
 * buyer sees exactly what is charged. Nothing here trusts the client: lines and prices come
 * from the cart and the catalogue, the shipping rate must still match the province and parcel
 * weight, and the coupon is re-checked (dates, limits, per-customer use).
 */

type Executor = Pick<Database, 'select' | 'execute'>;

export type CouponIssueCode =
  | 'couponNotFound'
  | 'couponInactive'
  | 'couponNotStarted'
  | 'couponExpired'
  | 'couponUsageLimit'
  | 'couponPerCustomerLimit'
  | 'couponMinSubtotal'
  | 'couponNoEligibleItems'
  /** Too many different codes tried on this cart (§12 coupon attempts); set by the caller. */
  | 'couponRateLimited';

const COUPON_ISSUES: Record<CouponRejectionReason | CouponRejection, CouponIssueCode> = {
  not_found: 'couponNotFound',
  inactive: 'couponInactive',
  not_started: 'couponNotStarted',
  expired: 'couponExpired',
  usage_limit: 'couponUsageLimit',
  per_customer_limit: 'couponPerCustomerLimit',
  min_subtotal: 'couponMinSubtotal',
  no_eligible_items: 'couponNoEligibleItems',
};

export function couponIssueCode(reason: CouponRejectionReason | CouponRejection): CouponIssueCode {
  return COUPON_ISSUES[reason];
}

export type EvaluateInput = {
  /** Web checkout: the lines (and gift wrap) come from the cart. */
  cart?: Pick<CartRow, 'id' | 'giftWrap'>;
  /** Manual (staff) orders: the variants picked on the form, without a cart (§3.4 step 7). */
  items?: readonly LineRequest[];
  locale: Locale;
  provinceCode?: string | null;
  shippingRateId?: string | null;
  paymentMethod?: OrderPaymentMethod | null;
  couponCode?: string | null;
  customer?: { phone?: string; email?: string; userId?: string | null };
  /**
   * Inside `placeOrder`: serialize checkouts using the same coupon (transaction-scoped advisory
   * lock) so its per-customer limit cannot be beaten by two concurrent orders.
   */
  lockCoupon?: boolean;
  /** Live summary: fall back to the first offered rate when none (or a stale one) is chosen. */
  defaultRate?: boolean;
  now?: Date;
};

export type EvaluatedLine = CartLine & { variantLabel: string };

export type CheckoutEvaluation = {
  lines: EvaluatedLine[];
  lineIssues: FieldIssue[];
  settings: CommerceSettings;
  /** Rates for the province and parcel weight (empty without a province). */
  quotes: ShippingQuote[];
  /** The chosen rate when it is still offered for this province and weight. */
  rate: ShippingQuote | null;
  coupon: (PricingCoupon & { id: string }) | null;
  couponIssue: CouponIssueCode | null;
  pricing: PricingResult;
};

/** Adds the localized size label ("100 ml", "Travel 10 ml") from the variant type. */
async function withVariantLabels(
  db: Executor,
  lines: CartLine[],
  locale: Locale,
): Promise<EvaluatedLine[]> {
  if (lines.length === 0) return [];
  const rows = await db
    .select({ id: productVariants.id, variantType: productVariants.variantType })
    .from(productVariants)
    .where(
      inArray(
        productVariants.id,
        lines.map((line) => line.variantId),
      ),
    );
  const types = new Map(rows.map((row) => [row.id, row.variantType as SnapshotVariantType]));
  return lines.map((line) => ({
    ...line,
    variantLabel: variantLabel(locale, types.get(line.variantId) ?? 'full_size', line.sizeMl),
  }));
}

/** Transaction-scoped lock per coupon code (released at commit/rollback). */
async function lockCouponCode(db: Executor, code: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`coupon:${code.trim().toLowerCase()}`}))`,
  );
}

export async function evaluateCheckout(
  db: Executor,
  input: EvaluateInput,
): Promise<CheckoutEvaluation> {
  const [cartLines, settings] = await Promise.all([
    input.items
      ? getVariantLines(db, { items: input.items, locale: input.locale })
      : input.cart
        ? getCartLines(db, { cartId: input.cart.id, locale: input.locale })
        : Promise.resolve([]),
    getCommerceSettings(db),
  ]);
  const giftWrap = input.cart?.giftWrap ?? false;
  const lines = await withVariantLabels(db, cartLines, input.locale);
  const lineIssues = checkCartLines(lines, settings.cart.maxQuantityPerLine);
  const weightG = lines.reduce((sum, line) => sum + line.weightG * line.quantity, 0);

  const quotes = input.provinceCode
    ? await quoteShipping(db, { provinceCode: input.provinceCode, weightG, locale: input.locale })
    : [];
  const rate =
    quotes.find((quote) => quote.rateId === input.shippingRateId) ??
    (input.defaultRate ? (quotes[0] ?? null) : null);

  let coupon: CheckoutEvaluation['coupon'] = null;
  let couponIssue: CouponIssueCode | null = null;
  const code = input.couponCode?.trim();
  if (code) {
    if (input.lockCoupon) await lockCouponCode(db, code);
    const found = await findCoupon(db, code, { now: input.now, customer: input.customer });
    if (found.ok) coupon = found.coupon;
    else couponIssue = couponIssueCode(found.reason);
  }

  const price = (withCoupon: PricingCoupon | null) =>
    priceCart({
      lines,
      coupon: withCoupon,
      shippingRate: rate ? { fee: rate.fee, freeOverSubtotal: rate.freeOverSubtotal } : null,
      giftWrap: { enabled: giftWrap, fee: settings.giftWrapFee },
      cod: {
        maxOrderWithoutDeposit: settings.cod.maxOrderWithoutDeposit,
        depositPercent: settings.cod.depositPercent,
      },
      paymentMethod: input.paymentMethod === 'cod' ? 'cod' : 'online',
    });

  let pricing = price(coupon);
  if (pricing.coupon && !pricing.coupon.applied && pricing.coupon.rejection) {
    couponIssue = couponIssueCode(pricing.coupon.rejection);
    coupon = null;
    pricing = price(null);
  }

  return { lines, lineIssues, settings, quotes, rate, coupon, couponIssue, pricing };
}
