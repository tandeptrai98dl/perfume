import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkoutFormSchema, type CheckoutFormInput } from '@/lib/checkout/form-schema';
import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import {
  auditLogs,
  cartItems,
  carts,
  couponRedemptions,
  coupons,
  inventoryItems,
  orderAddresses,
  orderEvents,
  orderItems,
  orders,
  payments,
  productVariants,
  refunds,
  stockMovements,
  stockReservations,
  users,
  wards,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createPayosGateway } from '@/server/integrations/payments/payos';
import { SIMULATOR_KEYS, type PaymentGateways } from '@/server/integrations/payments';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError, type CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { hashCartToken, newCartToken } from '@/server/modules/cart';
import { placeOrder } from '@/server/modules/checkout';
import {
  cancelOrder,
  changeOrderStatus,
  editOrder,
  getOrderEditForm,
  orderEditSchema,
  previewOrderEdit,
  searchEditVariants,
  shipOrder,
  type OrderEditFormInput,
} from '@/server/modules/order';
import { confirmBankTransfer, createPaymentSession } from '@/server/modules/payment';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Admin order edits before shipment against a real PostgreSQL (ARCHITECTURE.md §3.4 step 8,
 * §16 "order edit with optimistic locking"): reservations vs committed stock, totals and coupon
 * re-evaluation, payment consequences, shipping override rights and version conflicts.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let provinceCode: string;
let wardCode: string;
let otherWard: { code: string; provinceCode: string };
const staff = {} as Record<StaffRole, string>;

const SKU = {
  edt100: 'MAIS-CEDR-EDT-100', // 3,200,000 ₫
  edt50: 'MAIS-CEDR-EDT-50', // 2,300,000 ₫
  travel: 'ATEL-HOA--EDP-10', // 650,000 ₫
} as const;

const ctx = (role: StaffRole): CommandContext => ({
  db,
  boss,
  actor: { id: staff[role], role },
  ip: '127.0.0.1',
});

async function variant(sku: string) {
  const [row] = await db.select().from(productVariants).where(eq(productVariants.sku, sku));
  return row!;
}

async function setStock(sku: string, onHand: number) {
  const v = await variant(sku);
  await db
    .update(stockReservations)
    .set({ status: 'released' })
    .where(eq(stockReservations.variantId, v.id));
  await db
    .update(inventoryItems)
    .set({ onHand, reserved: 0 })
    .where(eq(inventoryItems.variantId, v.id));
}

async function stock(sku: string) {
  const v = await variant(sku);
  const [row] = await db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.variantId, v.id));
  return row!;
}

