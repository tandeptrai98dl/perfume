import type { AdjustmentMode, AdjustmentReason } from './admin-schemas';

/**
 * Pure stock arithmetic for a manual adjustment. Stock never goes negative and never below
 * what is reserved for open orders (mirrors the `inventory_items` CHECK constraint).
 */

export type StockLevel = { onHand: number; reserved: number };

export type AdjustmentOutcome =
  | { ok: true; delta: number; onHand: number; available: number }
  | { ok: false; code: 'noChange' | 'wrongDirection' | 'insufficientStock' };

/** Purchases and returns add stock, damage removes it, a count correction can go either way. */
const DIRECTION: Record<AdjustmentReason, 'in' | 'out' | 'any'> = {
  purchase: 'in',
  return: 'in',
  damage: 'out',
  adjustment: 'any',
};

export function computeAdjustment(
  level: StockLevel,
  change: { mode: AdjustmentMode; quantity: number; reason: AdjustmentReason },
): AdjustmentOutcome {
  const delta = change.mode === 'set' ? change.quantity - level.onHand : change.quantity;
  if (delta === 0) return { ok: false, code: 'noChange' };
  const direction = DIRECTION[change.reason];
  if ((direction === 'in' && delta < 0) || (direction === 'out' && delta > 0)) {
    return { ok: false, code: 'wrongDirection' };
  }
  const onHand = level.onHand + delta;
  if (onHand < 0 || onHand < level.reserved) return { ok: false, code: 'insufficientStock' };
  return { ok: true, delta, onHand, available: onHand - level.reserved };
}

export function availableStock(level: StockLevel): number {
  return Math.max(0, level.onHand - level.reserved);
}

export function isLowStock(level: StockLevel & { lowStockThreshold: number }): boolean {
  return availableStock(level) <= level.lowStockThreshold;
}
