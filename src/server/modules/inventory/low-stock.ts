import type { PgBoss } from 'pg-boss';

import { enqueue } from '@/server/jobs/queue';
import type { Tx } from '@/server/lib/command-context';

/*
 * Low-stock alerts (§11.2 "Internal alerts", ADR-0019). An alert is raised when a stock change
 * moves a variant's available quantity (on hand − reserved) from above its threshold to at or
 * below it, in the transaction of the change (outbox). The inventory rows are locked
 * (`SELECT … FOR UPDATE`) while before/after are compared, so concurrent changes serialize
 * and one downward crossing produces exactly one alert; further decreases while the variant
 * stays low produce none until it recovers above the threshold (restock, release, return).
 * Committing a reservation leaves availability unchanged and never alerts.
 */

export type StockLevelChange = {
  variantId: string;
  /** Available before the change (on hand − reserved). */
  before: number;
  /** Available after the change. */
  after: number;
  threshold: number;
};

/** Pure: the changes that cross the threshold downward (`isLowStock` uses `<=`). */
export function lowStockCrossings(changes: readonly StockLevelChange[]): StockLevelChange[] {
  return changes.filter(
    (change) => change.before > change.threshold && change.after <= change.threshold,
  );
}

/** Enqueues one `staff.alert` (`low_stock`) per crossing, inside the caller's transaction. */
export async function enqueueLowStockAlerts(
  boss: PgBoss | null | undefined,
  tx: Pick<Tx, 'execute'>,
  changes: readonly StockLevelChange[],
): Promise<number> {
  if (!boss) return 0;
  const crossings = lowStockCrossings(changes);
  for (const crossing of crossings) {
    await enqueue(boss, tx, 'staff.alert', { kind: 'low_stock', variantId: crossing.variantId });
  }
  return crossings.length;
}
