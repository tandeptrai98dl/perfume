import { and, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { render, toPlainText } from 'react-email';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { orderEvents, orders, payments, shipments } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import type { ChatNotifier } from '@/server/integrations/chat/telegram';
import { createEmailSender, type EmailSender } from '@/server/integrations/email/send';
import { createHandlers, type JobHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { computeOrderAccessToken } from '@/server/lib/order-token';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertOrder } from '../helpers/orders';

const SECRET = 'order-link-secret-order-link-secret-00';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;

type Sent = { to: string; subject: string; text: string; html: string };
let sent: Sent[];
let chatMessages: string[];
let failNextEmail: number;
let failChat: boolean;
let handlers: JobHandlers;

function captureSender(): EmailSender {
  const real = createEmailSender({
    transport: nodemailer.createTransport({ jsonTransport: true }),
    from: 'Perfume Store <no-reply@example.com>',
  });
  return {
    async send(message) {
      if (failNextEmail > 0) {
        failNextEmail -= 1;
        throw new Error('SMTP unavailable');
      }
      const html = await render(message.template);
      sent.push({
        to: message.to,
        subject: message.subject,
        html,
        text: toPlainText(html).replace(/ /g, ' '),
      });
      return real.send(message);
    },
    close: () => real.close(),
  };
}

const chat: ChatNotifier = {
  async send(text) {
    if (failChat) throw new Error('Telegram down');
    chatMessages.push(text);
  },
};

async function eventsOf(orderId: string, type: string) {
  return db
    .select({ metadata: orderEvents.metadata })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, type)));
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
    orderLinkSecret: SECRET,
    staffAlertEmail: 'alerts@shop.test',
    chat,
  });
});

