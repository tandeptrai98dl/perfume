import { and, asc, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { render, toPlainText } from 'react-email';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@/server/auth/permissions';
import { createDb, type Database } from '@/server/db/client';
import {
  auditLogs,
  inventoryItems,
  orderAddresses,
  orderEvents,
  orderItems,
  orders,
  payments,
  productVariants,
  refunds,
  settings,
  stockMovements,
  stockReservations,
  users,
} from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createSandboxEinvoiceProvider, EinvoiceError } from '@/server/integrations/einvoice';
import { createEmailSender, type EmailSender } from '@/server/integrations/email/send';
import { createHandlers, type JobHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import type { CommandContext } from '@/server/lib/command-context';
import { DomainError } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  adjustOrderEinvoice,
  cancelEinvoice,
  EinvoiceRetryError,
  getOrderEinvoice,
  issueOrderEinvoice,
  replaceEinvoice,
  runEinvoiceAdjustmentJob,
} from '@/server/modules/einvoice';
import { reserveStock } from '@/server/modules/inventory';
import {
  anonymizeOrdersForSubject,
  changeOrderStatus,
  generateOrderCode,
  transitionOrder,
} from '@/server/modules/order';
import {
  approveReturn,
  getAdminReturn,
  getCustomerReturnView,
  listReturnQueue,
  receiveReturn,
  rejectReturn,
  requestReturn,
  returnRequestSchema,
  type ReturnRequestInput,
} from '@/server/modules/returns';
import { completeDeliveredOrders } from '@/server/modules/payment';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Customer returns (ADR-0017) end to end on a real database: request → approve → goods
 * received with restock, refund queue and e-invoice cancel/replace (outbox job run with the
 * sandbox provider); rejection; window expiry and the window setting; partial returns;
 * replacements; COD before remittance; permissions; customer e-mails.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let handlers: JobHandlers;
const provider = createSandboxEinvoiceProvider({ series: 'C26RET' });
const actorIds = {} as Record<StaffRole, string>;
let customerId: string;
let variants: { id: string; productId: string; sku: string; price: number }[];
let sent: { to: string; subject: string; text: string }[] = [];

const ctx = (role: StaffRole): CommandContext => ({
  db,
  boss,
  actor: { id: actorIds[role], role },
  ip: '127.0.0.1',
});

function captureSender(): EmailSender {
  const real = createEmailSender({
    transport: nodemailer.createTransport({ jsonTransport: true }),
    from: 'Perfume Store <no-reply@example.com>',
  });
  return {
    async send(message) {
      const html = await render(message.template);
      sent.push({ to: message.to, subject: message.subject, text: toPlainText(html) });
      return real.send(message);
    },
    close: () => real.close(),
  };
}

