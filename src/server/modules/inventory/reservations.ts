import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import { inventoryItems, stockMovements, stockReservations } from '@/server/db/schema';
import { DomainError, type Tx } from '@/server/lib/command-context';

import { getDefaultLocationId } from './commands';
import { enqueueLowStockAlerts } from './low-stock';

/*
 * Stock reservations for orders (ARCHITECTURE.md §3.4 step 2, ADR-0006). All functions run
 * inside the caller's transaction and lock inventory rows with SELECT … FOR UPDATE in a stable
 * order (variant id) so concurrent checkouts serialize without deadlocks.
 *
 * Invariants (CHECK on inventory_items): 0 <= reserved <= on_hand.
 * - reserve:  reserved += qty                              (no movement: on_hand unchanged)
 * - commit:   reserved -= qty, on_hand -= qty, movement 'sale' (-qty)
 * - release:  reserved -= qty                              (no movement)
 * - restock:  on_hand += qty, movement 'return' / 'release' (+qty) for deducted orders
 */

export type ReservationLine = { variantId: string; quantity: number };

type LockedRow = {
  variantId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
};

async function lockRows(
  tx: Tx,
  locationId: string,
  variantIds: readonly string[],
): Promise<Map<string, LockedRow>> {
  const sorted = [...new Set(variantIds)].sort();
  if (sorted.length === 0) return new Map();
  const rows = await tx
    .select({
      variantId: inventoryItems.variantId,
      locationId: inventoryItems.locationId,
      onHand: inventoryItems.onHand,
      reserved: inventoryItems.reserved,
      lowStockThreshold: inventoryItems.lowStockThreshold,
    })
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.locationId, locationId), inArray(inventoryItems.variantId, sorted)),
    )
    .orderBy(asc(inventoryItems.variantId))
    .for('update');
  return new Map(rows.map((row) => [row.variantId, row]));
}

/** Merges duplicate variant lines. */
function totals(lines: readonly ReservationLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) out.set(line.variantId, (out.get(line.variantId) ?? 0) + line.quantity);
  return out;
}

/**
 * Reserves stock for an order. Throws `DomainError('insufficientStock')` with one field issue
 * per short variant (`path` = variant id) when any line cannot be fully reserved. With `boss`,
 * a variant whose availability drops to its low-stock threshold gets a staff alert (outbox).
 */
export async function reserveStock(
  tx: Tx,
  input: {
    orderId: string;
    lines: readonly ReservationLine[];
    expiresAt: Date;
    boss?: PgBoss | null;
  },
): Promise<void> {
  const locationId = await getDefaultLocationId(tx);
  const wanted = totals(input.lines);
  const rows = await lockRows(tx, locationId, [...wanted.keys()]);

  const short = [...wanted].filter(([variantId, quantity]) => {
    const row = rows.get(variantId);
    return !row || row.onHand - row.reserved < quantity;
  });
  if (short.length > 0) {
    throw new DomainError(
      'insufficientStock',
      short.map(([variantId]) => ({ path: variantId, code: 'insufficientStock' })),
    );
  }

  for (const [variantId, quantity] of wanted) {
    await tx
      .update(inventoryItems)
      .set({ reserved: sql`${inventoryItems.reserved} + ${quantity}` })
      .where(
        and(eq(inventoryItems.variantId, variantId), eq(inventoryItems.locationId, locationId)),
      );
    await tx.insert(stockReservations).values({
      orderId: input.orderId,
      variantId,
      locationId,
      quantity,
      expiresAt: input.expiresAt,
    });
  }
  await enqueueLowStockAlerts(
    input.boss,
    tx,
    [...wanted].map(([variantId, quantity]) => {
      const row = rows.get(variantId)!;
      const before = row.onHand - row.reserved;
      return { variantId, before, after: before - quantity, threshold: row.lowStockThreshold };
    }),
  );
}

