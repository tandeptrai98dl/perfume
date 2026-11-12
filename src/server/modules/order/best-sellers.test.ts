import { describe, expect, it } from 'vitest';

import { countsAsBestSeller } from './best-sellers';

describe('countsAsBestSeller', () => {
  it('counts paid or delivered orders, never cancelled or returned ones', () => {
    expect(countsAsBestSeller({ status: 'confirmed', paymentStatus: 'paid' })).toBe(true);
    expect(countsAsBestSeller({ status: 'delivered', paymentStatus: 'unpaid' })).toBe(true);
    expect(countsAsBestSeller({ status: 'return_requested', paymentStatus: 'unpaid' })).toBe(true);
    expect(countsAsBestSeller({ status: 'shipped', paymentStatus: 'partially_refunded' })).toBe(
      true,
    );
    expect(countsAsBestSeller({ status: 'pending', paymentStatus: 'unpaid' })).toBe(false);
    expect(countsAsBestSeller({ status: 'cancelled', paymentStatus: 'paid' })).toBe(false);
    expect(countsAsBestSeller({ status: 'returned', paymentStatus: 'paid' })).toBe(false);
  });
});
