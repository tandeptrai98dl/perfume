import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkoutFormSchema, type CheckoutFormInput } from '@/lib/checkout/form-schema';
import { createDb, type Database } from '@/server/db/client';
import {
  cartItems,
  carts,
  consents,
  coupons,
  couponRedemptions,
  inventoryItems,
  orderAddresses,
  orderEvents,
  orderItems,
  orders,
  productVariants,
  shippingRates,
  stockReservations,
  wards,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { DomainError } from '@/server/lib/command-context';
import { hashCartToken, newCartToken } from '@/server/modules/cart';
import {
  placeOrder,
  quoteCheckout,
  type PlaceOrderInput,
  type PlacedOrder,
} from '@/server/modules/checkout';
import { quoteShipping } from '@/server/modules/shipping';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * placeOrder against a real PostgreSQL (§3.4 steps 1–2, §10.4 acceptance): statuses per payment
 * method and deposit, snapshots, reservations, coupon limits, idempotency, last-unit race,
 * stale shipping rates and full rollback on failure.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let provinceCode: string;
let wardCode: string;
let otherProvinceWard: string;

const SKU = {
  edt100: 'MAIS-CEDR-EDT-100', // 3,200,000 ₫, 450 g
  edt50: 'MAIS-CEDR-EDT-50', // 2,300,000 ₫
  travel: 'ATEL-HOA--EDP-10', // 650,000 ₫, 60 g
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

async function createCart(
  lines: { sku: string; quantity: number; priceWhenAdded?: number }[],
  options: { giftWrap?: boolean; giftMessage?: string; couponCode?: string } = {},
) {
  const [cart] = await db
    .insert(carts)
    .values({
      tokenHash: hashCartToken(newCartToken()),
      expiresAt: new Date(Date.now() + 86_400_000),
      giftWrap: options.giftWrap ?? false,
      giftMessage: options.giftMessage ?? null,
      couponCode: options.couponCode ?? null,
    })
    .returning();
  for (const line of lines) {
    const v = await variant(line.sku);
    await db.insert(cartItems).values({
      cartId: cart!.id,
      variantId: v.id,
      quantity: line.quantity,
      priceWhenAdded: line.priceWhenAdded ?? v.price,
    });
  }
  return cart!;
}

async function standardRateId(weightG = 500, province = provinceCode) {
  const quotes = await quoteShipping(db, { provinceCode: province, weightG, locale: 'vi' });
  return quotes[0]!.rateId;
}

let keySeq = 0;
function checkoutKey() {
  keySeq += 1;
  return `test-key-${Date.now()}-${keySeq}-abcdef`;
}

/** Goes through the real form schema, like the Server Action. */
async function input(
  cartId: string,
  overrides: Partial<CheckoutFormInput> = {},
  extra: Partial<PlaceOrderInput> = {},
): Promise<PlaceOrderInput> {
  const raw: CheckoutFormInput = {
    locale: 'vi',
    checkoutKey: checkoutKey(),
    email: 'khach@example.com',
    phone: '0912345678',
    fullName: 'Nguyễn Văn A',
    address: { provinceCode, wardCode, street: '12 Lê Lợi' },
    shippingRateId: await standardRateId(),
    paymentMethod: 'cod',
    couponCode: '',
    customerNote: '',
    vatInvoice: {
      requested: false,
      companyName: '',
      taxCode: '',
      email: '',
      address: { provinceCode: '', wardCode: '', street: '' },
    },
    consents: { terms: true, privacy: true, marketing: false },
    ...overrides,
  };
  const form = checkoutFormSchema.parse(raw);
  const { locale, checkoutKey: key, ...fields } = form;
  return {
    ...fields,
    cartId,
    checkoutKey: key,
    locale,
    userId: null,
    ip: '203.0.113.7',
    userAgent: 'vitest',
    ...extra,
  };
}

const deps = () => ({ db, boss });

async function jobs(name: string, orderId: string) {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} and data->>'orderId' = ${orderId}`,
  );
  return result.rows.map((row) => row.data);
}

async function expectDomainError(promise: Promise<unknown>, code: string, issues: unknown[]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  expect((error as DomainError).fieldErrors).toEqual(issues);
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
  provinceCode = '79';
  wardCode = ward!.code;
  const [other] = await db.select().from(wards).where(eq(wards.provinceCode, '01')).limit(1);
  otherProvinceWard = other!.code;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

beforeEach(async () => {
  for (const sku of Object.values(SKU)) await setStock(sku, 10);
});

describe('placeOrder: statuses and snapshots', () => {
  it('places a COD order below the threshold: awaiting confirmation, 24 h reservation', async () => {
    const cart = await createCart([
      { sku: SKU.edt50, quantity: 1, priceWhenAdded: 1 }, // stale cart price is ignored
      { sku: SKU.travel, quantity: 2 },
    ]);
    const before = Date.now();
    const placed = await placeOrder(deps(), await input(cart.id));

    expect(placed).toMatchObject({
      status: 'awaiting_confirmation',
      paymentMethod: 'cod',
      depositRequired: 0,
      duplicate: false,
      locale: 'vi',
    });
    expect(placed.code).toMatch(/^PF-\d{6}-[2-9A-HJKMNP-Z]{4}$/);

    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    // 2,300,000 + 2 × 650,000 = 3,600,000; free standard shipping over 2,000,000.
    expect(order).toMatchObject({
      subtotal: 3_600_000,
      discountTotal: 0,
      shippingFee: 0,
      giftWrapFee: 0,
      total: 3_600_000,
      amountDue: 3_600_000,
      source: 'web',
      paymentStatus: 'unpaid',
      phone: '0912345678',
      email: 'khach@example.com',
      customerName: 'Nguyễn Văn A',
      vatInvoice: null,
      ipAddress: '203.0.113.7',
    });

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, placed.orderId))
      .orderBy(orderItems.sku);
    expect(items.map((i) => [i.sku, i.quantity, i.unitPrice, i.lineTotal, i.variantLabel])).toEqual(
      [
        [SKU.travel, 2, 650_000, 1_300_000, 'Du lịch 10 ml'],
        [SKU.edt50, 1, 2_300_000, 2_300_000, '50 ml'],
      ],
    );
    expect(items.every((i) => i.productName.length > 0)).toBe(true);

    const addresses = await db
      .select()
      .from(orderAddresses)
      .where(eq(orderAddresses.orderId, placed.orderId));
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatchObject({
      type: 'shipping',
      provinceCode,
      provinceName: 'Thành phố Hồ Chí Minh',
      wardCode,
      street: '12 Lê Lợi',
    });

    const events = await db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, placed.orderId));
    expect(events.map((e) => [e.type, e.toStatus, e.actorType])).toEqual([
      ['placed', 'awaiting_confirmation', 'customer'],
    ]);

    const reservations = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, placed.orderId));
    expect(reservations).toHaveLength(2);
    for (const r of reservations) {
      const hours = (r.expiresAt.getTime() - before) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThan(24.1);
    }
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 2 });

    const [after] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(after!.status).toBe('converted');

    const consentRows = await db
      .select()
      .from(consents)
      .where(eq(consents.email, 'khach@example.com'));
    expect(consentRows.map((c) => [c.purpose, c.granted, c.source]).sort()).toEqual([
      ['privacy', true, 'checkout'],
      ['terms', true, 'checkout'],
    ]);

    expect(await jobs('order.placed', placed.orderId)).toEqual([{ orderId: placed.orderId }]);
    expect(await jobs('staff.alert', placed.orderId)).toEqual([]);
  });

  it('places an online order: pending, 30 min reservation, VAT invoice, gift wrap, marketing opt-in', async () => {
    const cart = await createCart([{ sku: SKU.travel, quantity: 1 }], {
      giftWrap: true,
      giftMessage: 'Chúc mừng sinh nhật',
    });
    const before = Date.now();
    const placed = await placeOrder(
      deps(),
      await input(cart.id, {
        paymentMethod: 'payos',
        email: 'online@example.com',
        consents: { terms: true, privacy: true, marketing: true },
        vatInvoice: {
          requested: true,
          companyName: 'Công ty TNHH ABC',
          taxCode: '0312345678',
          email: 'ketoan@abc.vn',
          address: { provinceCode: '01', wardCode: otherProvinceWard, street: '1 Tràng Tiền' },
        },
      }),
    );
    expect(placed.status).toBe('pending');

    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    // 650,000 + 30,000 shipping + 50,000 gift wrap.
    expect(order).toMatchObject({
      subtotal: 650_000,
      shippingFee: 30_000,
      giftWrapFee: 50_000,
      total: 730_000,
      giftWrap: true,
      giftMessage: 'Chúc mừng sinh nhật',
      paymentMethod: 'payos',
      depositRequired: 0,
    });
    expect(order!.vatInvoice).toMatchObject({
      companyName: 'Công ty TNHH ABC',
      taxCode: '0312345678',
      email: 'ketoan@abc.vn',
    });
    expect((order!.vatInvoice as { address: string }).address).toMatch(
      /^1 Tràng Tiền, .+, Thành phố Hà Nội$/,
    );

    const billing = await db
      .select()
      .from(orderAddresses)
      .where(and(eq(orderAddresses.orderId, placed.orderId), eq(orderAddresses.type, 'billing')));
    expect(billing[0]).toMatchObject({ fullName: 'Công ty TNHH ABC', provinceCode: '01' });

    const [reservation] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, placed.orderId));
    const minutes = (reservation!.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);

    const consentRows = await db
      .select()
      .from(consents)
      .where(eq(consents.email, 'online@example.com'));
    expect(consentRows.map((c) => c.purpose).sort()).toEqual([
      'marketing_email',
      'privacy',
      'terms',
    ]);
  });

  it('requires a deposit for COD above 5,000,000 ₫: pending + staff alert without PII', async () => {
    const cart = await createCart([{ sku: SKU.parfum, quantity: 1 }]);
    const placed = await placeOrder(deps(), await input(cart.id, { phone: '0987654321' }));
    expect(placed).toMatchObject({
      status: 'pending',
      total: 5_400_000,
      depositRequired: 1_080_000,
    });
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order!.depositRequired).toBe(1_080_000);
    const alerts = await jobs('staff.alert', placed.orderId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'high_value_cod', orderId: placed.orderId });
    expect(JSON.stringify(alerts[0])).not.toMatch(/0987654321|khach@example\.com|Nguyễn/);
  });

  it('stores English names and labels for an English order', async () => {
    const cart = await createCart([{ sku: SKU.edt100, quantity: 1 }]);
    const placed = await placeOrder(deps(), await input(cart.id, { locale: 'en' }));
    expect(placed.locale).toBe('en');
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.orderId));
    expect(item).toMatchObject({ variantLabel: '100 ml', productName: 'Cèdre Nocturne EDT' });
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order!.locale).toBe('en');
  });
});

describe('placeOrder: idempotency and races', () => {
  it('returns the first order for a repeated checkout key', async () => {
    const cart = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    const form = await input(cart.id);
    const first = await placeOrder(deps(), form);
    const second = await placeOrder(deps(), form);
    expect(second).toMatchObject({ orderId: first.orderId, code: first.code, duplicate: true });
    const rows = await db.select().from(orders).where(eq(orders.checkoutKey, form.checkoutKey));
    expect(rows).toHaveLength(1);
    expect(await stock(SKU.travel)).toEqual({ onHand: 10, reserved: 1 });
  });

  it('creates one order when the same checkout is submitted twice at once', async () => {
    const cart = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    const form = await input(cart.id);
    const results = await Promise.all([placeOrder(deps(), form), placeOrder(deps(), form)]);
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
  });

  it('lets exactly one of two buyers racing for the last unit place an order', async () => {
    await setStock(SKU.edt100, 1);
    const [a, b] = [
      await createCart([{ sku: SKU.edt100, quantity: 1 }]),
      await createCart([{ sku: SKU.edt100, quantity: 1 }]),
    ];
    const [inputA, inputB] = [
      await input(a.id, { phone: '0901111111' }),
      await input(b.id, { phone: '0902222222' }),
    ];
    const results = await Promise.allSettled([
      placeOrder(deps(), inputA),
      placeOrder(deps(), inputB),
    ]);
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<PlacedOrder> => r.status === 'fulfilled',
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = rejected[0]!.reason as DomainError;
    expect(reason).toBeInstanceOf(DomainError);
    const v = await variant(SKU.edt100);
    expect(reason.fieldErrors).toEqual([{ path: `items.${v.id}`, code: 'itemInsufficientStock' }]);

    const rows = await db
      .select()
      .from(orders)
      .where(inArray(orders.checkoutKey, [inputA.checkoutKey, inputB.checkoutKey]));
    expect(rows).toHaveLength(1);
    expect(await stock(SKU.edt100)).toEqual({ onHand: 1, reserved: 1 });
    expect(fulfilled[0]!.value.orderId).toBe(rows[0]!.id);
    const losingCart = rows[0]!.phone === '0901111111' ? b : a;
    const [cartRow] = await db.select().from(carts).where(eq(carts.id, losingCart.id));
    expect(cartRow!.status).toBe('active');
  });
});

describe('placeOrder: server-side pricing and validation', () => {
  it('ignores client prices and rejects a stale displayed total', async () => {
    const cart = await createCart([{ sku: SKU.edt50, quantity: 1, priceWhenAdded: 1000 }]);
    const tampered = {
      ...(await input(cart.id)),
      unitPrice: 1,
      total: 1,
      subtotal: 1,
    } as PlaceOrderInput;
    const placed = await placeOrder(deps(), tampered);
    expect(placed.total).toBe(2_300_000);

    const other = await createCart([{ sku: SKU.edt50, quantity: 1 }]);
    await expectDomainError(
      placeOrder(deps(), await input(other.id, { expectedTotal: 1 })),
      'conflict',
      [{ path: 'total', code: 'priceChanged' }],
    );
  });

  it('matches the live quote exactly', async () => {
    const cart = await createCart([{ sku: SKU.travel, quantity: 2 }], { giftWrap: true });
    const quote = await quoteCheckout(db, {
      cart: { ...cart },
      locale: 'vi',
      provinceCode,
      paymentMethod: 'cod',
      couponCode: 'WELCOME10',
      customer: { phone: '0933333333' },
    });
    expect(quote.coupon).toMatchObject({ code: 'WELCOME10', applied: true });
    const placed = await placeOrder(
      deps(),
      await input(cart.id, {
        phone: '0933333333',
        couponCode: 'welcome10',
        shippingRateId: quote.shippingRateId!,
        expectedTotal: quote.totals.total,
      }),
    );
    expect(placed.total).toBe(quote.totals.total);
    // 1,300,000 − 10% (130,000) + 30,000 + 50,000.
    expect(placed.total).toBe(1_250_000);
    const [order] = await db.select().from(orders).where(eq(orders.id, placed.orderId));
    expect(order).toMatchObject({ discountTotal: 130_000, couponCode: 'WELCOME10' });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.orderId));
    expect(item).toMatchObject({ discountAllocated: 130_000, lineTotal: 1_170_000 });
    const [redemption] = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.orderId, placed.orderId));
    expect(redemption).toMatchObject({ amount: 130_000, phone: '0933333333' });
  });

  it('enforces the coupon limit per phone, also under concurrency', async () => {
    const first = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    await placeOrder(
      deps(),
      await input(first.id, {
        phone: '0944444444',
        email: 'first@example.com',
        couponCode: 'WELCOME10',
      }),
    );
    const again = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    await expectDomainError(
      placeOrder(
        deps(),
        await input(again.id, {
          phone: '0944444444',
          email: 'other@example.com',
          couponCode: 'WELCOME10',
        }),
      ),
      'invalid',
      [{ path: 'couponCode', code: 'couponPerCustomerLimit' }],
    );

    const [c1, c2] = [
      await createCart([{ sku: SKU.travel, quantity: 1 }]),
      await createCart([{ sku: SKU.travel, quantity: 1 }]),
    ];
    // Inputs first, so both transactions really run at the same time.
    const twins = [
      await input(c1.id, {
        phone: '0977777777',
        email: 'single@example.com',
        couponCode: 'WELCOME10',
      }),
      await input(c2.id, {
        phone: '0977777777',
        email: 'twin@example.com',
        couponCode: 'WELCOME10',
      }),
    ];
    const results = await Promise.allSettled(twins.map((twin) => placeOrder(deps(), twin)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const redemptions = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.phone, '0977777777'));
    expect(redemptions).toHaveLength(1);
  });

  it('rejects a shipping rate that is no longer offered', async () => {
    const cart = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    const form = await input(cart.id);
    await db
      .update(shippingRates)
      .set({ isActive: false })
      .where(eq(shippingRates.id, form.shippingRateId));
    try {
      await expectDomainError(placeOrder(deps(), form), 'invalid', [
        { path: 'shippingRateId', code: 'shippingRateUnavailable' },
      ]);
    } finally {
      await db
        .update(shippingRates)
        .set({ isActive: true })
        .where(eq(shippingRates.id, form.shippingRateId));
    }
  });

  it('rejects a ward outside the chosen province', async () => {
    const cart = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    await expectDomainError(
      placeOrder(
        deps(),
        await input(cart.id, {
          address: { provinceCode, wardCode: otherProvinceWard, street: '12 Lê Lợi' },
        }),
      ),
      'invalid',
      [{ path: 'address.wardCode', code: 'wardMismatch' }],
    );
  });

  it('rejects lines over the per-line cap, unavailable lines and empty or converted carts', async () => {
    const travel = await variant(SKU.travel);
    const over = await createCart([{ sku: SKU.travel, quantity: 6 }]);
    await expectDomainError(placeOrder(deps(), await input(over.id)), 'invalid', [
      { path: `items.${travel.id}`, code: 'itemQuantityLimit' },
    ]);

    const edt50 = await variant(SKU.edt50);
    const inactive = await createCart([{ sku: SKU.edt50, quantity: 1 }]);
    await db
      .update(productVariants)
      .set({ isActive: false })
      .where(eq(productVariants.id, edt50.id));
    try {
      await expectDomainError(placeOrder(deps(), await input(inactive.id)), 'invalid', [
        { path: `items.${edt50.id}`, code: 'itemUnavailable' },
      ]);
    } finally {
      await db
        .update(productVariants)
        .set({ isActive: true })
        .where(eq(productVariants.id, edt50.id));
    }

    const empty = await createCart([]);
    await expectDomainError(placeOrder(deps(), await input(empty.id)), 'invalid', [
      { path: 'cart', code: 'cartEmpty' },
    ]);

    const done = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    await placeOrder(deps(), await input(done.id));
    await expectDomainError(placeOrder(deps(), await input(done.id)), 'invalid', [
      { path: 'cart', code: 'cartUnavailable' },
    ]);
  });

  it('rolls everything back when a step fails after the order row was written', async () => {
    // Fail the last write of the transaction (consents), after order, items, reservation,
    // coupon redemption and cart conversion.
    await db.execute(sql`
      create or replace function test_fail_consent() returns trigger language plpgsql as
      $$ begin raise exception 'forced failure'; end $$`);
    await db.execute(sql`
      create trigger test_fail_consent before insert on consents
      for each row execute function test_fail_consent()`);
    const cart = await createCart([{ sku: SKU.parfum, quantity: 1 }]);
    const [before] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME10'));
    const form = await input(cart.id, {
      phone: '0966666666',
      email: 'rollback@example.com',
      couponCode: 'WELCOME10',
      paymentMethod: 'payos',
    });
    try {
      await expect(placeOrder(deps(), form)).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger test_fail_consent on consents`);
    }

    expect(await db.select().from(orders).where(eq(orders.checkoutKey, form.checkoutKey))).toEqual(
      [],
    );
    const [cartRow] = await db.select().from(carts).where(eq(carts.id, cart.id));
    expect(cartRow!.status).toBe('active');
    const [after] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME10'));
    expect(after!.usedCount).toBe(before!.usedCount);
    expect(
      await db.select().from(couponRedemptions).where(eq(couponRedemptions.phone, '0966666666')),
    ).toEqual([]);
    expect(await stock(SKU.parfum)).toEqual({ onHand: 10, reserved: 0 });
    expect(await jobs('order.placed', '00000000-0000-0000-0000-000000000000')).toEqual([]);
    const placedJobs = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(PGBOSS_SCHEMA)}.job j
          join orders o on o.id::text = j.data->>'orderId' where o.checkout_key = ${form.checkoutKey}`,
    );
    expect(placedJobs.rows[0]!.n).toBe(0);

    // The same checkout succeeds once the failure is gone (nothing half-written blocks it).
    const placed = await placeOrder(deps(), form);
    expect(placed.duplicate).toBe(false);
  });

  it('retries the order code on a clash', async () => {
    const first = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    const taken = await placeOrder(deps(), await input(first.id));
    const cart = await createCart([{ sku: SKU.travel, quantity: 1 }]);
    const codes = [taken.code, 'PF-261112-ZZZZ'];
    const placed = await placeOrder(
      { db, boss, generateCode: () => codes.shift() ?? 'PF-261112-YYYY' },
      await input(cart.id),
    );
    expect(placed.code).toBe('PF-261112-ZZZZ');
  });
});
