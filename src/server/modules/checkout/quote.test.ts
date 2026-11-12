import { describe, expect, it } from 'vitest';

import { isCouponAttempt, withCouponRateLimited, type CheckoutQuote } from './quote';

describe('coupon attempts through the live checkout quote (§12)', () => {
  it('counts a new code, not the one already applied to the cart', () => {
    expect(isCouponAttempt('WELCOME10', null)).toBe(true);
    expect(isCouponAttempt('welcome10', 'WELCOME10')).toBe(false);
    expect(isCouponAttempt(' WELCOME10 ', 'WELCOME10')).toBe(false);
    expect(isCouponAttempt('OTHER', 'WELCOME10')).toBe(true);
    expect(isCouponAttempt('', 'WELCOME10')).toBe(false);
    expect(isCouponAttempt('   ', null)).toBe(false);
    expect(isCouponAttempt(null, null)).toBe(false);
  });

  it('answers a limited attempt as not applied, without evaluating the code', () => {
    const quote = { coupon: null, totals: { total: 100_000 } } as unknown as CheckoutQuote;
    expect(withCouponRateLimited(quote, ' GUESS1 ')).toMatchObject({
      coupon: { code: 'GUESS1', applied: false, issue: 'couponRateLimited' },
      totals: { total: 100_000 },
    });
  });
});
