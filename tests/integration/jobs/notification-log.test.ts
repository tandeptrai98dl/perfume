import { asc, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { render, toPlainText } from 'react-email';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { notificationLogs, orders } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import type { ChatNotifier } from '@/server/integrations/chat/telegram';
import type { EmailSender } from '@/server/integrations/email/send';
import { createHandlers, type JobHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { listNotificationLogs } from '@/server/modules/notification';
import { settleOrderAfterEdit } from '@/server/modules/payment';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertOrder } from '../helpers/orders';

/*
 * M3 notification log (§6.2 `notification_logs`): every e-mail / Telegram send leaves a row
 * (masked recipient, queued → sent / failed, skipped); manual-order payment-link e-mail; staff
 * alert when an order edit queues a refund.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;

type Sent = { to: string; subject: string; text: string };
let sent: Sent[];
let failNextEmail: number;

const email: EmailSender = {
  async send(message) {
    if (failNextEmail > 0) {
      failNextEmail -= 1;
      throw new Error(`SMTP 550 mailbox ${message.to} unavailable`);
    }
    const html = await render(message.template);
    sent.push({ to: message.to, subject: message.subject, text: toPlainText(html) });
    return { messageId: `test-${sent.length}` };
  },
  close: () => undefined,
};

const chat: ChatNotifier = { recipient: '-1001234567890', send: async () => undefined };

function handlersWith(options: { staffAlertEmail?: string; chat?: ChatNotifier | null } = {}) {
  return createHandlers({
    db,
    boss,
    email,
    appUrl: 'https://shop.test',
    internalBaseUrl: 'http://web.internal',
    internalSecret: 'x'.repeat(32),
    orderLinkSecret: 'order-link-secret-order-link-secret-00',
    staffAlertEmail: 'staff-alerts@shop.test',
    chat,
    ...options,
  });
}
let handlers: JobHandlers;

async function logsOf(orderId: string) {
  return db
    .select()
    .from(notificationLogs)
    .where(eq(notificationLogs.refId, orderId))
    .orderBy(asc(notificationLogs.createdAt), asc(notificationLogs.id));
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
  handlers = handlersWith();
});

beforeEach(() => {
  sent = [];
  failNextEmail = 0;
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('notification log', () => {
  it('logs the confirmation and both alert channels, recipients masked', async () => {
    const order = await insertOrder(db, { email: 'huong.nguyen@example.com', locale: 'en' });
    await handlers['order.placed']({ orderId: order.id });

    const rows = await logsOf(order.id);
    // Alert channels are sent in parallel: compare without their order.
    expect(rows[0]).toMatchObject({ template: 'order_confirmation', status: 'sent' });
    expect(rows.map((r) => [r.channel, r.template, r.status, r.recipient]).sort()).toEqual([
      ['email', 'order_confirmation', 'sent', 'h***@example.com'],
      ['email', 'staff_alert:new_order', 'sent', 's***@shop.test'],
      ['telegram', 'staff_alert:new_order', 'sent', '***890'],
    ]);
    expect(rows[0]).toMatchObject({ locale: 'en', refType: 'order' });
    expect(rows.every((r) => r.status !== 'sent' || r.sentAt instanceof Date)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('huong.nguyen@');

    // The admin read model returns them newest first.
    const listed = await listNotificationLogs(db, { refType: 'order', refId: order.id });
    expect(listed).toHaveLength(3);
    expect(listed[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(listed[2]!.createdAt.getTime());
  });

  it('records a failed send (PII-free error) and the successful retry', async () => {
    const order = await insertOrder(db, { email: 'retry.me@example.com' });
    failNextEmail = 1;
    await expect(
      handlers['order.status-changed']({ orderId: order.id, from: 'processing', to: 'shipped' }),
    ).rejects.toThrow();
    await handlers['order.status-changed']({
      orderId: order.id,
      from: 'processing',
      to: 'shipped',
    });

    const rows = await logsOf(order.id);
    expect(rows.map((r) => [r.template, r.status])).toEqual([
      ['shipped', 'failed'],
      ['shipped', 'sent'],
    ]);
    expect(rows[0]!.error).toBe('Error: SMTP 550 mailbox [email] unavailable');
  });

  it('logs skipped messages: no customer e-mail, no alert channel', async () => {
    const order = await insertOrder(db, { email: '', status: 'awaiting_confirmation' });
    await handlersWith({ staffAlertEmail: undefined, chat: null })['order.placed']({
      orderId: order.id,
    });
    const rows = await logsOf(order.id);
    expect(rows.map((r) => [r.template, r.status, r.error])).toEqual([
      ['order_confirmation', 'skipped', 'no_recipient'],
      ['staff_alert:new_order', 'skipped', 'no_channel'],
    ]);
  });

  it('logs account e-mails without a reference', async () => {
    await handlers['auth.email']({
      to: 'new.user@example.com',
      locale: 'vi',
      kind: 'verify_email',
      url: 'https://shop.test/verify?token=abc',
    });
    const [row] = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.template, 'auth:verify_email'));
    expect(row).toMatchObject({ status: 'sent', recipient: 'n***@example.com', refId: null });
  });
});

describe('order.payment-link (manual orders)', () => {
  it('e-mails the signed payment page in the order language, once', async () => {
    const order = await insertOrder(db, {
      email: 'zalo@example.com',
      locale: 'en',
      paymentMethod: 'payos',
      total: 1_250_000,
    });
    await handlers['order.payment-link']({ orderId: order.id });
    await handlers['order.payment-link']({ orderId: order.id });

    const mails = sent.filter((m) => m.to === 'zalo@example.com');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(`Pay for order ${order.code}`);
    expect(mails[0]!.text).toContain('₫1,250,000');
    expect(mails[0]!.text).toContain(`https://shop.test/en/checkout/result?code=${order.code}`);
    const rows = await logsOf(order.id);
    expect(rows.map((r) => [r.template, r.status])).toEqual([['paymentLink', 'sent']]);
  });

  it('sends nothing once the order no longer needs money online', async () => {
    const order = await insertOrder(db, { email: 'paid@example.com', paymentMethod: 'payos' });
    await db
      .update(orders)
      .set({ status: 'confirmed', amountPaid: 3_200_000, paymentStatus: 'paid' })
      .where(eq(orders.id, order.id));
    await handlers['order.payment-link']({ orderId: order.id });
    expect(sent).toEqual([]);
  });
});

describe('order edit refund alert', () => {
  it('alerts staff (no PII) in the edit transaction when a refund is queued', async () => {
    const order = await insertOrder(db, { paymentMethod: 'payos', total: 2_000_000 });
    await db
      .update(orders)
      .set({ status: 'confirmed', amountPaid: 3_200_000, paymentStatus: 'paid' })
      .where(eq(orders.id, order.id));
    const settled = await db.transaction((tx) =>
      settleOrderAfterEdit(tx, boss, { orderId: order.id, actorId: null, totalChanged: true }),
    );
    expect(settled.refund).toBe(1_200_000);

    const result = await db.execute<{ data: Record<string, unknown> }>(
      sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job
          where name = 'staff.alert' and data->>'orderId' = ${order.id}`,
    );
    expect(result.rows.map((r) => r.data)).toEqual([
      expect.objectContaining({ kind: 'edit_refund', orderId: order.id }),
    ]);
    expect(String(result.rows[0]!.data.message)).toContain('1200000');

    // The worker turns it into an e-mail + Telegram alert with a Vietnamese title.
    await handlers['staff.alert']({ kind: 'edit_refund', orderId: order.id });
    expect(sent.map((m) => m.subject)).toEqual([
      '[Perfume Store] Sửa đơn phát sinh khoản hoàn tiền',
    ]);
  });
});
