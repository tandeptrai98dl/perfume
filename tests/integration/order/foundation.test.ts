import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  inventoryItems,
  orderEvents,
  orders,
  productVariants,
  stockMovements,
  stockReservations,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError } from '@/server/lib/command-context';
import { reserveStock } from '@/server/modules/inventory';
import { generateOrderCode, transitionOrder } from '@/server/modules/order';
import { findCoupon, redeemCoupon } from '@/server/modules/promotion';
import { getCommerceSettings } from '@/server/modules/settings';
import { getFreeShippingThreshold, quoteShipping } from '@/server/modules/shipping';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let variantId: string;

const SYSTEM = { type: 'system' as const, id: null };

async function newOrder(status: 'pending' | 'awaiting_confirmation' = 'pending') {
  const [order] = await db
    .insert(orders)
    .values({
      code: generateOrderCode(),
      email: 'khach@example.com',
      phone: '0912345678',
      customerName: 'Khách Test',
      locale: 'vi',
      status,
      paymentMethod: status === 'pending' ? 'vnpay' : 'cod',
      subtotal: 3_200_000,
      total: 3_200_000,
    })
    .returning();
  return order!;
}

async function stock() {
  const [row] = await db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.variantId, variantId));
  return row!;
}

async function setStock(onHand: number) {
  await db
    .update(inventoryItems)
    .set({ onHand, reserved: 0 })
    .where(eq(inventoryItems.variantId, variantId));
  await db
    .update(stockReservations)
    .set({ status: 'released' })
    .where(eq(stockReservations.variantId, variantId));
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  boss = createBoss(testDb.url, { role: 'producer' });
  await boss.start();
  await ensureQueues(boss);
  const [variant] = await db.select({ id: productVariants.id }).from(productVariants).limit(1);
  variantId = variant!.id;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('stock reservations', () => {
  it('lets exactly one of two concurrent buyers reserve the last unit', async () => {
    await setStock(1);
    const [a, b] = [await newOrder(), await newOrder()];
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const results = await Promise.allSettled(
      [a, b].map((order) =>
        db.transaction((tx) =>
          reserveStock(tx, { orderId: order.id, lines: [{ variantId, quantity: 1 }], expiresAt }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DomainError);
    expect((rejected.reason as DomainError).code).toBe('insufficientStock');
    expect(await stock()).toEqual({ onHand: 1, reserved: 1 });
  });

  it('commits on confirmation and releases on cancellation, with events and outbox jobs', async () => {
    await setStock(5);
    const paid = await newOrder();
    const unpaid = await newOrder();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await db.transaction(async (tx) => {
      await reserveStock(tx, { orderId: paid.id, lines: [{ variantId, quantity: 2 }], expiresAt });
      await reserveStock(tx, {
        orderId: unpaid.id,
        lines: [{ variantId, quantity: 1 }],
        expiresAt,
      });
    });
    expect(await stock()).toEqual({ onHand: 5, reserved: 3 });

    const confirmed = await db.transaction((tx) =>
      transitionOrder(tx, boss, { orderId: paid.id, to: 'confirmed', actor: SYSTEM }),
    );
    expect(confirmed).toMatchObject({ from: 'pending', to: 'confirmed', version: 1 });
    expect(await stock()).toEqual({ onHand: 3, reserved: 1 });
    const sale = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, paid.id), eq(stockMovements.reason, 'sale')));
    expect(sale.map((m) => m.delta)).toEqual([-2]);

    await db.transaction((tx) =>
      transitionOrder(tx, boss, {
        orderId: unpaid.id,
        to: 'cancelled',
        actor: SYSTEM,
        reason: 'expired',
      }),
    );
    expect(await stock()).toEqual({ onHand: 3, reserved: 0 });

    // Manager cancels the confirmed order: stock comes back.
    await db.transaction((tx) =>
      transitionOrder(tx, boss, {
        orderId: paid.id,
        to: 'cancelled',
        actor: { type: 'staff', id: null, isManager: true },
        reason: 'customer request',
      }),
    );
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });

    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, paid.id));
    expect(events.map((e) => `${e.fromStatus}->${e.toStatus}`)).toEqual([
      'pending->confirmed',
      'confirmed->cancelled',
    ]);
    const [cancelled] = await db.select().from(orders).where(eq(orders.id, paid.id));
    expect(cancelled?.cancelReason).toBe('customer request');
    expect(cancelled?.amountDue).toBe(3_200_000);

    const jobs = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = 'order.status-changed'`,
    );
    expect(jobs.rows[0]!.n).toBe(3);
  });

  it('refuses transitions outside the state machine and stale versions', async () => {
    const order = await newOrder('awaiting_confirmation');
    await expect(
      db.transaction((tx) =>
        transitionOrder(tx, boss, { orderId: order.id, to: 'shipped', actor: SYSTEM }),
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      db.transaction((tx) =>
        transitionOrder(tx, boss, {
          orderId: order.id,
          to: 'confirmed',
          actor: { type: 'staff', id: null },
          expectedVersion: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('commerce lookups', () => {
  it('quotes the seeded nationwide rates and the free-shipping threshold', async () => {
    const quotes = await quoteShipping(db, { provinceCode: '01', weightG: 400, locale: 'en' });
    expect(quotes.map((q) => [q.name, q.fee])).toEqual([
      ['Standard delivery', 30_000],
      ['Express delivery', 50_000],
    ]);
    expect(await getFreeShippingThreshold(db)).toBe(2_000_000);
  });

  it('applies coupon limits per customer and redeems inside a transaction', async () => {
    const found = await findCoupon(db, 'welcome10', { customer: { phone: '0900000001' } });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const order = await newOrder();
    await db.transaction((tx) =>
      redeemCoupon(tx, {
        couponId: found.coupon.id,
        orderId: order.id,
        userId: null,
        phone: '0900000001',
        email: 'a@example.com',
        amount: 200_000,
      }),
    );
    expect(await findCoupon(db, 'WELCOME10', { customer: { phone: '0900000001' } })).toEqual({
      ok: false,
      reason: 'per_customer_limit',
    });
    expect((await findCoupon(db, 'nope')).ok).toBe(false);
  });

  it('reads typed settings with seed values', async () => {
    const settings = await getCommerceSettings(db);
    expect(settings.cod).toEqual({
      maxOrderWithoutDeposit: 5_000_000,
      depositPercent: 20,
      confirmationWindowHours: 24,
    });
    expect(settings.cart.maxQuantityPerLine).toBe(5);
  });
});

describe('cart read API', () => {
  it('returns live prices, availability and names with a Vietnamese fallback', async () => {
    const { carts: cartsTable, cartItems: items } = await import('@/server/db/schema');
    const { findActiveCart, getCartLines, hashCartToken, newCartToken } =
      await import('@/server/modules/cart');
    const token = newCartToken();
    const [cart] = await db
      .insert(cartsTable)
      .values({ tokenHash: hashCartToken(token), expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    await setStock(4);
    await db.insert(items).values({ cartId: cart!.id, variantId, quantity: 2, priceWhenAdded: 1 });
    expect((await findActiveCart(db, { token }))?.id).toBe(cart!.id);
    const [line] = await getCartLines(db, { cartId: cart!.id, locale: 'en' });
    expect(line).toMatchObject({
      variantId,
      quantity: 2,
      available: 4,
      purchasable: true,
      priceWhenAdded: 1,
    });
    expect(line!.unitPrice).toBeGreaterThan(0);
    expect(line!.productName.length).toBeGreaterThan(0);
  });
});
