/**
 * Server-side price computation for cart display and `placeOrder` (ARCHITECTURE.md §3.4:
 * "recompute every price on the server"). Pure and integer-only (VND, CLAUDE.md money rules).
 */

export type PricingLine = {
  variantId: string;
  productId: string;
  brandId: string;
  categoryIds: readonly string[];
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  weightG: number;
};

export type CouponType = 'percent' | 'fixed' | 'free_shipping';

export type CouponScope = {
  brandIds?: readonly string[];
  categoryIds?: readonly string[];
  productIds?: readonly string[];
};

/** Coupon already loaded and checked for dates/limits/customer usage by the promotion module. */
export type PricingCoupon = {
  code: string;
  type: CouponType;
  /** Whole percent for `percent`, VND for `fixed`. */
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  scope: CouponScope;
  excludeSaleItems: boolean;
};

export type PricingShippingRate = { fee: number; freeOverSubtotal: number | null };

export type PricingInput = {
  lines: readonly PricingLine[];
  coupon?: PricingCoupon | null;
  /** Null when no address/rate is chosen yet (cart page): shipping is shown as "calculated later". */
  shippingRate?: PricingShippingRate | null;
  giftWrap?: { enabled: boolean; fee: number };
  /** COD deposit rule (ADR-0016); only applied when `paymentMethod === 'cod'`. */
  cod?: { maxOrderWithoutDeposit: number; depositPercent: number };
  paymentMethod?: 'cod' | 'online';
};

export type CouponRejection = 'min_subtotal' | 'no_eligible_items';

export type PricingResult = {
  subtotal: number;
  /** Discount per variant, summing exactly to `discountTotal`. */
  lineDiscounts: Record<string, number>;
  discountTotal: number;
  shippingFee: number | null;
  shippingDiscount: number;
  giftWrapFee: number;
  total: number;
  depositRequired: number;
  weightG: number;
  coupon: { code: string; applied: boolean; rejection?: CouponRejection } | null;
};

function inScope(line: PricingLine, scope: CouponScope): boolean {
  const { brandIds = [], categoryIds = [], productIds = [] } = scope;
  if (brandIds.length === 0 && categoryIds.length === 0 && productIds.length === 0) return true;
  return (
    brandIds.includes(line.brandId) ||
    productIds.includes(line.productId) ||
    line.categoryIds.some((id) => categoryIds.includes(id))
  );
}

function isOnSale(line: PricingLine): boolean {
  return line.compareAtPrice !== null && line.compareAtPrice > line.unitPrice;
}

/**
 * Splits `amount` across lines proportionally to their totals; the rounding remainder goes to
 * the largest line so allocations always sum exactly to `amount`.
 */
export function allocate(
  amount: number,
  lines: readonly { id: string; total: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const base = lines.reduce((sum, line) => sum + line.total, 0);
  if (amount <= 0 || base <= 0) {
    for (const line of lines) out[line.id] = 0;
    return out;
  }
  let given = 0;
  for (const line of lines) {
    const share = Math.floor((amount * line.total) / base);
    out[line.id] = share;
    given += share;
  }
  const largest = [...lines].sort((a, b) => b.total - a.total)[0];
  if (largest) out[largest.id] = (out[largest.id] ?? 0) + (amount - given);
  return out;
}

/** Deposit rounded up to the next 1,000 ₫ (cleaner transfer amounts). */
export function codDeposit(
  total: number,
  rule: { maxOrderWithoutDeposit: number; depositPercent: number },
): number {
  if (total <= rule.maxOrderWithoutDeposit) return 0;
  return Math.ceil((total * rule.depositPercent) / 100 / 1000) * 1000;
}

export function priceCart(input: PricingInput): PricingResult {
  const lineTotals = input.lines.map((line) => ({
    id: line.variantId,
    total: line.unitPrice * line.quantity,
  }));
  const subtotal = lineTotals.reduce((sum, line) => sum + line.total, 0);
  const weightG = input.lines.reduce((sum, line) => sum + line.weightG * line.quantity, 0);

  let discountTotal = 0;
  let lineDiscounts: Record<string, number> = Object.fromEntries(lineTotals.map((l) => [l.id, 0]));
  let couponResult: PricingResult['coupon'] = null;
  let freeShipping = false;

  const coupon = input.coupon ?? null;
  if (coupon) {
    const eligible = input.lines.filter(
      (line) => inScope(line, coupon.scope) && !(coupon.excludeSaleItems && isOnSale(line)),
    );
    const eligibleTotals = eligible.map((line) => ({
      id: line.variantId,
      total: line.unitPrice * line.quantity,
    }));
    const eligibleSubtotal = eligibleTotals.reduce((sum, line) => sum + line.total, 0);

    if (coupon.minSubtotal !== null && subtotal < coupon.minSubtotal) {
      couponResult = { code: coupon.code, applied: false, rejection: 'min_subtotal' };
    } else if (coupon.type !== 'free_shipping' && eligibleSubtotal === 0) {
      couponResult = { code: coupon.code, applied: false, rejection: 'no_eligible_items' };
    } else {
      couponResult = { code: coupon.code, applied: true };
      if (coupon.type === 'free_shipping') {
        freeShipping = true;
      } else {
        let discount =
          coupon.type === 'percent'
            ? Math.floor((eligibleSubtotal * coupon.value) / 100)
            : Math.min(coupon.value, eligibleSubtotal);
        if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
        discountTotal = discount;
        lineDiscounts = { ...lineDiscounts, ...allocate(discount, eligibleTotals) };
      }
    }
  }

  const merchandise = subtotal - discountTotal;
  let shippingFee: number | null = null;
  let shippingDiscount = 0;
  if (input.shippingRate) {
    const rate = input.shippingRate;
    const free =
      freeShipping || (rate.freeOverSubtotal !== null && merchandise >= rate.freeOverSubtotal);
    shippingDiscount = free ? rate.fee : 0;
    shippingFee = free ? 0 : rate.fee;
  }

  const giftWrapFee = input.giftWrap?.enabled ? input.giftWrap.fee : 0;
  const total = merchandise + (shippingFee ?? 0) + giftWrapFee;
  const depositRequired =
    input.paymentMethod === 'cod' && input.cod ? codDeposit(total, input.cod) : 0;

  return {
    subtotal,
    lineDiscounts,
    discountTotal,
    shippingFee,
    shippingDiscount,
    giftWrapFee,
    total,
    depositRequired,
    weightG,
    coupon: couponResult,
  };
}
