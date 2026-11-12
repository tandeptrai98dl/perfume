import { describe, expect, it } from 'vitest';

import { lowStockCrossings } from './low-stock';

const change = (before: number, after: number, threshold = 3) => ({
  variantId: `v-${before}-${after}`,
  before,
  after,
  threshold,
});

describe('lowStockCrossings', () => {
  it('reports only a move from above the threshold to at or below it', () => {
    expect(lowStockCrossings([change(5, 3)])).toHaveLength(1);
    expect(lowStockCrossings([change(4, 0)])).toHaveLength(1);
    expect(lowStockCrossings([change(10, 4)])).toHaveLength(0);
  });

  it('stays quiet while the variant is already low, and on recovery', () => {
    expect(lowStockCrossings([change(3, 2), change(2, 0), change(1, 5), change(0, 3)])).toEqual([]);
  });

  it('handles a zero threshold as "out of stock"', () => {
    expect(lowStockCrossings([change(1, 0, 0)])).toHaveLength(1);
    expect(lowStockCrossings([change(2, 1, 0)])).toHaveLength(0);
  });
});
