import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  brands,
  inventoryItems,
  products,
  productVariants,
  stockMovements,
} from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  adjustStock,
  listLowStock,
  listMovements,
  listStock,
  setLowStockThreshold,
  stockAdjustSchema,
} from '@/server/modules/inventory';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

let h: CommandHarness;
let variantId: string;
let productId: string;

beforeAll(async () => {
  h = await startCommandHarness();
  const brandId = newId();
  productId = newId();
  variantId = newId();
  await h.db.insert(brands).values({ id: brandId, name: 'Stock Brand', status: 'active' });
  await h.db
    .insert(products)
    .values({ id: productId, brandId, gender: 'unisex', concentration: 'edp' });
  await h.db.insert(productVariants).values({
    id: variantId,
    productId,
    sku: 'STOCK-1',
    sizeMl: 50,
    price: 1_000_000,
    weightG: 300,
  });
});

afterAll(async () => {
  await h?.stop();
});

const input = (quantity: number, reason: 'purchase' | 'damage' | 'adjustment', mode = 'delta') =>
  stockAdjustSchema.parse({ variantId, quantity, reason, mode, note: 'kiểm kho' });

async function onHand() {
  const [row] = await h.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.variantId, variantId));
  return row?.onHand;
}

describe('adjustStock', () => {
  it('adds stock, writes a movement, an audit row and an outbox job', async () => {
    const result = await adjustStock(h.ctx('staff'), input(10, 'purchase'));
    expect(result.data).toMatchObject({ delta: 10, onHand: 10, reserved: 0, available: 10 });
    expect(result.tags).toEqual([`inventory:${variantId}`, `product:${productId}`]);
    const movements = await h.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.variantId, variantId));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: 10,
      reason: 'purchase',
      actorId: h.actorIds.staff,
      note: 'kiểm kho',
    });
    const audit = await h.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'inventory.adjust'));
    expect(audit[0]?.diff).toMatchObject({ onHand: { from: 0, to: 10 } });
    expect((await h.jobs('cache.revalidate')).at(-1)?.data.tags).toEqual(result.tags);
  });

  it('sets a counted quantity as a delta', async () => {
    const result = await adjustStock(h.ctx('manager'), input(7, 'adjustment', 'set'));
    expect(result.data).toMatchObject({ delta: -3, onHand: 7 });
  });

  it('never goes negative and leaves no trace when rejected', async () => {
    const movementsBefore = (await h.db.select().from(stockMovements)).length;
    const error = await adjustStock(h.ctx('owner'), input(-8, 'damage')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('insufficientStock');
    expect(await onHand()).toBe(7);
    expect((await h.db.select().from(stockMovements)).length).toBe(movementsBefore);
  });

  it('is forbidden for editors', async () => {
    const error = await adjustStock(h.ctx('editor'), input(1, 'purchase')).catch((e: unknown) => e);
    expect((error as DomainError).code).toBe('forbidden');
  });

  it('serializes concurrent adjustments with the row lock', async () => {
    // 7 on hand; 10 concurrent removals of 1 → exactly 7 succeed, stock ends at 0.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => adjustStock(h.ctx('staff'), input(-1, 'damage'))),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(7);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(((r as PromiseRejectedResult).reason as DomainError).code).toBe('insufficientStock');
    }
    expect(await onHand()).toBe(0);
    // The log adds up to the stock level.
    const movements = await h.db
      .select({ delta: stockMovements.delta })
      .from(stockMovements)
      .where(eq(stockMovements.variantId, variantId))
      .orderBy(asc(stockMovements.createdAt));
    expect(movements.reduce((sum, m) => sum + m.delta, 0)).toBe(0);
  });

  it('two concurrent additions both apply', async () => {
    await Promise.all([
      adjustStock(h.ctx('staff'), input(5, 'purchase')),
      adjustStock(h.ctx('staff'), input(3, 'purchase')),
    ]);
    expect(await onHand()).toBe(8);
  });
});

describe('inventory queries', () => {
  it('lists stock, low stock and the movement log', async () => {
    await setLowStockThreshold(h.ctx('staff'), { variantId, lowStockThreshold: 10 });
    const stock = await listStock(h.db, {
      q: 'stock-1',
      page: 1,
      pageSize: 20,
      sort: '',
      dir: 'asc',
    });
    expect(stock.total).toBe(1);
    expect(stock.rows[0]).toMatchObject({ onHand: 8, reserved: 0, available: 8, isLow: true });
    expect((await listLowStock(h.db)).map((r) => r.variantId)).toContain(variantId);
    const log = await listMovements(h.db, { variantId, page: 1, pageSize: 5 });
    expect(log.total).toBeGreaterThan(5);
    expect(log.rows).toHaveLength(5);
    expect(log.rows[0]).toMatchObject({ sku: 'STOCK-1', actorName: 'staff' });
  });
});