async function activeReservations(tx: Tx, orderId: string) {
  return tx
    .select()
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, 'active')))
    .orderBy(asc(stockReservations.variantId));
}

/** Paid/confirmed order: turns its active reservations into real deductions ('sale'). */
export async function commitReservations(
  tx: Tx,
  orderId: string,
  actorId: string | null = null,
): Promise<void> {
  const reservations = await activeReservations(tx, orderId);
  if (reservations.length === 0) return;
  const locationId = reservations[0]!.locationId;
  await lockRows(
    tx,
    locationId,
    reservations.map((r) => r.variantId),
  );
  for (const r of reservations) {
    await tx
      .update(inventoryItems)
      .set({
        reserved: sql`${inventoryItems.reserved} - ${r.quantity}`,
        onHand: sql`${inventoryItems.onHand} - ${r.quantity}`,
      })
      .where(
        and(eq(inventoryItems.variantId, r.variantId), eq(inventoryItems.locationId, r.locationId)),
      );
    await tx.insert(stockMovements).values({
      variantId: r.variantId,
      locationId: r.locationId,
      delta: -r.quantity,
      reason: 'sale',
      refType: 'order',
      refId: orderId,
      actorId,
    });
    await tx
      .update(stockReservations)
      .set({ status: 'committed' })
      .where(eq(stockReservations.id, r.id));
  }
}

/** Cancelled/expired unpaid order: frees its active reservations. */
export async function releaseReservations(tx: Tx, orderId: string): Promise<void> {
  const reservations = await activeReservations(tx, orderId);
  if (reservations.length === 0) return;
  await lockRows(
    tx,
    reservations[0]!.locationId,
    reservations.map((r) => r.variantId),
  );
  for (const r of reservations) {
    await tx
      .update(inventoryItems)
      .set({ reserved: sql`${inventoryItems.reserved} - ${r.quantity}` })
      .where(
        and(eq(inventoryItems.variantId, r.variantId), eq(inventoryItems.locationId, r.locationId)),
      );
    await tx
      .update(stockReservations)
      .set({ status: 'released' })
      .where(eq(stockReservations.id, r.id));
  }
}

/**
 * Puts committed stock back (cancel after confirmation, or a returned parcel). Uses the order's
 * committed reservations as the source of truth for quantities.
 */
export async function restockOrder(
  tx: Tx,
  input: { orderId: string; reason: 'return' | 'release'; actorId: string | null; note?: string },
): Promise<void> {
  const committed = await tx
    .select()
    .from(stockReservations)
    .where(
      and(eq(stockReservations.orderId, input.orderId), eq(stockReservations.status, 'committed')),
    )
    .orderBy(asc(stockReservations.variantId));
  if (committed.length === 0) return;
  await lockRows(
    tx,
    committed[0]!.locationId,
    committed.map((r) => r.variantId),
  );
  for (const r of committed) {
    await tx
      .update(inventoryItems)
      .set({ onHand: sql`${inventoryItems.onHand} + ${r.quantity}` })
      .where(
        and(eq(inventoryItems.variantId, r.variantId), eq(inventoryItems.locationId, r.locationId)),
      );
    await tx.insert(stockMovements).values({
      variantId: r.variantId,
      locationId: r.locationId,
      delta: r.quantity,
      reason: input.reason,
      refType: 'order',
      refId: input.orderId,
      note: input.note ?? null,
      actorId: input.actorId,
    });
    await tx
      .update(stockReservations)
      .set({ status: 'released' })
      .where(eq(stockReservations.id, r.id));
  }
}

/** Extends active reservations (payment retry, ADR-0006), never shortens them. */
export async function extendReservations(tx: Tx, orderId: string, expiresAt: Date): Promise<void> {
  await tx
    .update(stockReservations)
    .set({ expiresAt: sql`greatest(${stockReservations.expiresAt}, ${expiresAt})` })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, 'active')));
}