let keySeq = 0;
async function place(
  lines: { sku: string; quantity: number }[],
  options: { paymentMethod?: 'cod' | 'vnpay' | 'payos'; couponCode?: string } = {},
) {
  const [cart] = await db
    .insert(carts)
    .values({
      tokenHash: hashCartToken(newCartToken()),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  for (const line of lines) {
    const v = await variant(line.sku);
    await db.insert(cartItems).values({
      cartId: cart!.id,
      variantId: v.id,
      quantity: line.quantity,
      priceWhenAdded: v.price,
    });
  }
  const { quoteShipping } = await import('@/server/modules/shipping');
  const [rate] = await quoteShipping(db, { provinceCode, weightG: 500, locale: 'vi' });
  keySeq += 1;
  const raw: CheckoutFormInput = {
    locale: 'vi',
    checkoutKey: `edit-key-${Date.now()}-${keySeq}-abcdef`,
    email: `khach${keySeq}@example.com`,
    phone: '0912345678',
    fullName: 'Nguyễn Văn A',
    address: { provinceCode, wardCode, street: '12 Lê Lợi' },
    shippingRateId: rate!.rateId,
    paymentMethod: options.paymentMethod ?? 'cod',
    couponCode: options.couponCode ?? '',
    customerNote: '',
    vatInvoice: {
      requested: false,
      companyName: '',
      taxCode: '',
      email: '',
      address: { provinceCode: '', wardCode: '', street: '' },
    },
    consents: { terms: true, privacy: true, marketing: false },
  };
  const { locale, checkoutKey, ...fields } = checkoutFormSchema.parse(raw);
  const placed = await placeOrder(
    { db, boss },
    {
      ...fields,
      cartId: cart!.id,
      checkoutKey,
      locale,
      userId: null,
      ip: null,
      userAgent: 'vitest',
    },
  );
  return reload(placed.orderId);
}

async function reload(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

async function items(orderId: string) {
  return db
    .select({ sku: orderItems.sku, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.sku));
}

async function reservations(orderId: string, status: 'active' | 'committed' | 'released') {
  const rows = await db
    .select({ variantId: stockReservations.variantId, quantity: stockReservations.quantity })
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, status)));
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

async function jobs(name: string, orderId: string) {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} and data->>'orderId' = ${orderId}`,
  );
  return result.rows.map((row) => row.data);
}

/** Builds the edit input from the order as it is, then applies `change`. */
async function editInput(
  orderId: string,
  change: (input: OrderEditFormInput) => OrderEditFormInput = (input) => input,
) {
  const form = (await getOrderEditForm(db, orderId))!;
  const base: OrderEditFormInput = {
    orderId,
    expectedVersion: form.version,
    address: {
      fullName: form.address!.fullName,
      phone: form.address!.phone,
      provinceCode: form.address!.provinceCode,
      wardCode: form.address!.wardCode,
      street: form.address!.street,
    },
    items: form.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
  };
  return orderEditSchema.parse(change(base));
}

async function expectDomainError(promise: Promise<unknown>, code: string, issues?: unknown[]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  if (issues) expect((error as DomainError).fieldErrors).toEqual(issues);
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
  provinceCode = '79';
  const [ward] = await db.select().from(wards).where(eq(wards.provinceCode, '79')).limit(1);
  wardCode = ward!.code;
  const [other] = await db.select().from(wards).where(eq(wards.provinceCode, '01')).limit(1);
  otherWard = { code: other!.code, provinceCode: '01' };
  for (const role of ['owner', 'manager', 'staff', 'editor'] as const) {
    const id = newId();
    staff[role] = id;
    await db.insert(users).values({ id, name: role, email: `${role}@example.com`, role });
  }
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

beforeEach(async () => {
  for (const sku of Object.values(SKU)) await setStock(sku, 10);
});

describe('edits while stock is reserved (awaiting confirmation)', () => {
  it('adjusts reservations, items, totals, timeline, audit and the customer e-mail job', async () => {
    const order = await place([
      { sku: SKU.edt50, quantity: 1 },
      { sku: SKU.travel, quantity: 2 },
    ]);
    expect(order.status).toBe('awaiting_confirmation');
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 2 });
    const travel = await variant(SKU.travel);
    const edt100 = await variant(SKU.edt100);
    const edt50 = await variant(SKU.edt50);

    const input = await editInput(order.id, (base) => ({
      ...base,
      items: [
        { variantId: edt50.id, quantity: 2 },
        { variantId: edt100.id, quantity: 1 },
      ],
      note: 'Khách đổi ý qua điện thoại',
    }));
    const preview = (await previewOrderEdit(ctx('staff'), input)).data;
    expect(preview.changed).toBe(true);
    expect(preview.after.subtotal).toBe(2 * 2_300_000 + 3_200_000);
    // Preview writes nothing.
    expect((await reload(order.id)).version).toBe(order.version);

    const result = await editOrder(ctx('staff'), input);
    expect(result.data.total).toBe(preview.after.total);
    expect(result.data.version).toBe(order.version + 1);

    const after = await reload(order.id);
    expect(after).toMatchObject({
      subtotal: 7_800_000,
      shippingFee: 0, // free standard shipping over 2,000,000
      total: 7_800_000,
      // COD above 5,000,000 now needs a 20% deposit (ADR-0016), rounded up to 1,000 ₫.
      depositRequired: 1_560_000,
      status: 'awaiting_confirmation',
    });
    expect(await items(order.id)).toEqual([
      { sku: SKU.edt100, quantity: 1, lineTotal: 3_200_000 },
      { sku: SKU.edt50, quantity: 2, lineTotal: 4_600_000 },
    ]);
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 0 });
    expect(await stock(SKU.edt50)).toEqual({ onHand: 10, reserved: 2 });
    expect(await stock(SKU.edt100)).toEqual({ onHand: 10, reserved: 1 });
    expect(await reservations(order.id, 'active')).toBe(3);
    // Reservations never create movements: on_hand is unchanged.
    const moves = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, order.id), eq(stockMovements.variantId, travel.id)));
    expect(moves).toEqual([]);

    const [event] = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'edited')));
    expect(event!.message).toBe('Khách đổi ý qua điện thoại');
    const diff = event!.diff as {
      items: { sku: string; from: number | null; to: number | null }[];
      totals: Record<string, unknown>;
    };
    expect(diff.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: SKU.edt50, from: 1, to: 2 }),
        expect.objectContaining({ sku: SKU.travel, from: 2, to: null }),
        expect.objectContaining({ sku: SKU.edt100, from: null, to: 1 }),
      ]),
    );
    expect(diff.totals.total).toEqual({ from: order.total, to: 7_800_000 });

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, order.id), eq(auditLogs.action, 'order.edit')));
    expect(JSON.stringify(audit!.diff)).not.toContain('Lê Lợi');
    expect(await jobs('order.updated', order.id)).toEqual([
      { orderId: order.id, version: order.version + 1 },
    ]);

    // Deposit now required: staff cannot confirm until it is paid (D16).
    await expectDomainError(
      changeOrderStatus(ctx('staff'), {
        orderId: order.id,
        to: 'confirmed',
        expectedVersion: after.version,
        reason: null,
      }),
      'invalid',
      [{ path: 'status', code: 'depositRequired' }],
    );

    // Cancelling releases exactly what the edited order holds.
    await cancelOrder(ctx('staff'), {
      orderId: order.id,
      expectedVersion: after.version,
      reason: 'test',
    });
    expect(await stock(SKU.edt50)).toEqual({ onHand: 10, reserved: 0 });
    expect(await stock(SKU.edt100)).toEqual({ onHand: 10, reserved: 0 });
  });

  it('changes only the address without touching money; refuses no-op edits', async () => {
    const order = await place([{ sku: SKU.edt50, quantity: 1 }]);
    const input = await editInput(order.id, (base) => ({
      ...base,
      address: {
        ...base.address,
        street: '99 Nguyễn Huệ',
        provinceCode: otherWard.provinceCode,
        wardCode: otherWard.code,
      },
    }));
    await editOrder(ctx('staff'), input);
    const after = await reload(order.id);
    expect(after.total).toBe(order.total);
    const [address] = await db
      .select()
      .from(orderAddresses)
      .where(eq(orderAddresses.orderId, order.id));
    expect(address).toMatchObject({
      street: '99 Nguyễn Huệ',
      provinceCode: '01',
      wardCode: otherWard.code,
    });

    await expectDomainError(editOrder(ctx('staff'), await editInput(order.id)), 'invalid', [
      { path: 'form', code: 'editNoChange' },
    ]);
    await expectDomainError(
      editOrder(
        ctx('staff'),
        await editInput(order.id, (base) => ({
          ...base,
          address: { ...base.address, wardCode: wardCode },
        })),
      ),
      'invalid',
      [{ path: 'address.wardCode', code: 'wardMismatch' }],
    );
  });

  it('refuses increases beyond available stock and leaves everything unchanged', async () => {
    const order = await place([{ sku: SKU.travel, quantity: 1 }]);
    await setStock(SKU.edt100, 1);
    const edt100 = await variant(SKU.edt100);
    const input = await editInput(order.id, (base) => ({
      ...base,
      items: [...base.items, { variantId: edt100.id, quantity: 2 }],
    }));
    await expectDomainError(editOrder(ctx('staff'), input), 'insufficientStock', [
      { path: 'items.1.quantity', code: 'itemInsufficientStock' },
    ]);
    expect((await reload(order.id)).version).toBe(order.version);
  });

  it('enforces the optimistic lock and the editable statuses', async () => {
    const order = await place([{ sku: SKU.edt50, quantity: 1 }]);
    const stale = await editInput(order.id, (base) => ({
      ...base,
      items: [{ ...base.items[0]!, quantity: 2 }],
    }));
    await editOrder(ctx('staff'), stale);
    await expectDomainError(editOrder(ctx('staff'), stale), 'conflict');
    await expectDomainError(previewOrderEdit(ctx('staff'), stale), 'conflict');
    await expectDomainError(editOrder(ctx('editor'), stale), 'forbidden');

    let current = await reload(order.id);
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: current.version,
      reason: null,
    });
    current = await reload(order.id);
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'processing',
      expectedVersion: current.version,
      reason: null,
    });
    current = await reload(order.id);
    await shipOrder(ctx('staff'), {
      orderId: order.id,
      expectedVersion: current.version,
      carrier: 'ghn',
      trackingCode: 'GHN12345',
      feeActual: null,
    });
    const shipped = await editInput(order.id, (base) => ({
      ...base,
      items: [{ ...base.items[0]!, quantity: 1 }],
    }));
    await expectDomainError(editOrder(ctx('manager'), shipped), 'invalid', [
      { path: 'status', code: 'orderNotEditable' },
    ]);
    expect((await getOrderEditForm(db, order.id))!.editable).toBe(false);
  });
});

describe('edits after confirmation (stock deducted)', () => {
  it('deducts/restocks with movements and keeps committed reservations consistent', async () => {
    const order = await place([{ sku: SKU.edt50, quantity: 2 }]);
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'confirmed',
      expectedVersion: order.version,
      reason: null,
    });
    expect(await stock(SKU.edt50)).toEqual({ onHand: 8, reserved: 0 });
    const travel = await variant(SKU.travel);
    const edt50 = await variant(SKU.edt50);

    let input = await editInput(order.id, (base) => ({
      ...base,
      items: [
        { variantId: edt50.id, quantity: 1 },
        { variantId: travel.id, quantity: 3 },
      ],
    }));
    await editOrder(ctx('staff'), input);
    expect(await stock(SKU.edt50)).toEqual({ onHand: 9, reserved: 0 });
    expect(await stock(SKU.travel)).toEqual({ onHand: 7, reserved: 0 });
    expect(await reservations(order.id, 'committed')).toBe(4);
    const moves = await db
      .select({
        variantId: stockMovements.variantId,
        delta: stockMovements.delta,
        reason: stockMovements.reason,
      })
      .from(stockMovements)
      .where(eq(stockMovements.refId, order.id))
      .orderBy(asc(stockMovements.createdAt));
    expect(moves).toEqual(
      expect.arrayContaining([
        { variantId: edt50.id, delta: 1, reason: 'release' },
        { variantId: travel.id, delta: -3, reason: 'sale' },
      ]),
    );

    // A second edit after moving to packing, then a manager cancellation restocks exactly.
    let current = await reload(order.id);
    await changeOrderStatus(ctx('staff'), {
      orderId: order.id,
      to: 'processing',
      expectedVersion: current.version,
      reason: null,
    });
    input = await editInput(order.id, (base) => ({
      ...base,
      items: [{ variantId: travel.id, quantity: 1 }],
    }));
    await editOrder(ctx('staff'), input);
    expect(await stock(SKU.edt50)).toEqual({ onHand: 10, reserved: 0 });
    expect(await stock(SKU.travel)).toEqual({ onHand: 9, reserved: 0 });
    current = await reload(order.id);
    await cancelOrder(ctx('manager'), {
      orderId: order.id,
      expectedVersion: current.version,
      reason: 'test',
    });
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 0 });
    expect(await stock(SKU.edt50)).toEqual({ onHand: 10, reserved: 0 });
  });
});

describe('payment consequences', () => {
  const gateways: PaymentGateways = {
    vnpay: null,
    payos: createPayosGateway({
      mode: 'simulator',
      clientId: 'c',
      apiKey: 'k',
      checksumKey: SIMULATOR_KEYS.payosChecksumKey,
      apiUrl: 'http://localhost',
    }),
  };

  async function paidOnlineOrder() {
    const order = await place([{ sku: SKU.edt50, quantity: 1 }], { paymentMethod: 'payos' });
    await confirmBankTransfer(ctx('manager'), {
      orderId: order.id,
      amount: order.total,
      bankReference: `FT${Date.now()}`,
      note: null,
    });
    const paid = await reload(order.id);
    expect(paid).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    return paid;
  }

  it('a higher total asks for the difference, payable through a balance session', async () => {
    const order = await paidOnlineOrder();
    const travel = await variant(SKU.travel);
    const input = await editInput(order.id, (base) => ({
      ...base,
      items: [...base.items, { variantId: travel.id, quantity: 1 }],
    }));
    const preview = (await previewOrderEdit(ctx('staff'), input)).data;
    expect(preview.payment).toMatchObject({ onlineDue: 650_000, refund: 0, difference: 650_000 });
    const result = await editOrder(ctx('staff'), input);
    expect(result.data).toMatchObject({ onlineDue: 650_000, refund: 0, refundId: null });
    expect(await reload(order.id)).toMatchObject({
      paymentStatus: 'partially_paid',
      total: order.total + 650_000,
      status: 'confirmed',
    });

    const session = await createPaymentSession(
      { db, boss, gateways },
      { orderId: order.id, provider: 'payos', returnUrl: 'http://localhost/result' },
    );
    expect(session).toMatchObject({ kind: 'adjustment', amount: 650_000, status: 'pending' });
  });

  it('a lower total queues a refund of the excess', async () => {
    const order = await paidOnlineOrder();
    const travel = await variant(SKU.travel);
    const input = await editInput(order.id, (base) => ({
      ...base,
      items: [{ variantId: travel.id, quantity: 1 }],
    }));
    const result = await editOrder(ctx('staff'), input);
    const after = await reload(order.id);
    // 650,000 + 30,000 shipping (below the free-shipping threshold).
    expect(after.total).toBe(680_000);
    expect(result.data.refund).toBe(order.total - 680_000);
    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refund).toMatchObject({
      amount: order.total - 680_000,
      status: 'requested',
      reason: 'order_edited',
      method: 'bank_transfer',
    });
    expect(after.paymentStatus).toBe('paid');
  });

  it('cancels a pending session whose amount is stale', async () => {
    const order = await place([{ sku: SKU.edt50, quantity: 1 }], { paymentMethod: 'payos' });
    await createPaymentSession(
      { db, boss, gateways },
      { orderId: order.id, provider: 'payos', returnUrl: 'http://localhost/result' },
    );
    const input = await editInput(order.id, (base) => ({
      ...base,
      items: [{ ...base.items[0]!, quantity: 2 }],
    }));
    await editOrder(ctx('staff'), input);
    const sessions = await db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, order.id));
    expect(sessions.map((s) => s.status)).toEqual(['cancelled']);
    const next = await createPaymentSession(
      { db, boss, gateways },
      { orderId: order.id, provider: 'payos', returnUrl: 'http://localhost/result' },
    );
    expect(next.amount).toBe((await reload(order.id)).total);
  });
});

describe('coupon and shipping fee', () => {
  it('drops a coupon whose terms no longer hold and gives its use back', async () => {
    const order = await place([{ sku: SKU.edt50, quantity: 1 }], { couponCode: 'FREESHIP' });
    expect(order.couponCode).toBe('FREESHIP');
    const [coupon] = await db.select().from(coupons).where(eq(coupons.code, 'FREESHIP'));
    const travel = await variant(SKU.travel);
    const input = await editInput(order.id, (base) => ({
      ...base,
      items: [{ variantId: travel.id, quantity: 1 }],
    }));
    const preview = (await previewOrderEdit(ctx('staff'), input)).data;
    expect(preview.coupon).toEqual({ code: 'FREESHIP', kept: false, reason: 'min_subtotal' });
    await editOrder(ctx('staff'), input);
    const after = await reload(order.id);
    expect(after).toMatchObject({ couponCode: null, shippingFee: 30_000, total: 680_000 });
    expect(
      await db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, order.id)),
    ).toEqual([]);
    const [couponAfter] = await db.select().from(coupons).where(eq(coupons.id, coupon!.id));
    expect(couponAfter!.usedCount).toBe(coupon!.usedCount - 1);
    const [event] = await db
      .select({ metadata: orderEvents.metadata })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.type, 'edited')));
    expect(event!.metadata).toMatchObject({
      couponDropped: { code: 'FREESHIP', reason: 'min_subtotal' },
    });
  });

  it('only managers override the shipping fee; the override stays on later edits', async () => {
    const order = await place([{ sku: SKU.travel, quantity: 1 }]);
    const override = await editInput(order.id, (base) => ({
      ...base,
      shippingFeeOverride: { amount: 0, reason: 'Khách quen, miễn phí ship' },
    }));
    await expectDomainError(editOrder(ctx('staff'), override), 'forbidden', [
      { path: 'shippingFeeOverride.amount', code: 'overrideForbidden' },
    ]);
    await editOrder(ctx('manager'), override);
    expect(await reload(order.id)).toMatchObject({ shippingFee: 0, total: 650_000 });
    expect((await getOrderEditForm(db, order.id))!.shippingFeeOverride).toBe(0);

    // Staff edit the lines later: the manager's override still applies.
    await editOrder(
      ctx('staff'),
      await editInput(order.id, (base) => ({
        ...base,
        items: [{ ...base.items[0]!, quantity: 2 }],
      })),
    );
    expect(await reload(order.id)).toMatchObject({ shippingFee: 0, total: 1_300_000 });

    // Removing the override goes back to the rate table.
    await editOrder(
      ctx('manager'),
      await editInput(order.id, (base) => ({
        ...base,
        items: [{ ...base.items[0]!, quantity: 1 }],
        shippingFeeOverride: { amount: null, reason: 'Bỏ miễn phí' },
      })),
    );
    expect(await reload(order.id)).toMatchObject({ shippingFee: 30_000, total: 680_000 });
  });
});

describe('variant picker', () => {
  it('finds sellable variants by name or SKU and never offers decants', async () => {
    const found = await searchEditVariants(db, { q: 'CEDR', locale: 'vi' });
    expect(found.map((v) => v.sku)).toEqual(expect.arrayContaining([SKU.edt100, SKU.edt50]));
    expect(found.every((v) => v.purchasable && v.available >= 0)).toBe(true);
    const all = await searchEditVariants(db, { q: '', locale: 'vi', limit: 200 });
    const decants = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.variantType, 'decant'));
    const ids = new Set(all.map((v) => v.variantId));
    expect(decants.every((d) => !ids.has(d.id))).toBe(true);
  });
});
