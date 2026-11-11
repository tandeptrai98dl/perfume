import { describe, expect, it } from 'vitest';

import { allocate, codDeposit, priceCart, type PricingCoupon, type PricingLine } from './pricing';

const line = (overrides: Partial<PricingLine> = {}): PricingLine => ({
  variantId: 'v1',
  productId: 'p1',
  brandId: 'b1',
  categoryIds: ['c1'],
  unitPrice: 3_200_000,
  compareAtPrice: null,
  quantity: 1,
  weightG: 400,
  ...overrides,
});

const coupon = (overrides: Partial<PricingCoupon> = {}): PricingCoupon => ({
  code: 'WELCOME10',
  type: 'percent',
  value: 10,
  maxDiscount: 200_000,
  minSubtotal: null,
  scope: {},
  excludeSaleItems: false,
  ...overrides,
});

const standard = { fee: 30_000, freeOverSubtotal: 2_000_000 };

describe('priceCart', () => {
  it('adds shipping and gift wrap, all in integer VND', () => {
    const result = priceCart({
      lines: [line({ unitPrice: 1_500_000 })],
      shippingRate: standard,
      giftWrap: { enabled: true, fee: 50_000 },
    });
    expect(result).toMatchObject({
      subtotal: 1_500_000,
      shippingFee: 30_000,
      giftWrapFee: 50_000,
      total: 1_580_000,
      weightG: 400,
    });
  });

  it('caps a percent coupon and allocates it to lines exactly', () => {
    const result = priceCart({
      lines: [line(), line({ variantId: 'v2', unitPrice: 1_000_001, quantity: 1 })],
      coupon: coupon(),
      shippingRate: standard,
    });
    expect(result.discountTotal).toBe(200_000);
    expect(Object.values(result.lineDiscounts).reduce((a, b) => a + b, 0)).toBe(200_000);
    // Free shipping threshold uses the merchandise total after discount.
    expect(result.shippingFee).toBe(0);
    expect(result.total).toBe(3_200_000 + 1_000_001 - 200_000);
  });

  it('respects scope and sale exclusion', () => {
    const result = priceCart({
      lines: [
        line({ variantId: 'sale', compareAtPrice: 4_000_000 }),
        line({ variantId: 'other-brand', brandId: 'b2', unitPrice: 1_000_000 }),
        line({ variantId: 'ok', unitPrice: 1_000_000 }),
      ],
      coupon: coupon({ maxDiscount: null, scope: { brandIds: ['b1'] }, excludeSaleItems: true }),
    });
    expect(result.discountTotal).toBe(100_000);
    expect(result.lineDiscounts).toEqual({ sale: 0, 'other-brand': 0, ok: 100_000 });
  });

  it('rejects a coupon below its minimum subtotal or with no eligible items', () => {
    expect(
      priceCart({ lines: [line()], coupon: coupon({ minSubtotal: 5_000_000 }) }).coupon,
    ).toEqual({
      code: 'WELCOME10',
      applied: false,
      rejection: 'min_subtotal',
    });
    expect(
      priceCart({ lines: [line()], coupon: coupon({ scope: { productIds: ['nope'] } }) }).coupon
        ?.rejection,
    ).toBe('no_eligible_items');
  });

  it('never discounts more than the eligible amount', () => {
    const result = priceCart({
      lines: [line({ unitPrice: 100_000 })],
      coupon: coupon({ type: 'fixed', value: 500_000, maxDiscount: null }),
    });
    expect(result.discountTotal).toBe(100_000);
    expect(result.total).toBe(0);
  });

  it('applies free-shipping coupons to the chosen rate', () => {
    const result = priceCart({
      lines: [line({ unitPrice: 500_000 })],
      coupon: coupon({ type: 'free_shipping', value: 0 }),
      shippingRate: { fee: 50_000, freeOverSubtotal: null },
    });
    expect(result).toMatchObject({ shippingFee: 0, shippingDiscount: 50_000, total: 500_000 });
  });

  it('leaves shipping unknown until a rate is chosen', () => {
    expect(priceCart({ lines: [line()] }).shippingFee).toBeNull();
  });

  it('requires a 20% COD deposit above the threshold (ADR-0016)', () => {
    const cod = { maxOrderWithoutDeposit: 5_000_000, depositPercent: 20 };
    const small = priceCart({ lines: [line()], shippingRate: standard, cod, paymentMethod: 'cod' });
    expect(small.depositRequired).toBe(0);
    const big = priceCart({
      lines: [line({ quantity: 2 })],
      shippingRate: standard,
      cod,
      paymentMethod: 'cod',
    });
    expect(big.total).toBe(6_400_000);
    expect(big.depositRequired).toBe(1_280_000);
    expect(
      priceCart({ lines: [line({ quantity: 2 })], cod, paymentMethod: 'online' }).depositRequired,
    ).toBe(0);
  });
});

describe('allocate / codDeposit', () => {
  it('splits with the remainder on the largest line', () => {
    expect(
      allocate(100, [
        { id: 'a', total: 1 },
        { id: 'b', total: 2 },
      ]),
    ).toEqual({ a: 33, b: 67 });
  });

  it('rounds deposits up to 1,000 ₫', () => {
    expect(codDeposit(5_000_001, { maxOrderWithoutDeposit: 5_000_000, depositPercent: 20 })).toBe(
      1_001_000,
    );
  });
});
