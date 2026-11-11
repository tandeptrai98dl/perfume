import { priceCart, type PricingCoupon } from '@/server/modules/checkout/pricing';
import type { CouponLookup } from '@/server/modules/promotion';

import type { CartLine, CartRow } from './queries';
import { freeShippingProgress, lineCap, type CouponRejectionDetail } from './rules';
import type { CartLineView, CartView } from './types';

export type CartViewInput = {
  cart: Pick<CartRow, 'id' | 'couponCode' | 'giftWrap' | 'giftMessage' | 'hidePrices'> | null;
  lines: readonly CartLine[];
  maxQuantityPerLine: number;
  giftWrapFee: number;
  freeShippingThreshold: number | null;
  /** Result of `findCoupon` for `cart.couponCode` (null when the cart has no coupon). */
  coupon: CouponLookup | null;
};

export function emptyCartView(input: {
  maxQuantityPerLine: number;
  giftWrapFee: number;
  freeShippingThreshold: number | null;
}): CartView {
  return buildCartView({ ...input, cart: null, lines: [], coupon: null });
}

function lineView(line: CartLine, maxPerLine: number): CartLineView {
  const maxQuantity = line.purchasable ? lineCap(line.available, maxPerLine) : 0;
  const unavailable = !line.purchasable || line.available <= 0;
  return {
    itemId: line.itemId,
    variantId: line.variantId,
    productId: line.productId,
    sku: line.sku,
    sizeMl: line.sizeMl,
    variantType: line.variantType,
    productName: line.productName,
    productSlug: line.productSlug,
    brandName: line.brandName,
    imageStorageKey: line.imageStorageKey,
    imageUrl: line.imageUrl,
    unitPrice: line.unitPrice,
    compareAtPrice: line.compareAtPrice,
    priceWhenAdded: line.priceWhenAdded,
    quantity: line.quantity,
    lineTotal: line.unitPrice * line.quantity,
    maxQuantity,
    available: line.available,
    issues: {
      priceChanged: line.priceWhenAdded !== line.unitPrice,
      unavailable,
      overStock: !unavailable && line.quantity > maxQuantity,
    },
  };
}

/**
 * Cart totals and flags (pure). Prices are the live catalogue prices from `getCartLines`;
 * totals come only from `priceCart` (§3.4). Unavailable lines are shown but not priced.
 * Shipping is unknown before an address, so `total` excludes it.
 */
export function buildCartView(input: CartViewInput): CartView {
  const lines = input.lines.map((line) => lineView(line, input.maxQuantityPerLine));
  const priced = input.lines.filter((_, index) => !lines[index]!.issues.unavailable);

  let pricingCoupon: PricingCoupon | null = null;
  let rejection: CouponRejectionDetail | undefined;
  if (input.cart?.couponCode && input.coupon) {
    if (input.coupon.ok) pricingCoupon = input.coupon.coupon;
    else rejection = { reason: input.coupon.reason };
  }

  const pricing = priceCart({
    lines: priced,
    coupon: pricingCoupon,
    shippingRate: null,
    giftWrap: { enabled: !!input.cart?.giftWrap, fee: input.giftWrapFee },
  });

  if (pricing.coupon && !pricing.coupon.applied && pricing.coupon.rejection) {
    rejection =
      pricing.coupon.rejection === 'min_subtotal'
        ? {
            reason: 'min_subtotal',
            minSubtotal: pricingCoupon?.minSubtotal ?? 0,
            missing: (pricingCoupon?.minSubtotal ?? 0) - pricing.subtotal,
          }
        : { reason: pricing.coupon.rejection };
  }

  const couponApplied = !!pricing.coupon?.applied;
  const freeShippingCoupon = couponApplied && pricingCoupon?.type === 'free_shipping';
  const merchandise = pricing.subtotal - pricing.discountTotal;

  return {
    cartId: input.cart?.id ?? null,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines,
    subtotal: pricing.subtotal,
    discountTotal: pricing.discountTotal,
    giftWrapFee: pricing.giftWrapFee,
    total: pricing.total,
    coupon: input.cart?.couponCode
      ? {
          code: pricingCoupon?.code ?? input.cart.couponCode,
          applied: couponApplied,
          freeShipping: freeShippingCoupon,
          ...(rejection ? { rejection } : {}),
        }
      : null,
    gift: {
      wrap: !!input.cart?.giftWrap,
      message: input.cart?.giftMessage ?? null,
      hidePrices: !!input.cart?.hidePrices,
      fee: input.giftWrapFee,
    },
    freeShipping:
      lines.length === 0
        ? null
        : freeShippingProgress(merchandise, input.freeShippingThreshold, freeShippingCoupon),
    maxQuantityPerLine: input.maxQuantityPerLine,
    canCheckout:
      lines.length > 0 && lines.every((line) => !line.issues.unavailable && !line.issues.overStock),
  };
}
