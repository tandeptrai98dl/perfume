import { inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { getDb, type Database } from '@/server/db/client';
import { inventoryItems } from '@/server/db/schema';

/*
 * Read-only stock availability (ARCHITECTURE.md §3.3). Writes (adjustments, reservations)
 * belong to the inventory service.
 *
 * available = on_hand - reserved, summed over locations (one location in MVP, ADR-0022).
 * `inventory_items.reserved` is maintained by the reservation flow; when M2 adds
 * `stock_reservations`, only `availableQuantitySql` and `getVariantAvailability` change
 * (e.g. subtract active, non-expired reservations) and every caller keeps working.
 */

export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock';

export type VariantAvailability = {
  variantId: string;
  available: number;
  lowStockThreshold: number;
  stockState: StockState;
};

/** Default threshold for "Only X left" when a variant has no inventory row yet. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export function stockStateOf(available: number, lowStockThreshold: number): StockState {
  if (available <= 0) return 'out_of_stock';
  if (available <= lowStockThreshold) return 'low_stock';
  return 'in_stock';
}

/**
 * Correlated SQL expression with the available quantity of one variant, for catalogue
 * queries that filter or sort by stock ("in stock only") without an N+1.
 */
export function availableQuantitySql(variantId: AnyPgColumn | SQL): SQL<number> {
  return sql<number>`(
    select coalesce(sum(greatest(ii.on_hand - ii.reserved, 0)), 0)::int
    from inventory_items ii
    where ii.variant_id = ${variantId}
  )`;
}

/** Live availability per variant. Variants without an inventory row are out of stock. */
export async function getVariantAvailability(
  variantIds: readonly string[],
  db: Database = getDb(),
): Promise<Map<string, VariantAvailability>> {
  const result = new Map<string, VariantAvailability>();
  if (variantIds.length === 0) return result;

  const rows = await db
    .select({
      variantId: inventoryItems.variantId,
      available: sql<number>`coalesce(sum(greatest(${inventoryItems.onHand} - ${inventoryItems.reserved}, 0)), 0)::int`,
      lowStockThreshold: sql<number>`min(${inventoryItems.lowStockThreshold})::int`,
    })
    .from(inventoryItems)
    .where(inArray(inventoryItems.variantId, [...variantIds]))
    .groupBy(inventoryItems.variantId);

  const byId = new Map(rows.map((row) => [row.variantId, row]));
  for (const variantId of variantIds) {
    const row = byId.get(variantId);
    const available = row?.available ?? 0;
    const lowStockThreshold = row?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
    result.set(variantId, {
      variantId,
      available,
      lowStockThreshold,
      stockState: stockStateOf(available, lowStockThreshold),
    });
  }
  return result;
}
