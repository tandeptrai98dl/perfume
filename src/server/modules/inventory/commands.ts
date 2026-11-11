import { and, eq, inArray } from 'drizzle-orm';

import { inventoryItems, locations, productVariants, stockMovements } from '@/server/db/schema';
import { diffRecords, recordAudit } from '@/server/lib/audit';
import {
  assertCan,
  DomainError,
  enqueueRevalidation,
  type CommandContext,
  type CommandResult,
  type Tx,
} from '@/server/lib/command-context';
import { catalogTags } from '@/server/modules/catalog/cache-tags';

import { computeAdjustment } from './adjustment';
import type { LowStockThresholdInput, StockAdjustInput } from './admin-schemas';

/*
 * Inventory write side (ADR-0006, ADR-0022). Every stock change locks the inventory row with
 * SELECT … FOR UPDATE, writes an append-only stock_movements row, an audit row and the
 * revalidation job in one transaction.
 */

type Executor = Pick<Tx, 'select' | 'insert'>;

/** MVP sells from one warehouse (ADR-0022): the location flagged `is_default`. */
export async function getDefaultLocationId(tx: Pick<Tx, 'select'>): Promise<string> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isDefault, true))
    .limit(1);
  if (!location) throw new DomainError('invalid', [], 'No default location; run pnpm db:seed');
  return location.id;
}

/** Creates empty inventory rows for new variants (called by the catalogue in its transaction). */
export async function ensureInventoryItems(tx: Executor, variantIds: readonly string[]) {
  if (variantIds.length === 0) return;
  const locationId = await getDefaultLocationId(tx);
  await tx
    .insert(inventoryItems)
    .values(variantIds.map((variantId) => ({ variantId, locationId })))
    .onConflictDoNothing();
}

export type StockAdjustResult = {
  variantId: string;
  delta: number;
  onHand: number;
  reserved: number;
  available: number;
  movementId: string;
};

export async function adjustStock(
  ctx: CommandContext,
  input: StockAdjustInput,
): Promise<CommandResult<StockAdjustResult>> {
  assertCan(ctx.actor, 'inventory.adjust');
  return ctx.db.transaction(async (tx) => {
    const [variant] = await tx
      .select({ id: productVariants.id, productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId));
    if (!variant) throw new DomainError('notFound');

    const locationId = await getDefaultLocationId(tx);
    await tx
      .insert(inventoryItems)
      .values({ variantId: variant.id, locationId })
      .onConflictDoNothing();
    // Serializes concurrent adjustments (and, from M2, reservations) of this variant.
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(
        and(eq(inventoryItems.variantId, variant.id), eq(inventoryItems.locationId, locationId)),
      )
      .for('update');
    if (!item) throw new DomainError('notFound');

    const outcome = computeAdjustment(item, input);
    if (!outcome.ok) {
      const code = outcome.code === 'insufficientStock' ? 'insufficientStock' : 'invalid';
      throw new DomainError(code, [{ path: 'quantity', code: outcome.code }]);
    }

    await tx
      .update(inventoryItems)
      .set({ onHand: outcome.onHand })
      .where(
        and(eq(inventoryItems.variantId, variant.id), eq(inventoryItems.locationId, locationId)),
      );
    const [movement] = await tx
      .insert(stockMovements)
      .values({
        variantId: variant.id,
        locationId,
        delta: outcome.delta,
        reason: input.reason,
        refType: 'manual_adjustment',
        note: input.note,
        actorId: ctx.actor.id,
      })
      .returning({ id: stockMovements.id });

    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'inventory.adjust',
      entityType: 'product_variant',
      entityId: variant.id,
      diff: {
        ...diffRecords({ onHand: item.onHand }, { onHand: outcome.onHand }),
        reason: { from: null, to: input.reason },
      },
      ip: ctx.ip,
    });
    const tags = await enqueueRevalidation(ctx.boss, tx, [
      catalogTags.inventory(variant.id),
      catalogTags.product(variant.productId),
    ]);
    return {
      data: {
        variantId: variant.id,
        delta: outcome.delta,
        onHand: outcome.onHand,
        reserved: item.reserved,
        available: outcome.available,
        movementId: movement!.id,
      },
      tags,
    };
  });
}

export async function setLowStockThreshold(
  ctx: CommandContext,
  input: LowStockThresholdInput,
): Promise<CommandResult<{ variantId: string; lowStockThreshold: number }>> {
  assertCan(ctx.actor, 'inventory.adjust');
  return ctx.db.transaction(async (tx) => {
    const locationId = await getDefaultLocationId(tx);
    const [variant] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId));
    if (!variant) throw new DomainError('notFound');
    await tx
      .insert(inventoryItems)
      .values({ variantId: variant.id, locationId })
      .onConflictDoNothing();
    const [before] = await tx
      .select({ lowStockThreshold: inventoryItems.lowStockThreshold })
      .from(inventoryItems)
      .where(
        and(eq(inventoryItems.variantId, variant.id), eq(inventoryItems.locationId, locationId)),
      )
      .for('update');
    await tx
      .update(inventoryItems)
      .set({ lowStockThreshold: input.lowStockThreshold })
      .where(
        and(eq(inventoryItems.variantId, variant.id), eq(inventoryItems.locationId, locationId)),
      );
    await recordAudit(tx, {
      actorId: ctx.actor.id,
      action: 'inventory.threshold',
      entityType: 'product_variant',
      entityId: variant.id,
      diff: diffRecords(before ?? null, { lowStockThreshold: input.lowStockThreshold }),
      ip: ctx.ip,
    });
    // Thresholds only affect admin screens: nothing on the storefront to revalidate.
    return { data: input, tags: [] };
  });
}

/** Inventory rows of a variant set, for the catalogue's duplicate/delete checks. */
export async function hasStockHistory(tx: Pick<Tx, 'select'>, variantIds: readonly string[]) {
  if (variantIds.length === 0) return false;
  const rows = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(inArray(stockMovements.variantId, [...variantIds]))
    .limit(1);
  return rows.length > 0;
}
