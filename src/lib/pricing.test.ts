import { describe, expect, it } from 'vitest';

import { discountPercent } from './pricing';

describe('discountPercent', () => {
  it('rounds to whole percent', () => {
    expect(discountPercent(3_200_000, 4_000_000)).toBe(20);
    expect(discountPercent(2_990_000, 3_500_000)).toBe(15);
  });

  it('returns null without a real discount', () => {
    expect(discountPercent(3_000_000, null)).toBeNull();
    expect(discountPercent(3_000_000, 3_000_000)).toBeNull();
    expect(discountPercent(3_000_000, 2_000_000)).toBeNull();
  });
});
