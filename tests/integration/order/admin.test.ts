import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import {
  auditLogs,
  inventoryItems,
  orderAddresses,
  orderEvents,
  orderItems,
  orders,
  productVariants,
  products,
  shipments,
  stockReservations,
  users,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import type { CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { reserveStock } from '@/server/modules/inventory';
import {
  addOrderNote,
  bulkConfirmOrders,
  cancelOrder,
  changeOrderStatus,
  codRiskForPhone,
  countOrdersByStatus,
  generateOrderCode,
  getAdminOrderDetail,
  getPrintableOrders,
  listAdminOrders,
  revenueStats,
  shipOrder,
  tabCounts,
  type OrderListQuery,
} from '@/server/modules/order';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let variant: { id: string; productId: string; sku: string; price: number };
const actorIds = {} as Record<StaffRole, string>;

const ctx = (role: StaffRole): CommandContext => ({
  db,
  boss,
  actor: { id: actorIds[role], role },
  ip: '127.0.0.1',
});

type NewOrder = {
  status?: 'pending' | 'awaiting_confirmation' | 'confirmed';
  paymentMethod?: 'cod' | 'vnpay';
  quantity?: number;
  depositRequired?: number;
  amountPaid?: number;
  phone?: string;
  userId?: string | null;
  provinceCode?: string;
  hidePrices?: boolean;
};

/** Orders are created directly (placeOrder belongs to the checkout stream), with reservations. */
async function createOrder(input: NewOrder = {}) {
  const quantity = input.quantity ?? 1;
  const subtotal = variant.price * quantity;
  const total = subtotal + 30_000;
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(orders).values({
      id,
      code: generateOrderCode(),
      userId: input.userId ?? null,
      email: 'khach.hang@example.com',
      phone: input.phone ?? '0912345678',
      customerName: 'Nguyễn Văn Khách',
      locale: 'vi',
      status: input.status ?? 'awaiting_confirmation',
      paymentMethod: input.paymentMethod ?? 'cod',
      subtotal,
      shippingFee: 30_000,
      total,
      depositRequired: input.depositRequired ?? 0,
      amountPaid: input.amountPaid ?? 0,
      hidePrices: input.hidePrices ?? false,
      giftMessage: input.hidePrices ? 'Chúc mừng sinh nhật' : null,
    });
    await tx.insert(orderItems).values({
      orderId: id,
      productId: variant.productId,
      variantId: variant.id,
      productName: 'Nước hoa test',
      variantLabel: '100ml',
      sku: variant.sku,
      unitPrice: variant.price,
      quantity,
      lineTotal: subtotal,
    });
    await tx.insert(orderAddresses).values({
      orderId: id,
      type: 'shipping',
      fullName: 'Nguyễn Văn Khách',
      phone: input.phone ?? '0912345678',
      provinceCode: input.provinceCode ?? '01',
      provinceName: input.provinceCode === '79' ? 'Thành phố Hồ Chí Minh' : 'Thành phố Hà Nội',
      wardCode: '00004',
      wardName: 'Phường Ba Đình',
      street: '1 Hoàng Hoa Thám',
    });
    await reserveStock(tx, {
      orderId: id,
      lines: [{ variantId: variant.id, quantity }],
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
    });
  });
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

async function stock() {
  const [row] = await db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.variantId, variant.id));
  return row!;
}