async function jobs(name: string) {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} order by created_on`,
  );
  return result.rows.map((row) => row.data);
}

async function onHand(variantId: string) {
  const [row] = await db
    .select({ onHand: inventoryItems.onHand, reserved: inventoryItems.reserved })
    .from(inventoryItems)
    .where(eq(inventoryItems.variantId, variantId));
  return row!.onHand;
}

async function reload(id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row!;
}

type Line = { variant: number; quantity: number; discount?: number };

/**
 * A delivered order with real stock deductions (reserve → confirm → ship → deliver), paid
 * online (succeeded VNPay attempt) unless `cod`.
 */
async function deliveredOrder(
  input: {
    lines?: Line[];
    cod?: boolean;
    userId?: string | null;
    shippingFee?: number;
    giftWrapFee?: number;
    deliveredDaysAgo?: number;
    locale?: 'vi' | 'en';
  } = {},
) {
  const lines = input.lines ?? [{ variant: 0, quantity: 1 }];
  const shippingFee = input.shippingFee ?? 30_000;
  const giftWrapFee = input.giftWrapFee ?? 0;
  const priced = lines.map((line) => {
    const variant = variants[line.variant]!;
    const discount = line.discount ?? 0;
    return { line, variant, lineTotal: variant.price * line.quantity - discount, discount };
  });
  const subtotal = priced.reduce((sum, p) => sum + p.variant.price * p.line.quantity, 0);
  const discountTotal = priced.reduce((sum, p) => sum + p.discount, 0);
  const total = subtotal - discountTotal + shippingFee + giftWrapFee;
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(orders).values({
      id,
      code: generateOrderCode(),
      userId: input.userId ?? null,
      email: 'khach.tra.hang@example.com',
      phone: '0912345678',
      customerName: 'Nguyễn Thị Hương',
      locale: input.locale ?? 'vi',
      status: 'awaiting_confirmation',
      paymentMethod: input.cod ? 'cod' : 'vnpay',
      subtotal,
      discountTotal,
      shippingFee,
      giftWrapFee,
      giftWrap: giftWrapFee > 0,
      total,
    });
    for (const p of priced) {
      await tx.insert(orderItems).values({
        orderId: id,
        productId: p.variant.productId,
        variantId: p.variant.id,
        productName: `Nước hoa ${p.variant.sku}`,
        variantLabel: '100 ml',
        sku: p.variant.sku,
        unitPrice: p.variant.price,
        quantity: p.line.quantity,
        discountAllocated: p.discount,
        lineTotal: p.lineTotal,
      });
    }
    await tx.insert(orderAddresses).values({
      orderId: id,
      type: 'shipping',
      fullName: 'Nguyễn Thị Hương',
      phone: '0912345678',
      provinceCode: '01',
      provinceName: 'Thành phố Hà Nội',
      wardCode: '00004',
      wardName: 'Phường Ba Đình',
      street: '1 Hoàng Hoa Thám',
    });
    await reserveStock(tx, {
      orderId: id,
      lines: priced.map((p) => ({ variantId: p.variant.id, quantity: p.line.quantity })),
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
    });
    const staff = { type: 'staff' as const, id: actorIds.staff };
    for (const to of ['confirmed', 'processing', 'shipped', 'delivered'] as const) {
      await transitionOrder(tx, boss, { orderId: id, to, actor: staff });
    }
    if (!input.cod) {
      await tx.insert(payments).values({
        orderId: id,
        provider: 'vnpay',
        kind: 'full',
        amount: total,
        status: 'succeeded',
        txnRef: String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(4, '0'),
        paidAt: new Date(),
      });
      await tx
        .update(orders)
        .set({ amountPaid: total, paymentStatus: 'paid' })
        .where(eq(orders.id, id));
    }
    if (input.deliveredDaysAgo) {
      await tx
        .update(orders)
        .set({ deliveredAt: new Date(Date.now() - input.deliveredDaysAgo * 86_400_000) })
        .where(eq(orders.id, id));
    }
  });
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  return { ...(await reload(id)), items };
}

function request(values: Partial<ReturnRequestInput> & Pick<ReturnRequestInput, 'lines'>) {
  return returnRequestSchema.parse({
    reason: 'defective',
    resolution: 'refund',
    description: 'Vòi xịt bị kẹt, không xịt được.',
    ...values,
  });
}

async function eventsOf(orderId: string, type: string) {
  return db
    .select()
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, type)))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
}

async function runAdjustJobs() {
  for (const job of await jobs('einvoice.adjust')) {
    await handlers['einvoice.adjust'](job as { orderId: string; adjustmentId: string });
  }
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
  handlers = createHandlers({
    db,
    boss,
    email: captureSender(),
    appUrl: 'https://shop.test',
    internalBaseUrl: 'http://web.internal',
    internalSecret: 'x'.repeat(32),
    orderLinkSecret: 'order-link-secret-order-link-secret-00',
    chat: null,
    einvoice: provider,
  });
  for (const role of ['owner', 'manager', 'staff', 'editor'] as const) {
    actorIds[role] = newId();
    await db
      .insert(users)
      .values({ id: actorIds[role], name: role, email: `${role}@example.com`, role });
  }
  customerId = newId();
  await db
    .insert(users)
    .values({ id: customerId, name: 'Hương', email: 'huong@example.com', emailVerified: true });
  const rows = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      price: productVariants.price,
    })
    .from(productVariants)
    .innerJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id))
    .where(eq(productVariants.isActive, true))
    .orderBy(asc(productVariants.sku))
    .limit(2);
  variants = rows.map((row) => ({ ...row, price: Number(row.price) }));
  expect(variants).toHaveLength(2);
  // Plenty of stock for every scenario (replacements deduct more units).
  for (const variant of variants) {
    await db
      .update(inventoryItems)
      .set({ onHand: 100 })
      .where(eq(inventoryItems.variantId, variant.id));
  }
});

beforeEach(async () => {
  sent = [];
  await db.execute(sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job`);
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('customer request', () => {
  it('moves the order to return_requested with the details, an e-mail and a staff alert', async () => {
    const order = await deliveredOrder({ userId: customerId });
    expect((await getCustomerReturnView(db, order)).canRequest).toBe(true);

    const result = await requestReturn(db, boss, {
      orderId: order.id,
      userId: customerId,
      values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }),
    });

    const after = await reload(order.id);
    expect(after.status).toBe('return_requested');
    const [event] = await eventsOf(order.id, 'return_requested');
    expect(event).toMatchObject({
      actorType: 'customer',
      actorId: customerId,
      message: 'Vòi xịt bị kẹt, không xịt được.',
    });
    expect(event!.metadata).toMatchObject({
      requestId: result.requestId,
      reason: 'defective',
      lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
    });
    expect(await jobs('return.notify')).toEqual([
      { orderId: order.id, requestId: result.requestId, kind: 'requested' },
    ]);
    expect(await jobs('staff.alert')).toEqual([
      expect.objectContaining({ kind: 'return_requested', orderId: order.id }),
    ]);
    // Staff alerts never carry customer data.
    expect(JSON.stringify(await jobs('staff.alert'))).not.toContain('Hương');

    const view = await getCustomerReturnView(db, after);
    expect(view).toMatchObject({ canRequest: false, request: { status: 'requested' } });
    expect((await listReturnQueue(db)).map((row) => row.orderId)).toContain(order.id);

    // The generic status buttons do not close a return.
    await expect(
      changeOrderStatus(ctx('manager'), {
        orderId: order.id,
        to: 'returned',
        expectedVersion: after.version,
        reason: null,
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ path: 'status', code: 'useReturnFlow' }] });

    // E-mail in the order's language, once per step.
    await handlers['return.notify']({
      orderId: order.id,
      requestId: result.requestId,
      kind: 'requested',
    });
    await handlers['return.notify']({
      orderId: order.id,
      requestId: result.requestId,
      kind: 'requested',
    });
    expect(sent.map((m) => m.subject)).toEqual([`Đã nhận yêu cầu trả hàng cho đơn ${order.code}`]);
  });

  it('refuses lines that are not in the order or more than bought', async () => {
    const order = await deliveredOrder({ lines: [{ variant: 0, quantity: 2 }] });
    await expect(
      requestReturn(db, boss, {
        orderId: order.id,
        userId: null,
        values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 3 }] }),
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'quantityTooLarge' }] });
    await expect(
      requestReturn(db, boss, {
        orderId: order.id,
        userId: null,
        values: request({ lines: [{ orderItemId: newId(), quantity: 1 }] }),
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'unknownLine' }] });
    expect((await reload(order.id)).status).toBe('delivered');
  });

  it('closes after the window, which follows the setting', async () => {
    const late = await deliveredOrder({ deliveredDaysAgo: 8 });
    const values = request({ lines: [{ orderItemId: late.items[0]!.id, quantity: 1 }] });
    await expect(
      requestReturn(db, boss, { orderId: late.id, userId: null, values }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'windowExpired' }] });

    await db
      .insert(settings)
      .values({ key: 'returns.windowDays', value: 14 })
      .onConflictDoUpdate({ target: settings.key, set: { value: 14 } });
    try {
      await requestReturn(db, boss, { orderId: late.id, userId: null, values });
      expect((await reload(late.id)).status).toBe('return_requested');
    } finally {
      await db.update(settings).set({ value: 7 }).where(eq(settings.key, 'returns.windowDays'));
    }
  });
});

