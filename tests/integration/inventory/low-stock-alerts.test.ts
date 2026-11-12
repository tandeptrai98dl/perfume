import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { brands, orders, productVariants, products } from '@/server/db/schema';
import { PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { newId } from '@/server/lib/ids';
import {
  adjustOrderStock,
  adjustStock,
  commitReservations,
  releaseReservations,
  reserveStock,
  setLowStockThreshold,
  stockAdjustSchema,
} from '@/server/modules/inventory';
import { generateOrderCode } from '@/server/modules/order';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

/*
 * Low-stock staff alerts (§11.2 "Internal alerts", ADR-0019): one alert per downward crossing
 * of the threshold, enqueued in the transaction of the stock change (outbox), none while the
 * variant stays low, a new one only after it recovered.
 */

let h: CommandHarness;
let variantId: string;

async function lowStockAlerts(): Promise<number> {
  const result = await h.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(PGBOSS_SCHEMA)}.job
        where name = 'staff.alert' and data->>'kind' = 'low_stock'
          and data->>'variantId' = ${variantId}`,
  );
  return result.rows[0]!.n;
}

const adjust = (quantity: number, reason: 'purchase' | 'damage' | 'adjustment') =>
  adjustStock(
    h.ctx('staff'),
    stockAdjustSchema.parse({ variantId, quantity, reason, mode: 'delta', note: 'kiểm kho' }),
  );

async function newOrder(): Promise<string> {
  const id = newId();
  await h.db.insert(orders).values({
    id,
    code: generateOrderCode(),
    email: 'khach@example.com',
    phone: '0912345678',
    customerName: 'Khách',
    locale: 'vi',
    status: 'pending',
    paymentMethod: 'vnpay',
    subtotal: 1_000_000,
    total: 1_000_000,
  });
  return id;
}

const reserve = (orderId: string, quantity: number) =>
  h.db.transaction((tx) =>
    reserveStock(tx, {
      orderId,
      lines: [{ variantId, quantity }],
      expiresAt: new Date(Date.now() + 30 * 60_000),
      boss: h.boss,
    }),
  );

beforeAll(async () => {
  h = await startCommandHarness();
  const brandId = newId();
  const productId = newId();
  variantId = newId();
  await h.db.insert(brands).values({ id: brandId, name: 'Alert Brand', status: 'active' });
  await h.db
    .insert(products)
    .values({ id: productId, brandId, gender: 'unisex', concentration: 'edp' });
  await h.db.insert(productVariants).values({
    id: variantId,
    productId,
    sku: 'ALERT-1',
    sizeMl: 50,
    price: 1_000_000,
    weightG: 300,
  });
  await adjust(10, 'purchase');
  await setLowStockThreshold(h.ctx('staff'), { variantId, lowStockThreshold: 3 });
});

afterAll(async () => {
  await h?.stop();
});

describe('low-stock alerts', () => {
  it('alerts once when a manual adjustment crosses the threshold, not while it stays low', async () => {
    await adjust(-6, 'damage'); // 10 → 4: above the threshold
    expect(await lowStockAlerts()).toBe(0);
    await adjust(-1, 'damage'); // 4 → 3: crossing
    expect(await lowStockAlerts()).toBe(1);
    await adjust(-1, 'damage'); // 3 → 2: still low
    expect(await lowStockAlerts()).toBe(1);
  });

  it('alerts again only after the variant recovered above the threshold', async () => {
    await adjust(5, 'purchase'); // 2 → 7: recovered
    expect(await lowStockAlerts()).toBe(1);
    await adjust(-5, 'damage'); // 7 → 2: new crossing
    expect(await lowStockAlerts()).toBe(2);
    await adjust(6, 'purchase'); // back to 8
  });

  it('alerts when a reservation crosses; committing it changes nothing', async () => {
    const orderId = await newOrder();
    await reserve(orderId, 5); // available 8 → 3
    expect(await lowStockAlerts()).toBe(3);
    await h.db.transaction((tx) => commitReservations(tx, orderId, null));
    expect(await lowStockAlerts()).toBe(3);
  });

  it('serializes concurrent reservations: one crossing, one alert', async () => {
    await adjust(2, 'purchase'); // available 3 → 5
    const [a, b] = [await newOrder(), await newOrder()];
    await Promise.all([reserve(a, 1), reserve(b, 1)]); // 5 → 4 → 3
    expect(await lowStockAlerts()).toBe(4);
    // Releasing recovers; an order edit that reserves more crosses again.
    await h.db.transaction((tx) => releaseReservations(tx, a));
    await h.db.transaction((tx) => releaseReservations(tx, b));
    expect(await lowStockAlerts()).toBe(4);
    await h.db.transaction((tx) =>
      adjustOrderStock(tx, {
        orderId: b,
        mode: 'reserved',
        changes: [{ variantId, delta: 2 }],
        expiresAt: new Date(Date.now() + 30 * 60_000),
        actorId: h.actorIds.staff,
        boss: h.boss,
      }),
    );
    expect(await lowStockAlerts()).toBe(5);
  });

  it('drops the alert with a rolled-back change (outbox)', async () => {
    await adjust(10, 'purchase'); // available 3 → 13
    const orderId = await newOrder();
    await expect(
      h.db.transaction(async (tx) => {
        await reserveStock(tx, {
          orderId,
          lines: [{ variantId, quantity: 12 }],
          expiresAt: new Date(Date.now() + 60_000),
          boss: h.boss,
        });
        throw new Error('payment session failed');
      }),
    ).rejects.toThrow('payment session failed');
    expect(await lowStockAlerts()).toBe(5);
  });
});
