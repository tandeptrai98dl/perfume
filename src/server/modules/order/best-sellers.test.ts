import { describe, expect, it } from 'vitest';

import { BEST_SELLER_WINDOW_DAYS, bestSellerWindowStart } from './best-sellers';

describe('bestSellerWindowStart', () => {
  it('starts at midnight in Vietnam, 90 days back', () => {
    // 2026-11-12 10:00 in Vietnam → window from 2026-08-14 00:00 Vietnam (17:00 UTC the day before).
    expect(bestSellerWindowStart(new Date('2026-11-12T03:00:00Z')).toISOString()).toBe(
      '2026-08-13T17:00:00.000Z',
    );
    expect(BEST_SELLER_WINDOW_DAYS).toBe(90);
  });

  it('is stable through a Vietnam day and moves at local midnight', () => {
    const early = bestSellerWindowStart(new Date('2026-11-11T17:00:00Z')); // 00:00 VN, 12 Nov
    const late = bestSellerWindowStart(new Date('2026-11-12T16:59:59Z')); // 23:59 VN, 12 Nov
    const next = bestSellerWindowStart(new Date('2026-11-12T17:00:00Z')); // 00:00 VN, 13 Nov
    expect(late).toEqual(early);
    expect(next.getTime() - early.getTime()).toBe(24 * 3600_000);
  });

  it('accepts a custom number of days', () => {
    expect(bestSellerWindowStart(new Date('2026-11-12T03:00:00Z'), 0).toISOString()).toBe(
      '2026-11-11T17:00:00.000Z',
    );
  });
});