async function reload(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

function listQuery(overrides: Partial<OrderListQuery> = {}): OrderListQuery {
  return {
    q: '',
    page: 1,
    pageSize: 50,
    sort: '',
    dir: 'desc',
    tab: null,
    status: null,
    paymentStatus: null,
    paymentMethod: null,
    province: null,
    from: null,
    to: null,
    ...overrides,
  };
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
  for (const role of ['owner', 'manager', 'staff', 'editor'] as const) {
    const id = newId();
    actorIds[role] = id;
    await db
      .insert(users)
      .values({ id, name: `Staff ${role}`, email: `${role}@perfume.test`, role });
  }
  const [row] = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      price: productVariants.price,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .limit(1);
  variant = row!;
  await db
    .update(inventoryItems)
    .set({ onHand: 100, reserved: 0 })
    .where(eq(inventoryItems.variantId, variant.id));
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('order processing', () => {
  it('confirms a COD order (stock committed), packs, ships with a shipment and delivers', async () => {
    const before = await stock();
    const order = await createOrder({ quantity: 2 });
    expect(await stock()).toEqual({ onHand: before.onHand, reserved: before.reserved + 2 });

    const confirmed = await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: order.version,
      reason: null,
    });
    expect(confirmed.data).toMatchObject({ status: 'confirmed', version: 1, code: order.code });
    expect(confirmed.tags).toEqual(['orders:list', `order:${order.id}`]);
    expect(await stock()).toEqual({ onHand: before.onHand - 2, reserved: before.reserved });

    // Stale version (someone else already moved it): conflict.
    await expect(
      changeOrderStatus(ctx('staff'), {
        orderId: order.id,
        to: 'processing',
        expectedVersion: 0,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'processing',
      expectedVersion: 1,
      reason: null,
    });
    const shipped = await shipOrder(ctx('staff'), {
      orderId: order.id,
      expectedVersion: 2,
      carrier: 'ghn',
      trackingCode: 'GHN123456VN',
      feeActual: 28_000,
    });
    expect(shipped.data.status).toBe('shipped');
    const [shipment] = await db.select().from(shipments).where(eq(shipments.orderId, order.id));
    expect(shipment).toMatchObject({
      carrier: 'ghn',
      trackingCode: 'GHN123456VN',
      status: 'in_transit',
      codAmount: order.total,
      feeActual: 28_000,
    });

    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'delivered',
      expectedVersion: 3,
      reason: null,
    });
    const final = await reload(order.id);
    expect(final.status).toBe('delivered');
    expect(final.shippedAt).not.toBeNull();
    expect(final.deliveredAt).not.toBeNull();
    const [delivered] = await db.select().from(shipments).where(eq(shipments.orderId, order.id));
    expect(delivered?.status).toBe('delivered');

    const events = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.id))
      .orderBy(orderEvents.createdAt);
    expect(events.map((e) => e.toStatus)).toEqual([
      'confirmed',
      'processing',
      'shipped',
      'delivered',
    ]);
    expect(events.every((e) => e.actorType === 'staff' && e.actorId === actorIds.staff)).toBe(true);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, order.id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'order.status.confirmed',
      'order.status.delivered',
      'order.status.processing',
      'order.status.shipped',
    ]);
  });

  it('cannot enter shipped from confirmed or without the processing step', async () => {
    const order = await createOrder();
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: 0,
      reason: null,
    });
    await expect(
      shipOrder(ctx('staff'), {
        orderId: order.id,
        expectedVersion: 1,
        carrier: 'ghtk',
        trackingCode: 'S1234',
        feeActual: null,
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(await db.select().from(shipments).where(eq(shipments.orderId, order.id))).toEqual([]);
  });

  it('refuses to confirm a COD order until its deposit is paid', async () => {
    const order = await createOrder({ depositRequired: 1_000_000 });
    await expect(
      changeOrderStatus(ctx('owner'), {
        orderId: order.id,
        to: 'confirmed',
        expectedVersion: 0,
        reason: null,
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      fieldErrors: [{ path: 'status', code: 'depositRequired' }],
    });
    expect((await reload(order.id)).status).toBe('awaiting_confirmation');

    // The payment module records the deposit (simulated here).
    await db.update(orders).set({ amountPaid: 1_000_000 }).where(eq(orders.id, order.id));
    const result = await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: 0,
      reason: null,
    });
    expect(result.data.status).toBe('confirmed');
  });

  it('lets only Manager/Owner cancel a confirmed or paid order, restocking it', async () => {
    const order = await createOrder({ quantity: 3 });
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: 0,
      reason: null,
    });
    const afterConfirm = await stock();
    await expect(
      cancelOrder(ctx('staff'), { orderId: order.id, expectedVersion: 1, reason: 'Khách đổi ý' }),
    ).rejects.toMatchObject({ code: 'invalid' });

    await cancelOrder(ctx('manager'), {
      orderId: order.id,
      expectedVersion: 1,
      reason: 'Khách đổi ý',
    });
    const cancelled = await reload(order.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Khách đổi ý' });
    expect(await stock()).toEqual({
      onHand: afterConfirm.onHand + 3,
      reserved: afterConfirm.reserved,
    });

    // A deposit-paid COD order awaiting confirmation holds money: staff cannot cancel it.
    const paid = await createOrder({ depositRequired: 500_000, amountPaid: 500_000 });
    await expect(
      cancelOrder(ctx('staff'), { orderId: paid.id, expectedVersion: 0, reason: 'Hết hàng' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      fieldErrors: [{ path: 'status', code: 'cancelPaidForbidden' }],
    });
    // An unpaid one can be cancelled by staff: the reservation is released.
    const unpaid = await createOrder();
    const reservedBefore = (await stock()).reserved;
    await cancelOrder(ctx('staff'), {
      orderId: unpaid.id,
      expectedVersion: 0,
      reason: 'Trùng đơn',
    });
    expect((await stock()).reserved).toBe(reservedBefore - 1);

    const detail = await getAdminOrderDetail(db, order.id, 'owner');
    expect(detail?.money.refundOwed).toBe(0);
    await db.update(orders).set({ amountPaid: 200_000 }).where(eq(orders.id, order.id));
    expect((await getAdminOrderDetail(db, order.id, 'owner'))?.money.refundOwed).toBe(200_000);
  });

  it('flags COD risk on a failed delivery and restocks the returned parcel', async () => {
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      name: 'Khách rủi ro',
      email: 'risk@example.com',
      phone: '0987000111',
    });
    const order = await createOrder({ phone: '0987000111', userId, quantity: 1 });
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: 0,
      reason: null,
    });
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'processing',
      expectedVersion: 1,
      reason: null,
    });
    await shipOrder(ctx('staff'), {
      orderId: order.id,
      expectedVersion: 2,
      carrier: 'ghtk',
      trackingCode: 'S22334455',
      feeActual: null,
    });
    const afterShip = await stock();
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'delivery_failed',
      expectedVersion: 3,
      reason: 'Không liên lạc được',
    });
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.codRiskFlag).toBe(true);
    const flagged = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'cod_risk_flagged')));
    expect(flagged).toHaveLength(1);

    // The next COD order to this phone (even as a guest) shows the warning.
    const next = await createOrder({ phone: '0987000111' });
    expect(await codRiskForPhone(db, '0987000111', { excludeOrderId: next.id })).toEqual({
      accountFlagged: true,
      failedDeliveries: 1,
    });
    const nextDetail = await getAdminOrderDetail(db, next.id, 'staff');
    expect(nextDetail?.codRisk.failedDeliveries).toBe(1);
    expect(await codRiskForPhone(db, '0900000999')).toEqual({
      accountFlagged: false,
      failedDeliveries: 0,
    });

    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'returned',
      expectedVersion: 4,
      reason: null,
    });
    // `next` above holds one more reservation.
    expect(await stock()).toEqual({
      onHand: afterShip.onHand + 1,
      reserved: afterShip.reserved + 1,
    });
    const [returned] = await db.select().from(shipments).where(eq(shipments.orderId, order.id));
    expect(returned?.status).toBe('returned');
    const reservations = await db
      .select({ status: stockReservations.status })
      .from(stockReservations)
      .where(eq(stockReservations.orderId, order.id));
    expect(reservations.map((r) => r.status)).toEqual(['released']);
  });

  it('adds internal notes to the timeline and bulk-confirms COD orders', async () => {
    const order = await createOrder();
    await addOrderNote(ctx('staff'), { orderId: order.id, message: 'Khách hẹn giao sau 18h' });
    const detail = await getAdminOrderDetail(db, order.id, 'staff');
    expect(detail?.events[0]).toMatchObject({
      type: 'note',
      message: 'Khách hẹn giao sau 18h',
      actorName: 'Staff staff',
    });
    // Notes do not bump the optimistic-lock version.
    expect(detail?.version).toBe(0);
    expect(detail?.nextStatuses).toEqual(['confirmed', 'cancelled']);

    const deposit = await createOrder({ depositRequired: 900_000 });
    const online = await createOrder({ status: 'pending', paymentMethod: 'vnpay' });
    const result = await bulkConfirmOrders(ctx('staff'), {
      orderIds: [order.id, deposit.id, online.id],
    });
    expect(result.data.confirmed).toEqual([order.code]);
    expect(result.data.skipped).toEqual([
      { orderId: deposit.id, code: deposit.code, reason: 'depositRequired' },
      { orderId: online.id, code: online.code, reason: 'notAwaitingCod' },
    ]);
    expect((await reload(order.id)).status).toBe('confirmed');
  });

  it('refuses commands without the order permission', async () => {
    const order = await createOrder();
    await expect(
      changeOrderStatus(ctx('editor'), {
        orderId: order.id,
        to: 'confirmed',
        expectedVersion: 0,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('order admin reads', () => {
  it('filters, searches, counts per tab and masks contacts without permission', async () => {
    const hcm = await createOrder({ phone: '0938111222', provinceCode: '79' });
    const counts = await countOrdersByStatus(db);
    const tabs = tabCounts(counts);
    expect(tabs.awaiting).toBe(counts.awaiting_confirmation);
    expect(tabs.toPack).toBe(counts.confirmed + counts.processing);

    const byProvince = await listAdminOrders(db, listQuery({ province: '79' }), 'staff');
    expect(byProvince.rows.map((r) => r.id)).toEqual([hcm.id]);
    expect(byProvince.rows[0]).toMatchObject({
      phone: '0938111222',
      provinceName: 'Thành phố Hồ Chí Minh',
      itemCount: 1,
    });

    const byPhone = await listAdminOrders(db, listQuery({ q: '938 111' }), 'staff');
    expect(byPhone.rows.map((r) => r.id)).toEqual([hcm.id]);
    const byCode = await listAdminOrders(db, listQuery({ q: hcm.code.toLowerCase() }), 'staff');
    expect(byCode.total).toBe(1);

    const awaiting = await listAdminOrders(db, listQuery({ tab: 'awaiting' }), 'staff');
    expect(awaiting.total).toBe(counts.awaiting_confirmation);
    expect(awaiting.rows.every((r) => r.status === 'awaiting_confirmation')).toBe(true);

    const future = await listAdminOrders(
      db,
      listQuery({ from: '2099-01-01', to: '2099-01-31' }),
      'staff',
    );
    expect(future.total).toBe(0);

    const masked = await listAdminOrders(db, listQuery({ province: '79' }), 'editor');
    expect(masked.rows[0]).toMatchObject({ phone: '093****222', email: 'k***@example.com' });
    const detail = await getAdminOrderDetail(db, hcm.id, 'editor');
    expect(detail?.contact).toEqual({
      phone: '093****222',
      email: 'k***@example.com',
      masked: true,
    });
    expect(detail?.shippingAddress?.phone).toBe('093****222');
    expect(detail?.nextStatuses).toEqual([]);
  });

  it('builds print data with prices hidden for gift orders', async () => {
    const gift = await createOrder({ hidePrices: true, quantity: 2 });
    const plain = await createOrder();
    const printable = await getPrintableOrders(db, [gift.id, plain.id]);
    expect(printable.map((p) => p.code)).toEqual([gift.code, plain.code]);
    expect(printable[0]!.packingSlip).toMatchObject({ showPrices: false, totals: null, units: 2 });
    expect(printable[0]!.packingSlip.lines[0]).toMatchObject({ unitPrice: null, lineTotal: null });
    expect(printable[0]!.giftMessage).toBe('Chúc mừng sinh nhật');
    expect(printable[1]!.packingSlip.totals?.total).toBe(plain.total);
    expect(printable[1]!.money.codToCollect).toBe(plain.total);
  });

  it('sums revenue of confirmed orders only', async () => {
    const stats = await revenueStats(db);
    const rows = await db.execute<{ revenue: string; n: number }>(
      sql`select coalesce(sum(total - amount_refunded), 0) as revenue, count(*)::int as n from orders
          where status not in ('pending', 'awaiting_confirmation', 'cancelled', 'returned')`,
    );
    expect(stats.today.revenue).toBe(Number(rows.rows[0]!.revenue));
    expect(stats.last30Days.orders).toBe(rows.rows[0]!.n);
    expect(stats.today.averageOrderValue).toBe(
      Math.round(stats.today.revenue / Math.max(stats.today.orders, 1)),
    );
  });
});