beforeEach(() => {
  sent = [];
  chatMessages = [];
  failNextEmail = 0;
  failChat = false;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('order.placed', () => {
  it('sends the confirmation in the order locale once, plus staff alerts without PII', async () => {
    const order = await insertOrder(db, {
      locale: 'en',
      email: 'buyer@example.com',
      paymentMethod: 'cod',
      status: 'awaiting_confirmation',
      total: 6_000_000,
    });

    await handlers['order.placed']({ orderId: order.id });
    await handlers['order.placed']({ orderId: order.id }); // retried / duplicated job

    const customer = sent.filter((m) => m.to === 'buyer@example.com');
    expect(customer).toHaveLength(1);
    expect(customer[0]!.subject).toBe(`Order ${order.code} received`);
    expect(customer[0]!.html).toContain('lang="en"');
    expect(customer[0]!.text).toContain('₫6,000,000');
    const link = `https://shop.test/en/order-lookup?code=${order.code}&amp;t=${computeOrderAccessToken(SECRET, order.code)}`;
    expect(customer[0]!.html).toContain(link);

    // Above the COD threshold (5,000,000): new order + high-value COD, by e-mail and Telegram.
    const staff = sent.filter((m) => m.to === 'alerts@shop.test');
    expect(staff.map((m) => m.subject).sort()).toEqual([
      '[Perfume Store] Đơn COD giá trị cao',
      '[Perfume Store] Đơn hàng mới',
    ]);
    expect(chatMessages).toHaveLength(2);
    for (const text of [...chatMessages, ...staff.map((m) => m.text)]) {
      expect(text).toContain(order.code);
      expect(text).not.toContain('Nguyễn Thị Hương');
      expect(text).not.toContain('0912345678');
      expect(text).not.toContain('buyer@example.com');
      expect(text).not.toContain('12 Hàng Bạc');
    }
    expect(chatMessages[0]).toContain(order.provinceName);

    expect(await eventsOf(order.id, 'email_sent')).toEqual([
      { metadata: { key: 'order_confirmation', template: 'order_confirmation', locale: 'en' } },
    ]);
    expect(await eventsOf(order.id, 'staff_alert_sent')).toHaveLength(2);
  });

  it('retries after an SMTP failure without sending twice', async () => {
    const order = await insertOrder(db, { locale: 'vi', email: 'retry@example.com' });
    failNextEmail = 1;
    await expect(handlers['order.placed']({ orderId: order.id })).rejects.toThrow(
      'SMTP unavailable',
    );
    expect(await eventsOf(order.id, 'email_sent')).toHaveLength(0);

    await handlers['order.placed']({ orderId: order.id });
    await handlers['order.placed']({ orderId: order.id });
    const customer = sent.filter((m) => m.to === 'retry@example.com');
    expect(customer).toHaveLength(1);
    expect(customer[0]!.subject).toBe(`Đã nhận đơn hàng ${order.code}`);
    // Normal-value online order: only the "new order" alert.
    expect(sent.filter((m) => m.to === 'alerts@shop.test')).toHaveLength(1);
  });

  it('records the alert when one channel delivered and only throws when all failed', async () => {
    const order = await insertOrder(db, { locale: 'vi' });
    failChat = true;
    await handlers['order.placed']({ orderId: order.id });
    const [alert] = await eventsOf(order.id, 'staff_alert_sent');
    expect(alert!.metadata).toMatchObject({ key: 'staff:new_order', channels: ['email'] });

    failNextEmail = 1;
    await expect(
      handlers['staff.alert']({ kind: 'suspicious_ipn', orderId: order.id }),
    ).rejects.toThrow(/every channel/);
  });
});

describe('order.status-changed', () => {
  it('sends shipped (with tracking), delivered and cancelled e-mails once each', async () => {
    const order = await insertOrder(db, { locale: 'vi', email: 'ship@example.com' });
    await db
      .insert(shipments)
      .values({ orderId: order.id, carrier: 'ghn', trackingCode: 'GHN-778899' });

    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'confirmed',
      to: 'processing',
    });
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'processing',
      to: 'shipped',
    });
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'processing',
      to: 'shipped',
    });
    await handlers['order.status-changed']({ orderId: order.id, from: 'shipped', to: 'delivered' });
    // A rejected return goes back to delivered: no second "delivered" e-mail.
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'return_requested',
      to: 'delivered',
    });

    expect(sent.map((m) => m.subject)).toEqual([
      `Đơn hàng ${order.code} đang được giao`,
      `Đơn hàng ${order.code} đã được giao`,
    ]);
    expect(sent[0]!.text).toContain('GHN-778899');
    expect(sent[0]!.text).toContain('Giao Hàng Nhanh');
    expect(sent[0]!.html).toContain('https://donhang.ghn.vn/?order_code=GHN-778899');
  });

  it('sends the cancellation in English for an English order', async () => {
    const order = await insertOrder(db, { locale: 'en', email: 'cancel@example.com' });
    await handlers['order.status-changed']({ orderId: order.id, from: 'pending', to: 'cancelled' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(`Order ${order.code} has been cancelled`);
  });
});

describe('payment.received', () => {
  it('sends one e-mail per payment with the amount and the balance', async () => {
    const order = await insertOrder(db, {
      locale: 'vi',
      email: 'pay@example.com',
      total: 6_000_000,
    });
    await db.update(orders).set({ amountPaid: 1_200_000 }).where(eq(orders.id, order.id));
    const [payment] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: 'payos',
        kind: 'deposit',
        amount: 1_200_000,
        status: 'succeeded',
        txnRef: `T-${order.code}`,
      })
      .returning({ id: payments.id });

    await handlers['payment.received']({ orderId: order.id, paymentId: payment!.id });
    await handlers['payment.received']({ orderId: order.id, paymentId: payment!.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(`Đã nhận thanh toán cho đơn hàng ${order.code}`);
    expect(sent[0]!.text).toContain('1.200.000 ₫');
    expect(sent[0]!.text).toContain('4.800.000 ₫');
  });

  it('ignores a payment that belongs to another order', async () => {
    const a = await insertOrder(db);
    const b = await insertOrder(db);
    const [payment] = await db
      .insert(payments)
      .values({ orderId: a.id, provider: 'vnpay', kind: 'full', amount: 1, txnRef: `T-${a.code}` })
      .returning({ id: payments.id });
    await handlers['payment.received']({ orderId: b.id, paymentId: payment!.id });
    expect(sent).toHaveLength(0);
  });
});
