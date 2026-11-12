import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import {
  auditLogs,
  couponRedemptions,
  inventoryItems,
  orderEvents,
  orderItems,
  orders,
  payments,
  productVariants,
  stockReservations,
  users,
  wards,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError, type CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  manualOrderSchema,
  placeManualOrder,
  quoteManualOrder,
  searchOrderableVariants,
  type ManualOrderRawInput,
} from '@/server/modules/checkout';
import { lookupCustomers } from '@/server/modules/customer';
import { confirmBankTransfer } from '@/server/modules/payment';
import { quoteShipping } from '@/server/modules/shipping';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Manual (staff) orders against a real PostgreSQL (§3.4 step 7, §11.2): same pricing and stock
 * reservation as web orders, COD confirmed on the phone, bank transfer confirmed by a Manager
 * (payment module ledger), payment-link orders, customer lookup/linking, RBAC, idempotency,
 * rollback.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let wardCode: string;
const staffIds = {} as Record<StaffRole, string>;

const SKU = {
  edt100: 'MAIS-CEDR-EDT-100', // 3,200,000 ₫
  edt50: 'MAIS-CEDR-EDT-50', // 2,300,000 ₫
  travel: 'ATEL-HOA--EDP-10', // 650,000 ₫
  parfum: 'AMBR-SOLE-PARFUM-50', // 5,400,000 ₫
} as const;

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

const ctx = (role: StaffRole): CommandContext => ({
  db,
  boss,
  actor: { id: staffIds[role], role },
  ip: '198.51.100.4',
});

let keySeq = 0;
async function form(
  lines: { sku: string; quantity: number }[],
  overrides: Partial<ManualOrderRawInput> = {},
) {
  keySeq += 1;
  const items = [];
  for (const line of lines)
    items.push({ variantId: (await variant(line.sku)).id, quantity: line.quantity });
  const [rate] = await quoteShipping(db, { provinceCode: '79', weightG: 500, locale: 'vi' });
  return manualOrderSchema.parse({
    checkoutKey: `manual-${Date.now()}-${keySeq}-abcdef`,
    customer: { fullName: 'Lê Thị Phone', phone: '0901234567', email: '', locale: 'vi' },
    items,
    address: { provinceCode: '79', wardCode, street: '45 Nguyễn Huệ' },
    shippingRateId: rate!.rateId,
    paymentOption: 'cod',
    ...overrides,
  } satisfies ManualOrderRawInput);
}

async function events(orderId: string) {
  return db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.createdAt, orderEvents.id);
}

