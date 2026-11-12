import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { inventoryItems, stockMovements, stockReservations } from '@/server/db/schema';
import { DomainError, type Tx } from '@/server/lib/command-context';

import { getDefaultLocationId } from './commands';
import { enqueueLowStockAlerts, type StockLevelChange } from './low-stock';

/*
 * Stock side of an admin order edit (ARCHITECTURE.md §3.4 step 8, ADR-0006). Runs inside the
 * caller's transaction after the order row is locked, and locks the inventory rows of every
 * changed variant with SELECT … FOR UPDATE in variant-id order (same order as `reserveStock`,
 * so edits and checkouts never deadlock).
 *
 * The order's reservation rows stay the source of truth for what it holds, so later
 * `commitReservations` / `releaseReservations` / `restockOrder` keep working unchanged:
 * - `reserved` (pending / awaiting confirmation): +delta reserves more (new active row with the
 *   order's current expiry); −delta frees part of the active rows (reserved −= qty).
 * - `committed` (confirmed / processing): +delta deducts more stock now (on_hand −= qty,
 *   movement 'sale', new committed row); −delta puts stock back (on_hand += qty, movement
 *   'release', committed rows shrink or become released).
 */

export type OrderStockChange = { variantId: string; delta: number };

export type AdjustOrderStockInput = {
  orderId: string;
  mode: 'reserved' | 'committed';
  changes: readonly OrderStockChange[];
  /** Expiry of new active rows (`reserved` mode): the order's current reservation expiry. */
  expiresAt?: Date;
  actorId: string | null;
  note?: string;
  /** Producer for low-stock alerts (outbox); no alert without it. */
  boss?: PgBoss | null;
};

type LockedRow = { variantId: string; onHand: number; reserved: number; lowStockThreshold: number };

/** Merges duplicate variants and drops zero deltas. */
function netChanges(changes: readonly OrderStockChange[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const change of changes) {
    out.set(change.variantId, (out.get(change.variantId) ?? 0) + change.delta);
  }
  for (const [variantId, delta] of out) if (delta === 0) out.delete(variantId);
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Applies the stock deltas of an order edit. Throws `DomainError('insufficientStock')` with one
 * issue per short variant (`path` = variant id) when an increase exceeds the available stock,
 * and `DomainError('invalid')` when a decrease exceeds what the order holds.
 */
export async function adjustOrderStock(tx: Tx, input: AdjustOrderStockInput): Promise<void> {
  const deltas = netChanges(input.changes);
  if (deltas.size === 0) return;
  if (input.mode === 'reserved' && !input.expiresAt && [...deltas.values()].some((d) => d > 0)) {
    throw new DomainError('invalid', [{ path: 'reservation', code: 'reservationExpired' }]);
  }
  const locationId = await getDefaultLocationId(tx);
  const variantIds = [...deltas.keys()];
  const rows = await tx
    .select({
      variantId: inventoryItems.variantId,
      onHand: inventoryItems.onHand,
      reserved: inventoryItems.reserved,
      lowStockThreshold: inventoryItems.lowStockThreshold,
    })
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.locationId, locationId), inArray(inventoryItems.variantId, variantIds)),
    )
    .orderBy(asc(inventoryItems.variantId))
    .for('update');
  const locked = new Map<string, LockedRow>(rows.map((row) => [row.variantId, row]));

  const short = [...deltas].filter(([variantId, delta]) => {
    if (delta <= 0) return false;
    const row = locked.get(variantId);
    return !row || row.onHand - row.reserved < delta;
  });
  if (short.length > 0) {
    throw new DomainError(
      'insufficientStock',
      short.map(([variantId]) => ({ path: variantId, code: 'insufficientStock' })),
    );
  }

  const status = input.mode === 'reserved' ? 'active' : 'committed';
  const held = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, input.orderId),
        eq(stockReservations.status, status),
        inArray(stockReservations.variantId, variantIds),
      ),
    )
    // Shrink the newest rows first (an earlier edit's increase goes back before the original).
    .orderBy(asc(stockReservations.variantId), desc(stockReservations.createdAt))
    .for('update');

  // Both modes lower availability by `delta` (reserve more / deduct more) or raise it.
  const levels: StockLevelChange[] = [];
  for (const [variantId, delta] of deltas) {
    const row = locked.get(variantId);
    if (!row) continue;
    const before = row.onHand - row.reserved;
    levels.push({ variantId, before, after: before - delta, threshold: row.lowStockThreshold });
  }

  for (const [variantId, delta] of deltas) {
    const where = and(
      eq(inventoryItems.variantId, variantId),
      eq(inventoryItems.locationId, locationId),
    );
    if (delta > 0) {
      await tx
        .update(inventoryItems)
        .set(
          input.mode === 'reserved'
            ? { reserved: sql`${inventoryItems.reserved} + ${delta}` }
            : { onHand: sql`${inventoryItems.onHand} - ${delta}` },
        )
        .where(where);
      await tx.insert(stockReservations).values({
        orderId: input.orderId,
        variantId,
        locationId,
        quantity: delta,
        status,
        expiresAt: input.expiresAt ?? new Date(),
      });
      if (input.mode === 'committed') {
        await tx.insert(stockMovements).values({
          variantId,
          locationId,
          delta: -delta,
          reason: 'sale',
          refType: 'order',
          refId: input.orderId,
          note: input.note ?? null,
          actorId: input.actorId,
        });
      }
      continue;
    }

    const quantity = -delta;
    const mine = held.filter((row) => row.variantId === variantId);
    const holding = mine.reduce((sum, row) => sum + row.quantity, 0);
    if (holding < quantity) {
      throw new DomainError('invalid', [{ path: variantId, code: 'stockNotHeld' }]);
    }
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
      .set(
        input.mode === 'reserved'
          ? { reserved: sql`${inventoryItems.reserved} - ${quantity}` }
          : { onHand: sql`${inventoryItems.onHand} + ${quantity}` },
      )
      .where(where);
    if (input.mode === 'committed') {
      await tx.insert(stockMovements).values({
        variantId,
        locationId,
        delta: quantity,
        reason: 'release',
        refType: 'order',
        refId: input.orderId,
        note: input.note ?? null,
        actorId: input.actorId,
      });
    }
  }
  await enqueueLowStockAlerts(input.boss, tx, levels);
}

/** Latest expiry among the order's active reservations (null when none is still active). */
export async function activeReservationExpiry(
  tx: Pick<Tx, 'select'>,
  orderId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ expiresAt: sql<Date | null>`max(${stockReservations.expiresAt})` })
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, 'active')));
  return row?.expiresAt ? new Date(row.expiresAt) : null;
}
