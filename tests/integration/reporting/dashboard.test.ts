import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import {
  carts,
  codRemittanceOrders,
  codRemittances,
  orderItems,
  orders,
  payments,
  privacyRequests,
  productTranslations,
  products,
  productVariants,
  refunds,
  users,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { newId } from '@/server/lib/ids';
import { generateOrderCode, type OrderStatus } from '@/server/modules/order';
import {
  codPendingRemittance,
  englishCoverage,
  getDashboard,
  openPrivacyRequests,
  openRefunds,
  resolveRange,
} from '@/server/modules/reporting';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Reporting queries (KPI dashboard) against real PostgreSQL. A fixed "now" far in the future
 * keeps the date-ranged figures independent of anything the seed creates.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let variants: { id: string; productId: string; sku: string }[];
let ownerId: string;

// 10:00 on 15 March 2031 in Vietnam.
const NOW = new Date('2031-03-15T03:00:00Z');
const vn = (local: string) => new Date(`${local}+07:00`);

type NewOrder = {
  placedAt: Date;
  status?: OrderStatus;
  total?: number;
  amountRefunded?: number;
  amountPaid?: number;
  paymentMethod?: 'cod' | 'vnpay';
  source?: 'web' | 'admin';
  variant?: number;
  quantity?: number;
};

async function createOrder(input: NewOrder) {
  const id = newId();
  const total = input.total ?? 1_000_000;
  const quantity = input.quantity ?? 1;
  const variant = variants[input.variant ?? 0]!;
  await db.insert(orders).values({
    id,
    code: generateOrderCode(),
    email: 'khach@example.com',
    phone: '0912345678',
    customerName: 'Nguyễn Thị Hương',
    locale: 'vi',
    source: input.source ?? 'web',
    status: input.status ?? 'confirmed',
    paymentMethod: input.paymentMethod ?? 'vnpay',
    subtotal: total,
    total,
    amountPaid: input.amountPaid ?? 0,
    amountRefunded: input.amountRefunded ?? 0,
    placedAt: input.placedAt,
  });
  await db.insert(orderItems).values({
    orderId: id,
    productId: variant.productId,
    variantId: variant.id,
    productName: 'Snapshot name',
    variantLabel: '100 ml',
    sku: variant.sku,
    unitPrice: Math.round(total / quantity),
    quantity,
    lineTotal: total,
  });
  return id;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  // One variant of each of three different products.
  const all = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
    })
    .from(productVariants)
    .orderBy(asc(productVariants.sku));
  const seen = new Set<string>();
  variants = all.filter((v) => !seen.has(v.productId) && seen.add(v.productId)).slice(0, 3);
  ownerId = newId();
  await db.insert(users).values({ id: ownerId, name: 'Owner', email: 'o@x.vn', role: 'owner' });

  // Today (Vietnam): two revenue orders, one awaiting confirmation, one cancelled.
  await createOrder({ placedAt: vn('2031-03-15T08:00:00'), total: 2_000_000, quantity: 2 });
  await createOrder({
    placedAt: vn('2031-03-15T00:05:00'),
    total: 1_000_000,
    amountRefunded: 300_000,
    variant: 1,
  });
  await createOrder({ placedAt: vn('2031-03-15T09:00:00'), status: 'awaiting_confirmation' });
  await createOrder({ placedAt: vn('2031-03-15T09:30:00'), status: 'cancelled', source: 'admin' });
  // 23:59 yesterday in Vietnam (16:59 UTC on the 14th): not "today".
  await createOrder({ placedAt: vn('2031-03-14T23:59:00'), total: 500_000, status: 'delivered' });
  // 10 days ago: inside 30d and this month, outside 7d.
  await createOrder({ placedAt: vn('2031-03-05T12:00:00'), total: 4_000_000, variant: 2 });
  // Last month: only in 30d.
  await createOrder({ placedAt: vn('2031-02-20T12:00:00'), total: 7_000_000 });

  // Carts created today: 4 → conversion 3 web orders / 4 carts.
  for (let i = 0; i < 4; i += 1) {
    await db.insert(carts).values({
      tokenHash: `hash-${i}`,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      createdAt: vn('2031-03-15T07:00:00'),
    });
  }
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('getDashboard', () => {
  it('computes today in Vietnam time', async () => {
    const dashboard = await getDashboard(db, 'owner', 'today', NOW);
    expect(dashboard.sales).toMatchObject({
      ordersPlaced: 4,
      revenueOrders: 2,
      grossSales: 3_000_000,
      refunded: 300_000,
      netRevenue: 2_700_000,
      averageOrderValue: 1_500_000,
      webOrders: 3,
      cartsCreated: 4,
      conversionRate: 0.75,
    });
    expect(dashboard.daily).toEqual([{ day: '2031-03-15', netRevenue: 2_700_000, orders: 2 }]);
    expect(dashboard.byStatus).toEqual([
      { status: 'confirmed', orders: 2 },
      { status: 'awaiting_confirmation', orders: 1 },
      { status: 'cancelled', orders: 1 },
    ]);
  });

  it('fills the daily series and ranks best sellers for 7 days', async () => {
    const dashboard = await getDashboard(db, 'manager', '7d', NOW);
    expect(dashboard.sales?.netRevenue).toBe(3_200_000);
    expect(dashboard.daily).toHaveLength(7);
    expect(dashboard.daily?.at(-2)).toEqual({ day: '2031-03-14', netRevenue: 500_000, orders: 1 });
    expect(dashboard.daily?.[0]).toEqual({ day: '2031-03-09', netRevenue: 0, orders: 0 });
    const top = dashboard.topProducts!;
    expect(top[0]).toMatchObject({ productId: variants[0]!.productId, units: 3 });
    expect(top[0]!.revenue).toBe(2_500_000);
    // Current Vietnamese product name, not the order snapshot.
    expect(top[0]!.name).not.toBe('Snapshot name');
  });

  it('this month and 30 days use their own start', async () => {
    const month = await getDashboard(db, 'owner', 'month', NOW);
    expect(month.range.days[0]).toBe('2031-03-01');
    expect(month.sales?.grossSales).toBe(7_500_000);
    const thirty = await getDashboard(db, 'owner', '30d', NOW);
    expect(thirty.sales?.grossSales).toBe(14_500_000);
  });

  it('hides money from roles without dashboard.viewRevenue and skips unrelated widgets', async () => {
    const staff = await getDashboard(db, 'staff', 'today', NOW);
    expect(staff.canViewRevenue).toBe(false);
    expect(staff.sales).toMatchObject({ ordersPlaced: 4, grossSales: 0, netRevenue: 0 });
    expect(staff.cash).toBeNull();
    expect(staff.daily).toBeNull();
    expect(staff.topProducts).toBeNull();
    expect(staff.codPending).toBeNull();
    expect(staff.refunds).toBeNull();
    expect(staff.byStatus).not.toBeNull();

    const editor = await getDashboard(db, 'editor', 'today', NOW);
    expect(editor.sales).toBeNull();
    expect(editor.byStatus).toBeNull();
    expect(editor.pendingReviews).toBe(0);
    expect(editor.translations).not.toBeNull();
    expect(editor.privacy).toBeNull();
  });
});

