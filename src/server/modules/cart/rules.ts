import type { CouponRejection } from '@/server/modules/checkout/pricing';
import type { CouponRejectionReason } from '@/server/modules/promotion';

/*
 * Pure cart rules (§10.3): per-line quantity cap, merge on sign-in and coupon rejection
 * reasons. No I/O, so they are unit tested in isolation and shared by commands and views.
 */

/** Gift card message limit (also a DB CHECK on `carts.gift_message`). */
export const GIFT_MESSAGE_MAX_LENGTH = 200;

/** Upper bound accepted from clients before the real cap applies (defence against abuse). */
export const MAX_REQUESTED_QUANTITY = 99;

/** Highest quantity a line may hold: min(available stock, configured per-line limit). */
export function lineCap(available: number, maxPerLine: number): number {
  return Math.max(0, Math.min(Math.floor(available), Math.floor(maxPerLine)));
}

export type CapResult =
  | { ok: true; quantity: number; capped: boolean }
  | { ok: false; reason: 'out_of_stock' | 'limit_reached'; max: number };

/**
 * Quantity after adding `requested` units to a line already holding `existing` units.
 * Never exceeds the cap; fails when nothing can be added.
 */
export function capAddition(existing: number, requested: number, cap: number): CapResult {
  if (cap <= 0) return { ok: false, reason: 'out_of_stock', max: 0 };
  if (existing >= cap) return { ok: false, reason: 'limit_reached', max: cap };
  const wanted = existing + requested;
  const quantity = Math.min(wanted, cap);
  return { ok: true, quantity, capped: quantity < wanted };
}

/** Quantity set directly on an existing line (stepper). Decreasing always works while in stock. */
export function capUpdate(requested: number, cap: number): CapResult {
  if (cap <= 0) return { ok: false, reason: 'out_of_stock', max: 0 };
  const quantity = Math.min(requested, cap);
  return { ok: true, quantity, capped: quantity < requested };
}

export type MergeItem = { variantId: string; quantity: number; priceWhenAdded: number };

/**
 * Merge of a guest cart into a member cart on sign-in (§10.3): quantities are summed and
 * capped by stock and the per-line limit. Returns the member lines to insert or update.
 * A line that cannot be bought right now keeps the larger of both quantities, so it stays
 * visible (flagged as unavailable) instead of disappearing silently. Lines only in the member
 * cart are left untouched; the member's `priceWhenAdded` wins for lines in both carts.
 */
export function mergeCartItems(
  member: readonly MergeItem[],
  guest: readonly MergeItem[],
  capOf: (variantId: string) => number,
): MergeItem[] {
  const byVariant = new Map(member.map((item) => [item.variantId, item]));
  const writes: MergeItem[] = [];
  for (const item of guest) {
    const existing = byVariant.get(item.variantId);
    const cap = capOf(item.variantId);
    const sum = (existing?.quantity ?? 0) + item.quantity;
    const quantity =
      cap > 0 ? Math.min(sum, cap) : Math.max(existing?.quantity ?? 0, item.quantity);
    if (existing && existing.quantity === quantity) continue;
    writes.push({
      variantId: item.variantId,
      quantity,
      priceWhenAdded: existing?.priceWhenAdded ?? item.priceWhenAdded,
    });
  }
  return writes;
}

export type CartOptions = {
  couponCode: string | null;
  giftWrap: boolean;
  giftMessage: string | null;
  hidePrices: boolean;
};

/**
 * Options kept after a merge: the guest cart reflects the customer's latest intent, so its
 * coupon and gift options win when set; otherwise the member cart's are kept.
 */
export function mergeCartOptions(member: CartOptions, guest: CartOptions): CartOptions {
  const guestHasGift = guest.giftWrap || !!guest.giftMessage || guest.hidePrices;
  return {
    couponCode: guest.couponCode ?? member.couponCode,
    ...(guestHasGift
      ? { giftWrap: guest.giftWrap, giftMessage: guest.giftMessage, hidePrices: guest.hidePrices }
      : {
          giftWrap: member.giftWrap,
          giftMessage: member.giftMessage,
          hidePrices: member.hidePrices,
        }),
  };
}

/** Every reason a coupon can be refused in the cart; each has a message in `cart.coupon.errors`. */
export const COUPON_REJECTIONS = [
  'not_found',
  'inactive',
  'not_started',
  'expired',
  'usage_limit',
  'per_customer_limit',
  'min_subtotal',
  'no_eligible_items',
  'empty_cart',
] as const satisfies readonly (CouponRejectionReason | CouponRejection | 'empty_cart')[];

export type CartCouponRejection = (typeof COUPON_REJECTIONS)[number];

/** Rejection with the values its message needs (e.g. the missing amount for `min_subtotal`). */
export type CouponRejectionDetail = {
  reason: CartCouponRejection;
  /** Minimum merchandise subtotal of the coupon (VND), for `min_subtotal`. */
  minSubtotal?: number;
  /** Amount still missing to reach `minSubtotal` (VND), for `min_subtotal`. */
  missing?: number;
};

/** Free-shipping progress before an address is known (§10.3: "X ₫ away from free shipping"). */
export function freeShippingProgress(
  merchandise: number,
  threshold: number | null,
  unlockedByCoupon: boolean,
): { threshold: number; remaining: number; percent: number; unlocked: boolean } | null {
  if (threshold === null || threshold <= 0) {
    return unlockedByCoupon ? { threshold: 0, remaining: 0, percent: 100, unlocked: true } : null;
  }
  const remaining = unlockedByCoupon ? 0 : Math.max(0, threshold - merchandise);
  const percent = remaining === 0 ? 100 : Math.floor((Math.max(0, merchandise) * 100) / threshold);
  return { threshold, remaining, percent, unlocked: remaining === 0 };
}

/** Normalises a gift message: NFC, trimmed, control characters removed, empty → null. */
export function normalizeGiftMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const cleaned = message
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
  return cleaned === '' ? null : cleaned;
}
