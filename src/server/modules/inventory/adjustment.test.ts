import { describe, expect, it } from 'vitest';

import { availableStock, computeAdjustment, isLowStock } from './adjustment';

describe('computeAdjustment', () => {
  it('adds a purchase', () => {
    expect(
      computeAdjustment(
        { onHand: 2, reserved: 0 },
        { mode: 'delta', quantity: 5, reason: 'purchase' },
      ),
    ).toEqual({ ok: true, delta: 5, onHand: 7, available: 7 });
  });

  it('turns a counted quantity into a delta', () => {
    expect(
      computeAdjustment(
        { onHand: 10, reserved: 1 },
        { mode: 'set', quantity: 8, reason: 'adjustment' },
      ),
    ).toEqual({ ok: true, delta: -2, onHand: 8, available: 7 });
  });

  it('rejects movements in the wrong direction for the reason', () => {
    const level = { onHand: 5, reserved: 0 };
    expect(computeAdjustment(level, { mode: 'delta', quantity: -1, reason: 'purchase' })).toEqual({
      ok: false,
      code: 'wrongDirection',
    });
    expect(computeAdjustment(level, { mode: 'delta', quantity: 1, reason: 'damage' })).toEqual({
      ok: false,
      code: 'wrongDirection',
    });
  });

  it('never goes negative or below the reserved quantity', () => {
    expect(
      computeAdjustment(
        { onHand: 3, reserved: 0 },
        { mode: 'delta', quantity: -4, reason: 'damage' },
      ),
    ).toEqual({ ok: false, code: 'insufficientStock' });
    expect(
      computeAdjustment(
        { onHand: 3, reserved: 2 },
        { mode: 'set', quantity: 1, reason: 'adjustment' },
      ),
    ).toEqual({ ok: false, code: 'insufficientStock' });
  });

  it('rejects a no-op', () => {
    expect(
      computeAdjustment(
        { onHand: 3, reserved: 0 },
        { mode: 'set', quantity: 3, reason: 'adjustment' },
      ),
    ).toEqual({ ok: false, code: 'noChange' });
  });
});

describe('stock levels', () => {
  it('computes availability and the low-stock flag', () => {
    expect(availableStock({ onHand: 5, reserved: 2 })).toBe(3);
    expect(isLowStock({ onHand: 5, reserved: 2, lowStockThreshold: 3 })).toBe(true);
    expect(isLowStock({ onHand: 9, reserved: 0, lowStockThreshold: 3 })).toBe(false);
  });
});
