import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import {
  codRemittanceOrders,
  inventoryItems,
  orderEvents,
  orderItems,
  orders,
  paymentEvents,
  payments,
  products,
  productVariants,
  refunds,
  stockReservations,
  users,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import {
  createPaymentGateways,
  payosSign,
  SIMULATOR_KEYS,
  vnpaySign,
  type PaymentGateways,
} from '@/server/integrations/payments';
import { createPayosGateway } from '@/server/integrations/payments/payos';
import { createVnpayGateway } from '@/server/integrations/payments/vnpay';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import type { CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { reserveStock } from '@/server/modules/inventory';
import { generateOrderCode, transitionOrder } from '@/server/modules/order';
import {
  cancelUnconfirmedCodOrders,
  completeDeliveredOrders,
  completeRefund,
  confirmBankTransfer,
  createCodRemittance,
  createPaymentSession,
  expireUnpaidOrders,
  processGatewayNotification,
  requestRefund,
} from '@/server/modules/payment';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Payment flows against a real PostgreSQL (ARCHITECTURE.md §3.4 steps 3–6, §12 Payments):
 * IPN idempotency, amount checks, deposit/full confirmation with stock commit, late IPN after
 * cancellation, timeout jobs, manual bank transfer, COD remittance and refund math.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let gateways: PaymentGateways;
let variantId: string;
let productId: string;
const staff = {} as Record<StaffRole, string>;

const vnpaySim = createVnpayGateway({
  mode: 'simulator',
  tmnCode: SIMULATOR_KEYS.vnpayTmnCode,
  hashSecret: SIMULATOR_KEYS.vnpayHashSecret,
  paymentUrl: 'http://localhost/sim',
  apiUrl: 'http://localhost/api',
});
const payosSim = createPayosGateway({
  mode: 'simulator',
  clientId: 'c',
  apiKey: 'k',
  checksumKey: SIMULATOR_KEYS.payosChecksumKey,
  apiUrl: 'http://localhost',
});

const RETURN_URL = 'http://localhost:3000/thanh-toan/ket-qua?code=X';

function ctx(role: StaffRole): CommandContext {
  return { db, boss, actor: { id: staff[role], role }, ip: '127.0.0.1' };
}

async function jobCount(name: string): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name}`,
  );
  return result.rows[0]!.n;
}

async function alertKinds(): Promise<string[]> {
  const result = await db.execute<{ kind: string }>(
    sql`select data->>'kind' as kind from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = 'staff.alert' order by created_on`,
  );
  return result.rows.map((row) => row.kind);
}

async function stock() {
  const [row] = await db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.variantId, variantId));
  return row!;
}

type OrderOptions = {
  method?: 'payos' | 'vnpay' | 'cod' | 'bank_transfer';
  status?: 'pending' | 'awaiting_confirmation';
  total?: number;
  deposit?: number;
  quantity?: number;
  reservationMinutes?: number;
  placedMinutesAgo?: number;
};

/** Places an order the way `placeOrder` will: order + item + stock reservation. */
async function placeOrder(options: OrderOptions = {}) {
  const method = options.method ?? 'payos';
  const total = options.total ?? 1_250_000;
  const quantity = options.quantity ?? 1;
  const placedAt = new Date(Date.now() - (options.placedMinutesAgo ?? 0) * 60_000);
  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        code: generateOrderCode(),
        email: 'khach@example.com',
        phone: '0912345678',
        customerName: 'Khách Test',
        locale: 'vi',
        status:
          options.status ??
          (method === 'cod' && !options.deposit ? 'awaiting_confirmation' : 'pending'),
        paymentMethod: method,
        subtotal: total,
        total,
        depositRequired: options.deposit ?? 0,
        placedAt,
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
      quantity,
      lineTotal: total,
    });
    await reserveStock(tx, {
      orderId: order!.id,
      lines: [{ variantId, quantity }],
      expiresAt: new Date(Date.now() + (options.reservationMinutes ?? 30) * 60_000),
    });
    return order!;
  });
}

async function orderRow(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

function signedPayos(txnRef: string, amount: number, reference = `FT${txnRef.slice(-8)}`) {
  const data = {
    orderCode: Number(txnRef),
    amount,
    description: 'PF TEST',
    accountNumber: '0000000000',
    reference,
    transactionDateTime: '2026-11-11 15:31:00',
    currency: 'VND',
    paymentLinkId: 'link',
    code: '00',
    desc: 'success',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: 'NGUYEN VAN A',
    counterAccountNumber: '123456789',
    virtualAccountName: '',
    virtualAccountNumber: '',
  };
  return {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: payosSign(data, SIMULATOR_KEYS.payosChecksumKey),
  };
}

function signedVnpay(txnRef: string, amount: number, responseCode = '00') {
  const params: Record<string, string> = {
    vnp_Amount: String(amount * 100),
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'PF TEST',
    vnp_PayDate: '20261111153012',
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: SIMULATOR_KEYS.vnpayTmnCode,
    vnp_TransactionNo: `9${txnRef.slice(-7)}`,
    vnp_TransactionStatus: responseCode === '00' ? '00' : '02',
    vnp_TxnRef: txnRef,
  };
  return { ...params, vnp_SecureHash: vnpaySign(params, SIMULATOR_KEYS.vnpayHashSecret) };
}

const deps = () => ({ db, boss, gateways });

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
  gateways = createPaymentGateways({
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
  for (const role of ['owner', 'manager', 'staff', 'editor'] as StaffRole[]) {
    staff[role] = newId();
    await db
      .insert(users)
      .values({ id: staff[role], name: role, email: `${role}@example.com`, role });
  }
});

beforeEach(async () => {
  await db
    .update(stockReservations)
    .set({ status: 'released' })
    .where(eq(stockReservations.variantId, variantId));
  await db
    .update(inventoryItems)
    .set({ onHand: 20, reserved: 0 })
    .where(eq(inventoryItems.variantId, variantId));
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('payment sessions', () => {
  it('creates a payOS session with QR, reuses it, and switches method on retry', async () => {
    const order = await placeOrder({ method: 'payos' });
    const first = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    expect(first).toMatchObject({
      provider: 'payos',
      kind: 'full',
      amount: 1_250_000,
      reused: false,
    });
    expect(first.qrCode).toContain(first.txnRef);
    expect(first.transferNote).toBe(order.code.replace(/-/g, ''));

    const again = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    expect(again).toMatchObject({ paymentId: first.paymentId, reused: true });

    const vnpay = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'vnpay',
      returnUrl: RETURN_URL,
      ipAddress: '203.0.113.5',
    });
    expect(vnpay.checkoutUrl).toContain('vnp_SecureHash=');
    const rows = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(rows.map((r) => [r.provider, r.status]).sort()).toEqual([
      ['payos', 'cancelled'],
      ['vnpay', 'pending'],
    ]);
    expect((await orderRow(order.id)).paymentMethod).toBe('vnpay');
  });

  it('extends the reservation for a late retry and refuses once it expired', async () => {
    const order = await placeOrder({ reservationMinutes: 3, placedMinutesAgo: 27 });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    const [reservation] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.orderId, order.id));
    expect(reservation!.expiresAt.getTime()).toBe(session.expiresAt!.getTime());
    expect(session.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    const expired = await placeOrder({ reservationMinutes: -1 });
    await expect(
      createPaymentSession(deps(), {
        orderId: expired.id,
        provider: 'payos',
        returnUrl: RETURN_URL,
      }),
    ).rejects.toMatchObject({ code: 'invalid', fieldErrors: [{ code: 'reservationExpired' }] });
  });

  it('refuses COD orders without deposit and cancelled orders', async () => {
    const cod = await placeOrder({ method: 'cod' });
    await expect(
      createPaymentSession(deps(), { orderId: cod.id, provider: 'payos', returnUrl: RETURN_URL }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'nothingDue' }] });
  });
});

describe('IPN / webhook processing', () => {
  it('full payment → paid + confirmed + stock committed; a replay changes nothing', async () => {
    const order = await placeOrder({ method: 'payos', quantity: 2 });
    expect(await stock()).toEqual({ onHand: 20, reserved: 2 });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    const received = await jobCount('payment.received');
    const body = signedPayos(session.txnRef, session.amount);

    const result = await processGatewayNotification(deps(), payosSim.parseNotification(body));
    expect(result).toMatchObject({ outcome: 'processed', paymentStatus: 'paid', confirmed: true });
    const paid = await orderRow(order.id);
    expect(paid).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'paid',
      amountPaid: 1_250_000,
      amountDue: 0,
    });
    expect(await stock()).toEqual({ onHand: 18, reserved: 0 });
    const [payment] = await db.select().from(payments).where(eq(payments.id, session.paymentId));
    expect(payment).toMatchObject({ status: 'succeeded', providerTxnId: body.data.reference });

    const replay = await processGatewayNotification(deps(), payosSim.parseNotification(body));
    expect(replay.outcome).toBe('duplicate');
    expect((await orderRow(order.id)).amountPaid).toBe(1_250_000);
    expect(await jobCount('payment.received')).toBe(received + 1);
    const events = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.paymentId, session.paymentId));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toContain('NGUYEN VAN A');
    const timeline = await db
      .select({ type: orderEvents.type })
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.id));
    expect(timeline.map((e) => e.type)).toEqual(
      expect.arrayContaining(['payment_session_created', 'payment_received', 'status_changed']),
    );
  });

  it('two identical IPNs arriving at the same time are processed exactly once', async () => {
    const order = await placeOrder({ method: 'vnpay' });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'vnpay',
      returnUrl: RETURN_URL,
    });
    const n = vnpaySim.parseNotification(signedVnpay(session.txnRef, session.amount));
    const outcomes = await Promise.all([
      processGatewayNotification(deps(), n),
      processGatewayNotification(deps(), n),
    ]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['duplicate', 'processed']);
    expect(await orderRow(order.id)).toMatchObject({ amountPaid: 1_250_000, status: 'confirmed' });
  });

  it('rejects a wrong amount and an invalid signature without changing state', async () => {
    const order = await placeOrder({ method: 'payos' });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    const before = (await alertKinds()).length;

    const wrong = await processGatewayNotification(
      deps(),
      payosSim.parseNotification(signedPayos(session.txnRef, session.amount - 1_000)),
    );
    expect(wrong.outcome).toBe('amount_mismatch');

    const forged = signedPayos(session.txnRef, session.amount, 'FORGED');
    forged.signature = '0'.repeat(64);
    const invalid = await processGatewayNotification(deps(), payosSim.parseNotification(forged));
    expect(invalid.outcome).toBe('invalid_signature');

    const unknown = await processGatewayNotification(
      deps(),
      payosSim.parseNotification(signedPayos('1234567890123456', 1000)),
    );
    expect(unknown.outcome).toBe('unknown_txn');

    expect(await orderRow(order.id)).toMatchObject({
      status: 'pending',
      paymentStatus: 'unpaid',
      amountPaid: 0,
    });
    expect((await alertKinds()).slice(before)).toEqual([
      'suspicious_ipn',
      'suspicious_ipn',
      'suspicious_ipn',
    ]);
    const errors = await db
      .select({ error: paymentEvents.error, valid: paymentEvents.signatureValid })
      .from(paymentEvents)
      .orderBy(paymentEvents.createdAt);
    expect(errors.slice(-3)).toEqual([
      { error: 'amount_mismatch', valid: true },
      { error: 'invalid_signature', valid: false },
      { error: 'unknown_txn_ref', valid: true },
    ]);
  });

  it('a failed VNPay IPN marks the attempt failed; the customer can retry', async () => {
    const order = await placeOrder({ method: 'vnpay' });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'vnpay',
      returnUrl: RETURN_URL,
    });
    const result = await processGatewayNotification(
      deps(),
      vnpaySim.parseNotification(signedVnpay(session.txnRef, session.amount, '24')),
    );
    expect(result.outcome).toBe('failed_payment');
    const [payment] = await db.select().from(payments).where(eq(payments.id, session.paymentId));
    expect(payment!.status).toBe('failed');
    const retry = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'vnpay',
      returnUrl: RETURN_URL,
    });
    expect(retry.paymentId).not.toBe(session.paymentId);
  });

  it('COD deposit → partially_paid and confirmed; the balance stays due', async () => {
    const order = await placeOrder({ method: 'cod', total: 6_000_000, deposit: 1_200_000 });
    expect(order.status).toBe('pending');
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'vnpay',
      returnUrl: RETURN_URL,
    });
    expect(session).toMatchObject({ kind: 'deposit', amount: 1_200_000 });
    const result = await processGatewayNotification(
      deps(),
      vnpaySim.parseNotification(signedVnpay(session.txnRef, 1_200_000)),
    );
    expect(result).toMatchObject({
      outcome: 'processed',
      paymentStatus: 'partially_paid',
      confirmed: true,
    });
    expect(await orderRow(order.id)).toMatchObject({
      status: 'confirmed',
      paymentStatus: 'partially_paid',
      amountPaid: 1_200_000,
      amountDue: 4_800_000,
      paymentMethod: 'cod',
    });
  });

  it('IPN after cancellation records the money, queues a refund and alerts staff', async () => {
    const order = await placeOrder({ method: 'payos' });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    await db.transaction((tx) =>
      transitionOrder(tx, boss, {
        orderId: order.id,
        to: 'cancelled',
        actor: { type: 'customer', id: null },
        reason: 'changed mind',
      }),
    );
    const before = (await alertKinds()).length;
    const result = await processGatewayNotification(
      deps(),
      payosSim.parseNotification(signedPayos(session.txnRef, session.amount)),
    );
    expect(result.outcome).toBe('processed');
    expect(result.refundId).not.toBeNull();
    expect(await orderRow(order.id)).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'paid',
      amountPaid: 1_250_000,
    });
    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refund).toMatchObject({
      status: 'requested',
      method: 'gateway',
      amount: 1_250_000,
      paymentId: session.paymentId,
      reason: 'late_payment_after_cancellation',
    });
    expect((await alertKinds()).slice(before)).toEqual(['late_payment_refund']);
    expect(await stock()).toEqual({ onHand: 20, reserved: 0 });
  });
});

describe('timeout jobs', () => {
  it('expire-unpaid cancels orders whose reservations expired and expires stale sessions', async () => {
    const live = await placeOrder({ method: 'payos', placedMinutesAgo: 5 });
    const stale = await placeOrder({
      method: 'payos',
      placedMinutesAgo: 40,
      reservationMinutes: 20,
    });
    const session = await createPaymentSession(deps(), {
      orderId: stale.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    // Time travel: 40 minutes later the stale order's reservation and session are over.
    const later = new Date(Date.now() + 40 * 60_000);
    await db
      .update(stockReservations)
      .set({ expiresAt: new Date(Date.now() + 60 * 60_000) })
      .where(eq(stockReservations.orderId, live.id));

    const first = await expireUnpaidOrders({ db, boss, now: () => later });
    expect(first.processed).toBeGreaterThanOrEqual(1);
    expect((await orderRow(stale.id)).status).toBe('cancelled');
    expect((await orderRow(stale.id)).cancelReason).toBe('payment_timeout');
    expect((await orderRow(live.id)).status).toBe('pending');
    const [payment] = await db.select().from(payments).where(eq(payments.id, session.paymentId));
    expect(payment!.status).toBe('expired');
    expect(await stock()).toEqual({ onHand: 20, reserved: 1 });

    const second = await expireUnpaidOrders({ db, boss, now: () => later });
    expect(second.processed).toBe(0);
  });

  it('cancel-unconfirmed-cod and complete-delivered respect their windows', async () => {
    const old = await placeOrder({
      method: 'cod',
      placedMinutesAgo: 25 * 60,
      reservationMinutes: 60,
    });
    const fresh = await placeOrder({ method: 'cod', placedMinutesAgo: 60, reservationMinutes: 60 });
    await cancelUnconfirmedCodOrders({ db, boss });
    expect((await orderRow(old.id)).status).toBe('cancelled');
    expect((await orderRow(fresh.id)).status).toBe('awaiting_confirmation');
    expect((await cancelUnconfirmedCodOrders({ db, boss })).processed).toBe(0);

    const [delivered, recent] = await Promise.all([
      placeOrder({ method: 'payos' }),
      placeOrder({ method: 'payos' }),
    ]);
    for (const order of [delivered, recent]) {
      await db.transaction(async (tx) => {
        for (const [to, actor] of [
          ['confirmed', { type: 'system' as const, id: null }],
          ['processing', { type: 'staff' as const, id: staff.staff }],
          ['shipped', { type: 'staff' as const, id: staff.staff }],
          ['delivered', { type: 'staff' as const, id: staff.staff }],
        ] as const) {
          await transitionOrder(tx, boss, { orderId: order.id, to, actor });
        }
      });
    }
    await db
      .update(orders)
      .set({ deliveredAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(orders.id, delivered.id));
    await completeDeliveredOrders({ db, boss });
    expect((await orderRow(delivered.id)).status).toBe('completed');
    expect((await orderRow(recent.id)).status).toBe('delivered');
  });

  it('auto-cancelling a COD order whose deposit was paid queues a refund', async () => {
    const order = await placeOrder({
      method: 'cod',
      status: 'awaiting_confirmation',
      total: 6_000_000,
      deposit: 1_200_000,
      reservationMinutes: 60,
    });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'payos',
      returnUrl: RETURN_URL,
    });
    const paid = await processGatewayNotification(
      deps(),
      payosSim.parseNotification(signedPayos(session.txnRef, 1_200_000)),
    );
    // Awaiting staff confirmation: the deposit is recorded, the order is not auto-confirmed.
    expect(paid).toMatchObject({ paymentStatus: 'partially_paid', confirmed: false });
    await db
      .update(orders)
      .set({ placedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(orders.id, order.id));
    await cancelUnconfirmedCodOrders({ db, boss });
    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refund).toMatchObject({ amount: 1_200_000, status: 'requested', method: 'gateway' });
  });
});

describe('staff payment commands', () => {
  it('manager confirms a bank transfer: paid + confirmed; staff may not; no overpayment', async () => {
    const order = await placeOrder({ method: 'bank_transfer' });
    await expect(
      confirmBankTransfer(ctx('staff'), {
        orderId: order.id,
        amount: 1_250_000,
        bankReference: 'FT1',
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      confirmBankTransfer(ctx('manager'), {
        orderId: order.id,
        amount: 1_250_001,
        bankReference: 'FT1',
        note: null,
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ path: 'amount', code: 'exceedsDue' }] });
    const result = await confirmBankTransfer(ctx('manager'), {
      orderId: order.id,
      amount: 1_250_000,
      bankReference: 'FT26111100001',
      note: null,
    });
    expect(result.data).toMatchObject({ paymentStatus: 'paid', confirmed: true });
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, result.data.paymentId));
    expect(payment).toMatchObject({
      provider: 'bank_manual',
      status: 'succeeded',
      confirmedBy: staff.manager,
      providerTxnId: 'FT26111100001',
    });
  });

  it('COD remittance marks ticked delivered orders paid, once', async () => {
    const order = await placeOrder({ method: 'cod', total: 1_500_000 });
    await db.transaction(async (tx) => {
      const actor = { type: 'staff' as const, id: staff.staff };
      for (const to of ['confirmed', 'processing', 'shipped', 'delivered'] as const) {
        await transitionOrder(tx, boss, { orderId: order.id, to, actor });
      }
    });
    const input = {
      carrier: 'ghn' as const,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-10',
      receivedAt: '2026-11-11',
      bankReference: 'GHN-REM-1',
      carrierFee: 15_000,
      totalAmount: 1_485_000,
      orders: [{ orderId: order.id, amount: 1_500_000 }],
    };
    await expect(createCodRemittance(ctx('staff'), input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const result = await createCodRemittance(ctx('manager'), input);
    expect(result.data).toMatchObject({ expected: 1_485_000, difference: 0 });
    expect(await orderRow(order.id)).toMatchObject({ paymentStatus: 'paid', amountDue: 0 });
    const lines = await db
      .select()
      .from(codRemittanceOrders)
      .where(eq(codRemittanceOrders.orderId, order.id));
    expect(lines).toHaveLength(1);
    await expect(createCodRemittance(ctx('manager'), input)).rejects.toMatchObject({
      fieldErrors: [{ path: 'orders.0', code: 'alreadyRemitted' }],
    });
  });

  it('refunds: limits, manual partial + rest, gateway refund through the adapter', async () => {
    const order = await placeOrder({ method: 'vnpay' });
    const session = await createPaymentSession(deps(), {
      orderId: order.id,
      provider: 'vnpay',
      returnUrl: RETURN_URL,
    });
    await processGatewayNotification(
      deps(),
      vnpaySim.parseNotification(signedVnpay(session.txnRef, 1_250_000)),
    );

    await expect(
      requestRefund(ctx('manager'), {
        orderId: order.id,
        amount: 1_250_001,
        reason: 'too much',
        method: 'bank_transfer',
        paymentId: null,
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'exceedsRefundable' }] });
    await expect(
      requestRefund(ctx('staff'), {
        orderId: order.id,
        amount: 1,
        reason: 'x',
        method: 'cash',
        paymentId: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const partial = await requestRefund(ctx('manager'), {
      orderId: order.id,
      amount: 250_000,
      reason: 'damaged box',
      method: 'bank_transfer',
      paymentId: null,
    });
    // Only 1,000,000 ₫ remains refundable while 250,000 ₫ is queued.
    await expect(
      requestRefund(ctx('manager'), {
        orderId: order.id,
        amount: 1_000_001,
        reason: 'x',
        method: 'gateway',
        paymentId: null,
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'exceedsRefundable' }] });

    await expect(
      completeRefund(
        { ...ctx('manager'), gateways },
        {
          refundId: partial.data.refundId,
          mode: 'manual',
          providerRef: null,
          proofMediaId: null,
        },
      ),
    ).rejects.toThrow();
    const manual = await completeRefund(
      { ...ctx('manager'), gateways },
      {
        refundId: partial.data.refundId,
        mode: 'manual',
        providerRef: 'FT-REFUND-1',
        proofMediaId: null,
      },
    );
    expect(manual.data).toMatchObject({ status: 'completed', paymentStatus: 'partially_refunded' });
    expect(await orderRow(order.id)).toMatchObject({
      amountRefunded: 250_000,
      paymentStatus: 'partially_refunded',
    });

    const rest = await requestRefund(ctx('owner'), {
      orderId: order.id,
      amount: 1_000_000,
      reason: 'return approved',
      method: 'gateway',
      paymentId: null,
    });
    const viaGateway = await completeRefund(
      { ...ctx('owner'), gateways },
      {
        refundId: rest.data.refundId,
        mode: 'gateway',
        providerRef: null,
        proofMediaId: null,
      },
    );
    expect(viaGateway.data).toMatchObject({ status: 'completed', paymentStatus: 'refunded' });
    const [payment] = await db.select().from(payments).where(eq(payments.id, session.paymentId));
    expect(payment!.status).toBe('refunded');
    const [done] = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.id, rest.data.refundId), eq(refunds.status, 'completed')));
    expect(done!.providerRef).toMatch(/^SIM-/);
    await expect(
      completeRefund(
        { ...ctx('owner'), gateways },
        {
          refundId: rest.data.refundId,
          mode: 'manual',
          providerRef: 'again',
          proofMediaId: null,
        },
      ),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'refundClosed' }] });
  });
});