describe('staff decisions', () => {
  it('rejection: back to delivered with the original delivery time, reason e-mailed, no second request', async () => {
    const order = await deliveredOrder({ locale: 'en' });
    const { requestId } = await requestReturn(db, boss, {
      orderId: order.id,
      userId: null,
      values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }),
    });
    await expect(
      rejectReturn(ctx('staff'), { orderId: order.id, requestId, reason: 'Opened and used' }),
    ).rejects.toBeInstanceOf(DomainError);

    await rejectReturn(ctx('manager'), {
      orderId: order.id,
      requestId,
      reason: 'The bottle was opened and used.',
    });
    const after = await reload(order.id);
    expect(after.status).toBe('delivered');
    expect(after.deliveredAt?.getTime()).toBe(order.deliveredAt?.getTime());
    // A rejected return is not a new delivery: no second e-invoice job.
    expect(await jobs('einvoice.issue')).toHaveLength(1);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, order.id), eq(auditLogs.action, 'order.return_reject')));
    expect(audit).toBeDefined();

    await handlers['return.notify']({ orderId: order.id, requestId, kind: 'rejected' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(`Return request for order ${order.code} declined`);
    expect(sent[0]!.text).toContain('The bottle was opened and used.');

    await expect(
      requestReturn(db, boss, {
        orderId: order.id,
        userId: null,
        values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }),
      }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'alreadyRequested' }] });
    expect((await getCustomerReturnView(db, after)).request?.status).toBe('rejected');
  });

  it('needs approval before receipt, and a manager for return-shipping reimbursement', async () => {
    const order = await deliveredOrder();
    const { requestId } = await requestReturn(db, boss, {
      orderId: order.id,
      userId: null,
      values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }),
    });
    const receive = { orderId: order.id, requestId, resellable: false, note: null };
    await expect(
      receiveReturn(ctx('staff'), { ...receive, returnShippingFee: 0 }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'notApproved' }] });
    await expect(
      approveReturn(ctx('staff'), { orderId: order.id, requestId, note: null }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await approveReturn(ctx('manager'), { orderId: order.id, requestId, note: 'GHN lấy hàng' });
    await expect(
      receiveReturn(ctx('staff'), { ...receive, returnShippingFee: 30_000 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      receiveReturn(ctx('editor'), { ...receive, returnShippingFee: 0 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Staff may record the parcel itself.
    const result = await receiveReturn(ctx('staff'), { ...receive, returnShippingFee: 0 });
    expect(result.data.outcome).toBe('full');
  });
});

describe('goods received', () => {
  it('full fault return: returned, restocked, 100 % + return shipping refunded, invoice cancelled', async () => {
    const order = await deliveredOrder({
      lines: [
        { variant: 0, quantity: 2, discount: 100_000 },
        { variant: 1, quantity: 1 },
      ],
      giftWrapFee: 50_000,
    });
    const before = [await onHand(variants[0]!.id), await onHand(variants[1]!.id)];
    expect(await issueOrderEinvoice({ db, boss, provider }, order.id)).toMatchObject({
      outcome: 'issued',
    });
    const issuedRef = (await reload(order.id)).einvoiceRef!;

    const { requestId } = await requestReturn(db, boss, {
      orderId: order.id,
      userId: null,
      values: request({
        reason: 'damaged',
        description: 'Chai bị vỡ khi nhận hàng.',
        lines: order.items.map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
      }),
    });
    await approveReturn(ctx('manager'), { orderId: order.id, requestId, note: null });
    const result = await receiveReturn(ctx('manager'), {
      orderId: order.id,
      requestId,
      resellable: true,
      returnShippingFee: 35_000,
      note: 'Hộp còn nguyên',
    });

    expect(result.data).toMatchObject({ outcome: 'full', einvoice: 'cancel' });
    const after = await reload(order.id);
    expect(after.status).toBe('returned');
    expect([await onHand(variants[0]!.id), await onHand(variants[1]!.id)]).toEqual([
      before[0]! + 2,
      before[1]! + 1,
    ]);
    const committed = await db
      .select()
      .from(stockReservations)
      .where(
        and(eq(stockReservations.orderId, order.id), eq(stockReservations.status, 'committed')),
      );
    expect(committed).toHaveLength(0);
    const movements = await db
      .select({ delta: stockMovements.delta, reason: stockMovements.reason })
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, order.id), eq(stockMovements.reason, 'return')));
    expect(movements.reduce((sum, m) => sum + m.delta, 0)).toBe(3);

    // Refund: the paid total (goods, shipping, gift wrap) is capped by the money held, so the
    // return-shipping reimbursement beyond it is owed separately (alert).
    const queued = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(
      await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)),
    ).toContainEqual(expect.objectContaining({ type: 'refund_requested' }));
    expect(queued).toEqual([
      expect.objectContaining({
        amount: order.total,
        status: 'requested',
        method: 'gateway',
        reason: 'return:damaged',
      }),
    ]);
    expect(result.data.refund).toMatchObject({
      total: order.total + 35_000,
      queued: order.total,
      shortfall: 35_000,
    });
    expect(after.paymentStatus).toBe('paid');

    // E-invoice: cancel through the outbox job; the provider confirms.
    expect(await jobs('einvoice.adjust')).toHaveLength(1);
    await runAdjustJobs();
    const cancelled = await eventsOf(order.id, 'einvoice_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.metadata).toMatchObject({ ref: issuedRef });
    expect((await provider.lookup(order.id)).status).toBe('cancelled');
    const view = await getOrderEinvoice(db, order.id);
    expect(view?.adjustment).toMatchObject({ state: 'cancelled', canAdjust: false });
    // Running the job again is harmless.
    await runAdjustJobs();
    expect(await eventsOf(order.id, 'einvoice_cancelled')).toHaveLength(1);
    // Staff cannot cancel twice.
    await expect(
      cancelEinvoice(ctx('manager'), { orderId: order.id, reason: 'Huỷ lại lần nữa' }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'invoiceCancelled' }] });

    // The return's own e-mail replaces the generic "refunded" status e-mail.
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'return_requested',
      to: 'returned',
    });
    await handlers['return.notify']({ orderId: order.id, requestId, kind: 'received' });
    expect(sent.map((m) => m.subject)).toEqual([`Đã nhận lại hàng trả của đơn ${order.code}`]);
    expect((await getAdminReturn(db, order.id))?.status).toBe('received');
  });

  it('partial change-of-mind return: lines restocked, goods refunded, order delivered, invoice replaced', async () => {
    const order = await deliveredOrder({
      lines: [
        { variant: 0, quantity: 2 },
        { variant: 1, quantity: 1 },
      ],
    });
    await issueOrderEinvoice({ db, boss, provider }, order.id);
    const originalRef = (await reload(order.id)).einvoiceRef!;
    const stock = await onHand(variants[0]!.id);
    const line = order.items.find((item) => item.variantId === variants[0]!.id)!;

    const { requestId } = await requestReturn(db, boss, {
      orderId: order.id,
      userId: null,
      values: request({
        reason: 'unopened',
        sealIntact: true,
        description: '',
        lines: [{ orderItemId: line.id, quantity: 1 }],
      }),
    });
    await approveReturn(ctx('owner'), { orderId: order.id, requestId, note: null });
    const result = await receiveReturn(ctx('staff'), {
      orderId: order.id,
      requestId,
      resellable: true,
      returnShippingFee: 0,
      note: null,
    });

    expect(result.data).toMatchObject({ outcome: 'partial', einvoice: 'replace' });
    const after = await reload(order.id);
    expect(after.status).toBe('delivered');
    expect(after.deliveredAt?.getTime()).toBe(order.deliveredAt?.getTime());
    expect(await onHand(variants[0]!.id)).toBe(stock + 1);
    const [held] = await db
      .select({ quantity: sql<number>`sum(${stockReservations.quantity})::int` })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.orderId, order.id),
          eq(stockReservations.variantId, variants[0]!.id),
          eq(stockReservations.status, 'committed'),
        ),
      );
    expect(held!.quantity).toBe(1);
    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, order.id));
    expect(refund!.amount).toBe(variants[0]!.price);

    await runAdjustJobs();
    const replaced = await reload(order.id);
    expect(replaced.einvoiceRef).not.toBe(originalRef);
    const [event] = await eventsOf(order.id, 'einvoice_replaced');
    // Shipping stays invoiced for a change of mind.
    expect(event!.metadata).toMatchObject({
      previousRef: originalRef,
      ref: replaced.einvoiceRef,
      total: order.total - variants[0]!.price,
    });
    const view = await getOrderEinvoice(db, order.id);
    expect(view?.invoice?.ref).toBe(replaced.einvoiceRef);
    expect(view?.adjustment).toMatchObject({ state: 'replaced', canAdjust: true });

    // The window still counts from the real delivery: completed by the cron after 7 days.
    await completeDeliveredOrders({ db, boss, now: () => new Date(Date.now() + 8 * 86_400_000) });
    expect((await reload(order.id)).status).toBe('completed');
  });

  it('replacement: nothing refunded, unsellable unit written off, replacement deducted', async () => {
    const order = await deliveredOrder({ lines: [{ variant: 1, quantity: 1 }] });
    const stock = await onHand(variants[1]!.id);
    const { requestId } = await requestReturn(db, boss, {
      orderId: order.id,
      userId: null,
      values: request({
        reason: 'wrong_item',
        resolution: 'replacement',
        description: 'Nhận được chai 50 ml thay vì 100 ml.',
        lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
      }),
    });
    await approveReturn(ctx('manager'), { orderId: order.id, requestId, note: null });
    const result = await receiveReturn(ctx('manager'), {
      orderId: order.id,
      requestId,
      resellable: false,
      returnShippingFee: 0,
      note: null,
    });
    expect(result.data).toMatchObject({ outcome: 'replacement', einvoice: null });
    expect(result.data.refund.total).toBe(0);
    expect((await reload(order.id)).status).toBe('delivered');
    expect(await onHand(variants[1]!.id)).toBe(stock - 1);
    const reasons = await db
      .select({ reason: stockMovements.reason, delta: stockMovements.delta })
      .from(stockMovements)
      .where(eq(stockMovements.refId, order.id))
      .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));
    expect(reasons.slice(-3)).toEqual([
      { reason: 'return', delta: 1 },
      { reason: 'damage', delta: -1 },
      { reason: 'sale', delta: -1 },
    ]);
    expect(await db.select().from(refunds).where(eq(refunds.orderId, order.id))).toEqual([]);
    expect(await jobs('einvoice.adjust')).toEqual([]);
  });

  it('COD not remitted yet: the refund is owed and staff are alerted', async () => {
    const order = await deliveredOrder({ cod: true });
    const { requestId } = await requestReturn(db, boss, {
      orderId: order.id,
      userId: null,
      values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }),
    });
    await approveReturn(ctx('manager'), { orderId: order.id, requestId, note: null });
    const result = await receiveReturn(ctx('manager'), {
      orderId: order.id,
      requestId,
      resellable: false,
      returnShippingFee: 0,
      note: null,
    });
    expect(result.data.refund).toMatchObject({
      total: order.total,
      queued: 0,
      shortfall: order.total,
      refundId: null,
    });
    expect(await jobs('staff.alert')).toContainEqual(
      expect.objectContaining({ kind: 'late_payment_refund', orderId: order.id }),
    );
  });
});

