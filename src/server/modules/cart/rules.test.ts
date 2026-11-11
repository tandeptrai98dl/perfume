import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../../messages/en.json';
import vi from '../../../../messages/vi.json';
import { formats } from '@/i18n/formats';

import {
  capAddition,
  capUpdate,
  COUPON_REJECTIONS,
  couponRejectionMessage,
  freeShippingProgress,
  lineCap,
  mergeCartItems,
  mergeCartOptions,
  normalizeGiftMessage,
} from './rules';

describe('line cap', () => {
  it('is min(available stock, per-line limit) and never negative', () => {
    expect(lineCap(12, 5)).toBe(5);
    expect(lineCap(3, 5)).toBe(3);
    expect(lineCap(0, 5)).toBe(0);
    expect(lineCap(-2, 5)).toBe(0);
  });

  it('caps additions and reports when the request was reduced', () => {
    expect(capAddition(0, 1, 5)).toEqual({ ok: true, quantity: 1, capped: false });
    expect(capAddition(3, 4, 5)).toEqual({ ok: true, quantity: 5, capped: true });
    expect(capAddition(5, 1, 5)).toEqual({ ok: false, reason: 'limit_reached', max: 5 });
    expect(capAddition(0, 1, 0)).toEqual({ ok: false, reason: 'out_of_stock', max: 0 });
  });

  it('lets a stepper lower an over-stock line but never raise it past the cap', () => {
    expect(capUpdate(2, 3)).toEqual({ ok: true, quantity: 2, capped: false });
    expect(capUpdate(9, 3)).toEqual({ ok: true, quantity: 3, capped: true });
    expect(capUpdate(1, 0)).toEqual({ ok: false, reason: 'out_of_stock', max: 0 });
  });
});

describe('merge on sign-in', () => {
  const caps: Record<string, number> = { a: 5, b: 2, c: 0, d: 5 };
  const capOf = (id: string) => caps[id] ?? 0;

  it('sums quantities, caps by stock/limit and keeps the member price when both have a line', () => {
    const writes = mergeCartItems(
      [
        { variantId: 'a', quantity: 2, priceWhenAdded: 100 },
        { variantId: 'b', quantity: 1, priceWhenAdded: 200 },
        { variantId: 'x', quantity: 1, priceWhenAdded: 1 },
      ],
      [
        { variantId: 'a', quantity: 4, priceWhenAdded: 110 },
        { variantId: 'b', quantity: 3, priceWhenAdded: 210 },
        { variantId: 'd', quantity: 2, priceWhenAdded: 400 },
      ],
      capOf,
    );
    expect(writes).toEqual([
      { variantId: 'a', quantity: 5, priceWhenAdded: 100 },
      { variantId: 'b', quantity: 2, priceWhenAdded: 200 },
      { variantId: 'd', quantity: 2, priceWhenAdded: 400 },
    ]);
  });

  it('keeps an unavailable guest line visible instead of dropping it', () => {
    expect(mergeCartItems([], [{ variantId: 'c', quantity: 2, priceWhenAdded: 9 }], capOf)).toEqual(
      [{ variantId: 'c', quantity: 2, priceWhenAdded: 9 }],
    );
    expect(
      mergeCartItems(
        [{ variantId: 'c', quantity: 3, priceWhenAdded: 9 }],
        [{ variantId: 'c', quantity: 1, priceWhenAdded: 9 }],
        capOf,
      ),
    ).toEqual([]);
  });

  it('prefers the guest coupon and gift options when set', () => {
    const member = { couponCode: 'OLD', giftWrap: true, giftMessage: 'A', hidePrices: false };
    const empty = { couponCode: null, giftWrap: false, giftMessage: null, hidePrices: false };
    expect(mergeCartOptions(member, empty)).toEqual(member);
    expect(
      mergeCartOptions(member, { ...empty, couponCode: 'NEW', giftMessage: 'B', hidePrices: true }),
    ).toEqual({ couponCode: 'NEW', giftWrap: false, giftMessage: 'B', hidePrices: true });
  });
});

describe('coupon rejection messages', () => {
  const locales = { vi, en } as const;

  it.each(Object.keys(locales) as (keyof typeof locales)[])(
    'has a %s message for every reason',
    (locale) => {
      const t = createTranslator({
        locale,
        messages: locales[locale],
        namespace: 'cart.coupon',
        formats,
      });
      for (const reason of COUPON_REJECTIONS) {
        const { key, values } = couponRejectionMessage({
          reason,
          minSubtotal: 1_000_000,
          missing: 250_000,
        });
        const text = t(key, values);
        expect(text, `${locale}:${reason}`).not.toContain('cart.coupon');
        expect(text.length).toBeGreaterThan(5);
      }
    },
  );

  it('tells how much is missing for a minimum subtotal', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'cart.coupon', formats });
    const { key, values } = couponRejectionMessage({
      reason: 'min_subtotal',
      minSubtotal: 1_000_000,
      missing: 250_000,
    });
    expect(t(key, values)).toContain('250,000');
    const tv = createTranslator({ locale: 'vi', messages: vi, namespace: 'cart.coupon', formats });
    expect(tv(key, values)).toContain('250.000');
  });
});

describe('free-shipping progress', () => {
  it('shows the remaining amount until the threshold', () => {
    expect(freeShippingProgress(1_500_000, 2_000_000, false)).toEqual({
      threshold: 2_000_000,
      remaining: 500_000,
      percent: 75,
      unlocked: false,
    });
    expect(freeShippingProgress(2_000_000, 2_000_000, false)?.unlocked).toBe(true);
    expect(freeShippingProgress(10, 2_000_000, true)?.unlocked).toBe(true);
    expect(freeShippingProgress(10, null, false)).toBeNull();
  });
});

describe('gift message', () => {
  it('trims, strips control characters and maps empty to null', () => {
    expect(normalizeGiftMessage('  Chúc mừng\r\nsinh nhật\u0007 ')).toBe('Chúc mừng\nsinh nhật');
    expect(normalizeGiftMessage('   ')).toBeNull();
    expect(normalizeGiftMessage(null)).toBeNull();
  });
});
