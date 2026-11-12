import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { orderItems, orders, payments, products, productVariants } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import {
  createPaymentGateways,
  type PaymentGateway,
  type PaymentGateways,
} from '@/server/integrations/payments';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { reserveStock } from '@/server/modules/inventory';
import { generateOrderCode } from '@/server/modules/order';
import { createPaymentSession } from '@/server/modules/payment';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * M2 follow-up (m2-exit "Known gaps"): two web instances opening the first payment session of
 * the same order at the same time must share one session instead of the second cancelling the
 * first while its gateway call is still running.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let base: PaymentGateways;
let variantId: string;
let productId: string;
let gatewayCalls = 0;

const RETURN_URL = 'http://localhost:3000/thanh-toan/ket-qua?code=X';

/** A slow payOS: the session is "in flight" for 400 ms. */
function slowGateways(): PaymentGateways {
  const payos = base.payos!;
  const slow: PaymentGateway = {
    ...payos,
    async createSession(input) {
      gatewayCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      return payos.createSession(input);
    },
  };
  return { ...base, payos: slow };
}

async function placeOnlineOrder() {
  return db.transaction(async (tx) => {
    const total = 1_250_000;
    const [order] = await tx
      .insert(orders)
      .values({
        code: generateOrderCode(),
        email: 'khach@example.com',
        phone: '0912345678',
        customerName: 'Khách Test',
        locale: 'vi',
        status: 'pending',
        paymentMethod: 'payos',
        subtotal: total,
        total,
      })
      .returning();
    await tx.insert(orderItems).values({
      orderId: order!.id,
      productId,
      variantId,
      productName: 'Test perfume',
      variantLabel: '100 ml',
      sku: 'TEST',
      unitPrice: total,
      quantity: 1,
      lineTotal: total,
    });
    await reserveStock(tx, {
      orderId: order!.id,
      lines: [{ variantId, quantity: 1 }],
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    return order!;
  });
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
  base = createPaymentGateways({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    VNPAY_PAYMENT_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    VNPAY_API_URL: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
    PAYOS_API_URL: 'https://api-merchant.payos.vn',
    PAYMENT_SIMULATOR: true,
  });
  const [variant] = await db
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .limit(1);
  variantId = variant!.id;
  productId = variant!.productId;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('createPaymentSession under concurrency', () => {
  it('two instances opening the first session at once share one gateway session', async () => {
    const order = await placeOnlineOrder();
    gatewayCalls = 0;
    // Separate deps objects = separate web instances (no shared in-process state).
    const [a, b] = await Promise.all([
      createPaymentSession(
        { db, boss, gateways: slowGateways() },
        { orderId: order.id, provider: 'payos', returnUrl: RETURN_URL },
      ),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return createPaymentSession(
          { db, boss, gateways: slowGateways() },
          { orderId: order.id, provider: 'payos', returnUrl: RETURN_URL },
        );
      })(),
    ]);

    expect(gatewayCalls).toBe(1);
    expect(a.paymentId).toBe(b.paymentId);
    expect(b.qrCode ?? b.checkoutUrl).toBeTruthy();
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    const rows = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
  });

  it('replaces a stale empty session left by a crashed request', async () => {
    const order = await placeOnlineOrder();
    const [stale] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: 'payos',
        kind: 'full',
        amount: order.total,
        txnRef: `9${Date.now()}`.slice(0, 15),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        createdAt: new Date(Date.now() - 60_000),
      })
      .returning();
    gatewayCalls = 0;
    const session = await createPaymentSession(
      { db, boss, gateways: slowGateways() },
      { orderId: order.id, provider: 'payos', returnUrl: RETURN_URL },
    );
    expect(gatewayCalls).toBe(1);
    expect(session.paymentId).not.toBe(stale!.id);
    const [old] = await db
      .select({ status: payments.status })
      .from(payments)
      .where(and(eq(payments.id, stale!.id)));
    expect(old!.status).toBe('cancelled');
  });

  it('a just-created empty session that then fails lets the waiting request open its own', async () => {
    const order = await placeOnlineOrder();
    const [inFlight] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: 'payos',
        kind: 'full',
        amount: order.total,
        txnRef: `8${Date.now()}`.slice(0, 15),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      })
      .returning();
    gatewayCalls = 0;
    const waiting = createPaymentSession(
      { db, boss, gateways: slowGateways() },
      { orderId: order.id, provider: 'payos', returnUrl: RETURN_URL },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(gatewayCalls).toBe(0); // still waiting for the other request
    await db.update(payments).set({ status: 'failed' }).where(eq(payments.id, inFlight!.id));
    const session = await waiting;
    expect(gatewayCalls).toBe(1);
    expect(session.paymentId).not.toBe(inFlight!.id);
  });
});