describe('privacy', () => {
  it('removes the customer’s return description when the account is anonymised', async () => {
    const order = await deliveredOrder({ userId: customerId });
    await requestReturn(db, boss, {
      orderId: order.id,
      userId: customerId,
      values: request({ lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }),
    });
    await db.transaction((tx) =>
      anonymizeOrdersForSubject(tx, { userId: customerId, email: 'huong@example.com' }),
    );
    const [event] = await eventsOf(order.id, 'return_requested');
    expect(event!.message).toBeNull();
  });
});

describe('staff e-invoice adjustments', () => {
  it('replace then cancel from the panel: audited, one at a time, failures alert staff', async () => {
    const order = await deliveredOrder();
    await issueOrderEinvoice({ db, boss, provider }, order.id);
    await expect(
      cancelEinvoice(ctx('staff'), { orderId: order.id, reason: 'Sai thông tin' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await replaceEinvoice(ctx('manager'), { orderId: order.id, reason: 'Sai tên người mua' });
    await expect(
      cancelEinvoice(ctx('manager'), { orderId: order.id, reason: 'Huỷ hoá đơn' }),
    ).rejects.toMatchObject({ fieldErrors: [{ code: 'adjustmentRunning' }] });

    const [job] = (await jobs('einvoice.adjust')) as { orderId: string; adjustmentId: string }[];
    // Retryable failure: recorded, the job throws for pg-boss backoff.
    const flaky = createSandboxEinvoiceProvider({
      failWith: () => new EinvoiceError('timeout', true),
    });
    await expect(
      runEinvoiceAdjustmentJob({ db, boss, provider: flaky }, job!),
    ).rejects.toBeInstanceOf(EinvoiceRetryError);
    expect((await getOrderEinvoice(db, order.id))?.adjustment).toMatchObject({
      state: 'retrying',
      attempts: 1,
      canAdjust: false,
    });
    // Permanent failure: final, staff alerted, staff may ask again.
    const broken = createSandboxEinvoiceProvider({
      failWith: () => new EinvoiceError('misa:InvalidInvoice', false),
    });
    expect(await adjustOrderEinvoice({ db, boss, provider: broken }, job!)).toMatchObject({
      outcome: 'failed',
      attempt: 2,
    });
    expect(await jobs('staff.alert')).toContainEqual(
      expect.objectContaining({ kind: 'einvoice_adjustment_failed', orderId: order.id }),
    );
    expect((await getOrderEinvoice(db, order.id))?.adjustment).toMatchObject({
      state: 'failed',
      canAdjust: true,
    });
    expect(await adjustOrderEinvoice({ db, boss, provider }, job!)).toMatchObject({
      outcome: 'skipped',
      reason: 'done',
    });

    await cancelEinvoice(ctx('owner'), { orderId: order.id, reason: 'Khách huỷ giao dịch' });
    const cancel = ((await jobs('einvoice.adjust')) as { adjustmentId: string }[]).at(-1)!;
    expect(
      await adjustOrderEinvoice(
        { db, boss, provider },
        { orderId: order.id, adjustmentId: cancel.adjustmentId },
      ),
    ).toMatchObject({ outcome: 'cancelled' });
    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, order.id));
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['order.einvoice_replace', 'order.einvoice_cancel']),
    );
  });
});
