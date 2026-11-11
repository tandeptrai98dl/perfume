import { describe, expect, it } from 'vitest';

import type { CouponLookup } from '@/server/modules/promotion';

import type { CartLine } from './queries';
import { buildCartView, emptyCartView } from './view';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    itemId: 'i1',
    variantId: 'v1',
    productId: 'p1',
    brandId: 'b1',
    categoryIds: [],
    sku: 'SKU-1',
    sizeMl: 100,
    variantType: 'full_size',
    productName: 'Cèdre Nocturne EDT',
    productSlug: 'cedre',
    brandName: 'Maison Lumière',
    imageStorageKey: null,
    imageUrl: null,
    unitPrice: 1_000_000,
    compareAtPrice: null,
    priceWhenAdded: 1_000_000,
    quantity: 1,
    weightG: 400,
    available: 10,
    purchasable: true,
    ...overrides,
  };
}

const context = { maxQuantityPerLine: 5, giftWrapFee: 50_000, freeShippingThreshold: 2_000_000 };
const cart = {
  id: 'c1',
  couponCode: null as string | null,
  giftWrap: false,
  giftMessage: null,
  hidePrices: false,
};

const welcome: CouponLookup = {
  ok: true,
  coupon: {
    id: 'k1',
    code: 'WELCOME10',
    type: 'percent',
    value: 10,
    maxDiscount: 200_000,
    minSubtotal: null,
    scope: {},
    excludeSaleItems: false,
  },
};

describe('buildCartView', () => {
  it('prices lines, applies the coupon and gift wrap, and leaves shipping to checkout', () => {
    const view = buildCartView({
      ...context,
      cart: { ...cart, couponCode: 'welcome10', giftWrap: true },
      lines: [line({ quantity: 2 })],
      coupon: welcome,
    });
    expect(view).toMatchObject({
      itemCount: 2,
      subtotal: 2_000_000,
      discountTotal: 200_000,
      giftWrapFee: 50_000,
      total: 1_850_000,
      coupon: { code: 'WELCOME10', applied: true, freeShipping: false },
      freeShipping: { remaining: 200_000, unlocked: false, percent: 90 },
      canCheckout: true,
    });
  });

  it('flags price changes, unavailable and over-stock lines and blocks checkout', () => {
    const view = buildCartView({
      ...context,
      cart,
      lines: [
        line({ itemId: 'a', priceWhenAdded: 900_000 }),
        line({ itemId: 'b', variantId: 'v2', purchasable: false }),
        line({ itemId: 'c', variantId: 'v3', quantity: 4, available: 2 }),
        line({ itemId: 'd', variantId: 'v4', available: 0 }),
      ],
      coupon: null,
    });
    expect(view.lines.map((l) => [l.itemId, l.issues, l.maxQuantity])).toEqual([
      ['a', { priceChanged: true, unavailable: false, overStock: false }, 5],
      ['b', { priceChanged: false, unavailable: true, overStock: false }, 0],
      ['c', { priceChanged: false, unavailable: false, overStock: true }, 2],
      ['d', { priceChanged: false, unavailable: true, overStock: false }, 0],
    ]);
    // Unavailable lines are not priced.
    expect(view.subtotal).toBe(1_000_000 + 4_000_000);
    expect(view.canCheckout).toBe(false);
  });

  it('keeps a stored coupon that no longer applies, with the reason', () => {
    const minSubtotal: CouponLookup = {
      ok: true,
      coupon: {
        ...welcome.coupon,
        code: 'FREESHIP',
        type: 'free_shipping',
        minSubtotal: 1_500_000,
      },
    };
    const below = buildCartView({
      ...context,
      cart: { ...cart, couponCode: 'FREESHIP' },
      lines: [line()],
      coupon: minSubtotal,
    });
    expect(below.coupon).toEqual({
      code: 'FREESHIP',
      applied: false,
      freeShipping: false,
      rejection: { reason: 'min_subtotal', minSubtotal: 1_500_000, missing: 500_000 },
    });
    const above = buildCartView({
      ...context,
      cart: { ...cart, couponCode: 'FREESHIP' },
      lines: [line({ quantity: 2 })],
      coupon: minSubtotal,
    });
    expect(above.coupon).toMatchObject({ applied: true, freeShipping: true });
    expect(above.freeShipping?.unlocked).toBe(true);

    const expired = buildCartView({
      ...context,
      cart: { ...cart, couponCode: 'OLD' },
      lines: [line()],
      coupon: { ok: false, reason: 'expired' },
    });
    expect(expired.coupon).toMatchObject({ applied: false, rejection: { reason: 'expired' } });
    expect(expired.discountTotal).toBe(0);
  });

  it('builds an empty view without a cart', () => {
    expect(emptyCartView(context)).toMatchObject({
      cartId: null,
      itemCount: 0,
      lines: [],
      total: 0,
      coupon: null,
      freeShipping: null,
      canCheckout: false,
    });
  });
});