async function jobs(name: string, orderId: string) {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} and data->>'orderId' = ${orderId}`,
  );
  return result.rows.map((row) => row.data);
}

async function domainError(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
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
  const [ward] = await db.select().from(wards).where(eq(wards.provinceCode, '79')).limit(1);
  wardCode = ward!.code;
  for (const role of ['owner', 'manager', 'staff', 'editor'] as const) {
    staffIds[role] = newId();
    await db
      .insert(users)
      .values({ id: staffIds[role], name: role, email: `${role}@staff.test`, role });
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

describe('placeManualOrder: COD', () => {
  it('creates a confirmed COD order for a new phone customer without e-mail', async () => {
    const input = await form([{ sku: SKU.edt50, quantity: 2 }], {
      staffNote: 'Giao giờ hành chính',
    });
    const { data, tags } = await placeManualOrder(ctx('staff'), input);

    expect(data).toMatchObject({
      status: 'confirmed',
      paymentMethod: 'cod',
      total: 4_600_000,
      depositRequired: 0,
      paymentLink: null,
      duplicate: false,
    });
    expect(tags).toEqual(expect.arrayContaining(['orders:list', `order:${data.orderId}`]));

    const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId));
    expect(order).toMatchObject({
      source: 'admin',
      createdBy: staffIds.staff,
      email: '',
      phone: '0901234567',
      customerName: 'Lê Thị Phone',
      userId: null,
      internalNote: 'Giao giờ hành chính',
      subtotal: 4_600_000,
      shippingFee: 0,
      ipAddress: null,
      paymentStatus: 'unpaid',
    });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, data.orderId));
    expect(item).toMatchObject({ sku: SKU.edt50, quantity: 2, unitPrice: 2_300_000 });

    const timeline = await events(data.orderId);
    expect(timeline.map((e) => [e.type, e.actorType, e.actorId])).toEqual([
      ['placed', 'staff', staffIds.staff],
      ['created_by_staff', 'staff', staffIds.staff],
      ['note', 'staff', staffIds.staff],
      ['status_changed', 'staff', staffIds.staff],
    ]);
    expect(timeline[0]!.metadata).toMatchObject({ source: 'admin', paymentMethod: 'cod' });
    expect(timeline[3]).toMatchObject({
      fromStatus: 'awaiting_confirmation',
      toStatus: 'confirmed',
    });

    // Confirmed → reservation committed: on hand down by 2, nothing left reserved.
    expect(await stock(SKU.edt50)).toEqual({ onHand: 8, reserved: 0 });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityId, data.orderId), eq(auditLogs.action, 'order.create_manual')),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.ip).toBe('198.51.100.4');
    expect(JSON.stringify(audit[0]!.diff)).not.toContain('0901234567');
    expect(await jobs('order.placed', data.orderId)).toHaveLength(1);
  });

  it('leaves COD awaiting confirmation (24 h reservation) when not confirmed on the phone', async () => {
    const before = Date.now();
    const { data } = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.travel, quantity: 3 }], { confirmNow: false }),
    );
    expect(data.status).toBe('awaiting_confirmation');
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 3 });
    const [reservation] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, data.orderId));
    const hours = (reservation!.expiresAt.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  it('asks a COD order above the threshold for its deposit link instead of confirming', async () => {
    const { data } = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.parfum, quantity: 1 }], { linkProvider: 'vnpay' }),
    );
    expect(data.status).toBe('pending');
    expect(data.depositRequired).toBeGreaterThan(0);
    expect(data.paymentLink).toBe('vnpay');
  });
});

describe('placeManualOrder: bank transfer', () => {
  it('a Manager records a received transfer: paid and confirmed in the same transaction', async () => {
    const { data } = await placeManualOrder(
      ctx('manager'),
      await form([{ sku: SKU.edt100, quantity: 1 }], {
        paymentOption: 'bank_transfer',
        transfer: { received: true, bankReference: 'FT26316123456' },
      }),
    );
    expect(data).toMatchObject({ status: 'confirmed', paymentMethod: 'bank_transfer' });

    const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId));
    expect(order).toMatchObject({ paymentStatus: 'paid', amountPaid: 3_200_000, amountDue: 0 });
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, data.orderId));
    expect(payment).toMatchObject({
      provider: 'bank_manual',
      kind: 'full',
      status: 'succeeded',
      amount: 3_200_000,
      providerTxnId: 'FT26316123456',
      confirmedBy: staffIds.manager,
    });
    const types = (await events(data.orderId)).map((e) => e.type);
    expect(types).toEqual(['placed', 'created_by_staff', 'payment_received', 'status_changed']);
    expect(await stock(SKU.edt100)).toEqual({ onHand: 9, reserved: 0 });
    const actions = (
      await db.select().from(auditLogs).where(eq(auditLogs.entityId, data.orderId))
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(['payment.confirm_bank_transfer', 'order.create_manual']),
    );
    expect(await jobs('payment.received', data.orderId)).toHaveLength(1);
  });

  it('Staff cannot record a received transfer; nothing is written', async () => {
    const input = await form([{ sku: SKU.edt100, quantity: 1 }], {
      paymentOption: 'bank_transfer',
      transfer: { received: true, bankReference: 'FT1' },
    });
    const error = await domainError(placeManualOrder(ctx('staff'), input));
    expect(error.code).toBe('forbidden');
    const rows = await db.select().from(orders).where(eq(orders.checkoutKey, input.checkoutKey));
    expect(rows).toHaveLength(0);
    expect(await stock(SKU.edt100)).toEqual({ onHand: 10, reserved: 0 });
  });

  it('a transfer still to come waits (pending, 24 h hold) until a Manager confirms it', async () => {
    const before = Date.now();
    const { data } = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.edt50, quantity: 1 }], { paymentOption: 'bank_transfer' }),
    );
    expect(data).toMatchObject({ status: 'pending', paymentLink: null });
    const [reservation] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, data.orderId));
    expect((reservation!.expiresAt.getTime() - before) / 3_600_000).toBeGreaterThan(23.9);

    const confirmed = await confirmBankTransfer(ctx('manager'), {
      orderId: data.orderId,
      amount: data.total,
      bankReference: 'FT-LATER',
      note: null,
    });
    expect(confirmed.data).toMatchObject({ paymentStatus: 'paid', confirmed: true });
    const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId));
    expect(order!.status).toBe('confirmed');
  });
});

describe('placeManualOrder: payment link, customers, coupons', () => {
  it('payment-link orders are pending with the online reservation and name the provider', async () => {
    const before = Date.now();
    const { data } = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.travel, quantity: 1 }], {
        paymentOption: 'payment_link',
        linkProvider: 'payos',
        customer: {
          fullName: 'Khách Zalo',
          phone: '0933333333',
          email: 'zalo@example.com',
          locale: 'en',
        },
      }),
    );
    expect(data).toMatchObject({
      status: 'pending',
      paymentMethod: 'payos',
      paymentLink: 'payos',
      locale: 'en',
    });
    const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId));
    expect(order).toMatchObject({ email: 'zalo@example.com', locale: 'en' });
    const [reservation] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, data.orderId));
    const minutes = (reservation!.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThan(31);
    // Snapshot names in the customer's language (English label).
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, data.orderId));
    expect(item!.variantLabel).toBe('Travel 10 ml');
  });

  it('e-mails the payment link to the customer when an e-mail exists (M3 outbox)', async () => {
    const { data } = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.travel, quantity: 1 }], {
        paymentOption: 'payment_link',
        linkProvider: 'vnpay',
        customer: {
          fullName: 'Khách Mail',
          phone: '0935555555',
          email: 'mail@example.com',
          locale: 'vi',
        },
      }),
    );
    expect(data.linkEmailed).toBe(true);
    expect(await jobs('order.payment-link', data.orderId)).toEqual([{ orderId: data.orderId }]);

    // No e-mail (phone-only customer) or no link: nothing to send.
    const phoneOnly = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.travel, quantity: 1 }], {
        paymentOption: 'payment_link',
        linkProvider: 'payos',
      }),
    );
    expect(phoneOnly.data.linkEmailed).toBe(false);
    expect(await jobs('order.payment-link', phoneOnly.data.orderId)).toEqual([]);
  });

  it('links a registered customer found by lookup; contact comes from the account', async () => {
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      name: 'Phạm Minh Khách',
      email: 'member@example.com',
      phone: '0944444444',
      locale: 'en',
    });
    const matches = await lookupCustomers(db, { phone: '0944444444' });
    expect(matches[0]).toMatchObject({
      ref: { type: 'user', id: userId },
      registered: true,
      phoneMasked: '094****444',
      emailMasked: 'm***@example.com',
      locale: 'en',
    });
    expect(JSON.stringify(matches)).not.toContain('member@example.com');

    const { data } = await placeManualOrder(
      ctx('staff'),
      await form([{ sku: SKU.edt50, quantity: 1 }], {
        customer: {
          ref: matches[0]!.ref,
          fullName: 'Phạm Minh Khách',
          phone: '',
          email: '',
          locale: 'en',
        },
        couponCode: 'welcome10',
      }),
    );
    const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId));
    expect(order).toMatchObject({
      userId,
      email: 'member@example.com',
      phone: '0944444444',
      locale: 'en',
      couponCode: 'WELCOME10',
      discountTotal: 200_000, // 10 %, capped at 200,000
      total: 2_100_000,
    });
    const redemptions = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.orderId, data.orderId));
    expect(redemptions).toHaveLength(1);

    // Later lookups by the same phone show the guest contacts too, masked.
    const guest = await lookupCustomers(db, { phone: '0901234567' });
    expect(guest.every((m) => m.ref.type === 'order' && m.phoneMasked === '090****567')).toBe(true);
  });

  it('quotes exactly what it will charge', async () => {
    const input = await form([{ sku: SKU.edt100, quantity: 1 }], { couponCode: 'WELCOME10' });
    const quote = await quoteManualOrder(db, {
      items: input.items,
      provinceCode: '79',
      shippingRateId: input.shippingRateId,
      paymentOption: 'cod',
      linkProvider: 'payos',
      couponCode: 'WELCOME10',
      customer: { ref: null, phone: '0966666666', email: '' },
    });
    const { data } = await placeManualOrder(ctx('staff'), {
      ...input,
      customer: { ...input.customer, phone: '0966666666' },
    });
    expect(quote.totals.total).toBe(data.total);
    expect(quote.lines[0]).toMatchObject({ sku: SKU.edt100, available: 10, issue: null });
  });
});

describe('placeManualOrder: guards', () => {
  it('rejects a short stock with the line path and rolls everything back', async () => {
    await setStock(SKU.edt100, 1);
    const input = await form([
      { sku: SKU.edt100, quantity: 2 },
      { sku: SKU.travel, quantity: 1 },
    ]);
    const error = await domainError(placeManualOrder(ctx('staff'), input));
    const edt = await variant(SKU.edt100);
    expect(error.fieldErrors).toEqual([{ path: `items.${edt.id}`, code: 'itemInsufficientStock' }]);
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 0 });
    expect(
      await db.select().from(orders).where(eq(orders.checkoutKey, input.checkoutKey)),
    ).toHaveLength(0);
  });

  it('never sells decants or unknown variants', async () => {
    const [decant] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.variantType, 'decant'))
      .limit(1);
    const input = await form([{ sku: SKU.travel, quantity: 1 }]);
    const unknown = { ...input, items: [{ variantId: newId(), quantity: 1 }] };
    expect((await domainError(placeManualOrder(ctx('staff'), unknown))).fieldErrors).toEqual([
      { path: 'items', code: 'cartEmpty' },
    ]);
    if (decant) {
      const withDecant = { ...input, items: [{ variantId: decant.id, quantity: 1 }] };
      const error = await domainError(placeManualOrder(ctx('staff'), withDecant));
      expect(error.fieldErrors).toEqual([{ path: `items.${decant.id}`, code: 'itemUnavailable' }]);
    }
    const found = await searchOrderableVariants(db, { q: 'ml' });
    expect(found.every((v) => (v.variantType as string) !== 'decant')).toBe(true);
    expect((await searchOrderableVariants(db, { q: 'CEDR' })).length).toBeGreaterThan(0);
  });

  it('a double submit returns the first order', async () => {
    const input = await form([{ sku: SKU.edt50, quantity: 1 }]);
    const [first, second] = await Promise.all([
      placeManualOrder(ctx('staff'), input),
      placeManualOrder(ctx('staff'), input),
    ]);
    expect(first.data.orderId).toBe(second.data.orderId);
    expect([first.data.duplicate, second.data.duplicate].sort()).toEqual([false, true]);
    expect(await stock(SKU.edt50)).toEqual({ onHand: 9, reserved: 0 });
  });

  it('requires orders.createManual', async () => {
    const error = await domainError(
      placeManualOrder(ctx('editor'), await form([{ sku: SKU.edt50, quantity: 1 }])),
    );
    expect(error.code).toBe('forbidden');
  });

  it('rejects an unknown customer reference', async () => {
    const input = await form([{ sku: SKU.edt50, quantity: 1 }], {
      customer: {
        ref: { type: 'user', id: staffIds.manager },
        fullName: 'Not a customer',
        phone: '0912345678',
        email: '',
        locale: 'vi',
      },
    });
    const error = await domainError(placeManualOrder(ctx('staff'), input));
    expect(error.fieldErrors).toEqual([{ path: 'customer.ref', code: 'notFound' }]);
  });
});
