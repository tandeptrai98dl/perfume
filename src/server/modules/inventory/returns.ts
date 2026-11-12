import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { inventoryItems, stockMovements, stockReservations } from '@/server/db/schema';
import { DomainError, type Tx } from '@/server/lib/command-context';

import { getDefaultLocationId } from './commands';

/*
 * Stock side of customer returns (ADR-0017, ADR-0006), inside the caller's transaction after the
 * order row is locked. Inventory rows are locked with SELECT … FOR UPDATE in variant-id order
 * (same order as `reserveStock`), and every change writes a `stock_movements` row.
 *
 * `transitionOrder(→ returned)` restocks a whole order through `restockOrder`. A partial return
 * (some lines or units) keeps the order `delivered`, so its lines come back here instead:
 * - `restockReturnedLines`: on_hand += qty, movement `return`; the order's committed reservation
 *   rows shrink by the same quantity, so a later whole-order restock never counts them twice.
 *   Like `restockOrder`, the committed rows are the source of truth: units the order does not
 *   hold (e.g. orders entered before stock tracking) are not added; the restocked lines are
 *   returned.
 * - `writeOffReturnedStock`: on_hand −= qty, movement `damage` — returned units that cannot be
 *   sold again (opened, defective, broken). Called right after the restock, in the same
 *   transaction, so the movement log shows both the return and the write-off.
 */

export type ReturnedStockLine = { variantId: string; quantity: number };

function merge(lines: readonly ReturnedStockLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    out.set(line.variantId, (out.get(line.variantId) ?? 0) + line.quantity);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

async function lockItems(tx: Tx, locationId: string, variantIds: string[]) {
  const rows = await tx
    .select({
      variantId: inventoryItems.variantId,
      onHand: inventoryItems.onHand,
      reserved: inventoryItems.reserved,
    })
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.locationId, locationId), inArray(inventoryItems.variantId, variantIds)),
    )
    .orderBy(asc(inventoryItems.variantId))
    .for('update');
  return new Map(rows.map((row) => [row.variantId, row]));
}

export async function restockReturnedLines(
  tx: Tx,
  input: {
    orderId: string;
    lines: readonly ReturnedStockLine[];
    actorId: string | null;
    note?: string;
  },
): Promise<ReturnedStockLine[]> {
  const quantities = merge(input.lines);
  if (quantities.size === 0) return [];
  const locationId = await getDefaultLocationId(tx);
  const variantIds = [...quantities.keys()];
  const locked = await lockItems(tx, locationId, variantIds);

  const committed = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, input.orderId),
        eq(stockReservations.status, 'committed'),
        inArray(stockReservations.variantId, variantIds),
      ),
    )
    .orderBy(asc(stockReservations.variantId), desc(stockReservations.createdAt))
    .for('update');

  const restocked: ReturnedStockLine[] = [];
  for (const [variantId, wanted] of quantities) {
    const mine = committed.filter((r) => r.variantId === variantId);
    const quantity = Math.min(
      wanted,
      mine.reduce((sum, row) => sum + row.quantity, 0),
    );
    if (quantity === 0 || !locked.has(variantId)) continue;
    let remaining = quantity;
    for (const row of mine) {
      if (remaining === 0) break;
      if (row.quantity <= remaining) {
        remaining -= row.quantity;
        await tx
          .update(stockReservations)
          .set({ status: 'released' })
          .where(eq(stockReservations.id, row.id));
      } else {
        await tx
          .update(stockReservations)
          .set({ quantity: row.quantity - remaining })
          .where(eq(stockReservations.id, row.id));
        remaining = 0;
      }
    }
    await tx
      .update(inventoryItems)
      .set({ onHand: sql`${inventoryItems.onHand} + ${quantity}` })
      .where(
        and(eq(inventoryItems.variantId, variantId), eq(inventoryItems.locationId, locationId)),
      );
    await tx.insert(stockMovements).values({
      variantId,
      locationId,
      delta: quantity,
      reason: 'return',
      refType: 'order',
      refId: input.orderId,
      note: input.note ?? null,
      actorId: input.actorId,
    });
    restocked.push({ variantId, quantity });
  }
  return restocked;
}

export async function writeOffReturnedStock(
  tx: Tx,
  input: {
    orderId: string;
    lines: readonly ReturnedStockLine[];
    actorId: string | null;
    note?: string;
  },
): Promise<void> {
  const quantities = merge(input.lines);
  if (quantities.size === 0) return;
  const locationId = await getDefaultLocationId(tx);
  const locked = await lockItems(tx, locationId, [...quantities.keys()]);
  for (const [variantId, quantity] of quantities) {
    const row = locked.get(variantId);
    // The units were just restocked in this transaction, so they are on hand and unreserved.
    if (!row || row.onHand - row.reserved < quantity) {
      throw new DomainError('insufficientStock', [{ path: variantId, code: 'insufficientStock' }]);
    }
    await tx
      .update(inventoryItems)
      .set({ onHand: sql`${inventoryItems.onHand} - ${quantity}` })
      .where(
        and(eq(inventoryItems.variantId, variantId), eq(inventoryItems.locationId, locationId)),
      );
    await tx.insert(stockMovements).values({
      variantId,
      locationId,
      delta: -quantity,
      reason: 'damage',
      refType: 'order',
      refId: input.orderId,
      note: input.note ?? null,
      actorId: input.actorId,
    });
  }
}