describe('live counters', () => {
  it('cash basis: payments received minus refunds completed in the range', async () => {
    const orderId = await createOrder({ placedAt: vn('2031-01-01T10:00:00'), status: 'cancelled' });
    const paidAt = vn('2031-03-15T09:00:00');
    await db.insert(payments).values([
      {
        orderId,
        provider: 'vnpay',
        kind: 'full',
        amount: 900_000,
        status: 'refunded',
        txnRef: `R${Date.now()}A`,
        paidAt,
      },
      {
        orderId,
        provider: 'vnpay',
        kind: 'full',
        amount: 100_000,
        status: 'failed',
        txnRef: `R${Date.now()}B`,
        paidAt,
      },
    ]);
    await db.insert(refunds).values({
      orderId,
      amount: 900_000,
      reason: 'test',
      method: 'gateway',
      status: 'completed',
      completedAt: vn('2031-03-15T09:30:00'),
    });
    const dashboard = await getDashboard(db, 'owner', 'today', NOW);
    expect(dashboard.cash).toEqual({ received: 900_000, refunded: 900_000, net: 0 });
  });

  it('counts delivered COD orders not yet remitted', async () => {
    const before = await codPendingRemittance(db);
    const pending = await createOrder({
      placedAt: vn('2031-03-01T10:00:00'),
      status: 'delivered',
      paymentMethod: 'cod',
      total: 1_200_000,
    });
    const remitted = await createOrder({
      placedAt: vn('2031-03-01T11:00:00'),
      status: 'delivered',
      paymentMethod: 'cod',
      total: 800_000,
    });
    const [remittance] = await db
      .insert(codRemittances)
      .values({
        carrier: 'ghn',
        periodStart: '2031-03-01',
        periodEnd: '2031-03-07',
        totalAmount: 800_000,
        receivedAt: NOW,
        createdBy: ownerId,
      })
      .returning();
    await db
      .insert(codRemittanceOrders)
      .values({ remittanceId: remittance!.id, orderId: remitted, amount: 800_000 });
    const after = await codPendingRemittance(db);
    expect(after.orders - before.orders).toBe(1);
    expect(after.amount - before.amount).toBe(1_200_000);
    expect(pending).toBeTruthy();
  });

  it('counts open refunds and overdue privacy requests', async () => {
    const orderId = await createOrder({ placedAt: vn('2031-03-02T10:00:00') });
    await db.insert(refunds).values([
      { orderId, amount: 200_000, reason: 'a', method: 'cash', status: 'requested' },
      { orderId, amount: 50_000, reason: 'b', method: 'cash', status: 'processing' },
      { orderId, amount: 70_000, reason: 'c', method: 'cash', status: 'failed' },
    ]);
    expect(await openRefunds(db)).toEqual({ count: 2, amount: 250_000 });

    await db.insert(privacyRequests).values([
      { email: 'a@x.vn', type: 'export', dueAt: vn('2031-03-10T00:00:00') },
      { email: 'b@x.vn', type: 'delete', status: 'in_progress', dueAt: vn('2031-03-20T00:00:00') },
      {
        email: 'c@x.vn',
        type: 'export',
        status: 'completed',
        dueAt: vn('2031-03-01T00:00:00'),
        completedAt: NOW,
      },
    ]);
    expect(await openPrivacyRequests(db, NOW)).toEqual({ open: 2, overdue: 1 });
  });

  it('counts active products without a published English translation', async () => {
    const before = await englishCoverage(db);
    expect(before.activeProducts).toBeGreaterThan(0);
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.status, 'active'))
      .orderBy(asc(products.id))
      .limit(1);
    await db
      .update(productTranslations)
      .set({ isPublished: false })
      .where(eq(productTranslations.productId, product!.id));
    const after = await englishCoverage(db);
    expect(after.activeProducts).toBe(before.activeProducts);
    expect(after.missingEnglish).toBeGreaterThanOrEqual(before.missingEnglish);
    expect(after.missingEnglish).toBeLessThanOrEqual(before.missingEnglish + 1);
  });

  it('resolves ranges consistently with the queries', () => {
    expect(resolveRange('today', NOW).start.toISOString()).toBe('2031-03-14T17:00:00.000Z');
  });
});
