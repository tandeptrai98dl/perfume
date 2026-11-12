import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  brands,
  orderItems,
  orders,
  productVariants,
  products,
  reviews,
  users,
} from '@/server/db/schema';
import { createDeadLetterHandler } from '@/server/jobs/handlers/dead-letter';
import { resolveStaffAlertDetails } from '@/server/jobs/handlers/staff-alert-details';
import { createBoss, enqueueThrottled, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { registerDeadLetterWorker } from '@/server/jobs/runner';
import { newId } from '@/server/lib/ids';
import { generateOrderCode } from '@/server/modules/order';
import { submitMemberReview } from '@/server/modules/review';

import { startCommandHarness, type CommandHarness } from '../helpers/commands';

/*
 * M3 wave 2 alert producers: dead-lettered jobs → `job_failed` (worker), reviews awaiting
 * moderation → throttled `review_pending`, and the details read when an alert is sent.
 */

let h: CommandHarness;
let variantId: string;
let productId: string;

type AlertJob = { data: Record<string, unknown>; start_after: Date; state: string };

async function alerts(kind: string): Promise<AlertJob[]> {
  const result = await h.db.execute<AlertJob>(
    sql`select data, start_after, state from ${sql.identifier(PGBOSS_SCHEMA)}.job
        where name = 'staff.alert' and data->>'kind' = ${kind} order by created_on`,
  );
  return result.rows;
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the worker');
}

async function deliveredLine(userId: string): Promise<string> {
  const orderId = newId();
  await h.db.insert(orders).values({
    id: orderId,
    code: generateOrderCode(),
    userId,
    email: 'member@example.com',
    phone: '0912345678',
    customerName: 'Khách',
    locale: 'vi',
    status: 'delivered',
    paymentMethod: 'cod',
    subtotal: 1_000_000,
    total: 1_000_000,
  });
  const itemId = newId();
  await h.db.insert(orderItems).values({
    id: itemId,
    orderId,
    productId,
    variantId,
    productName: 'Alert EDP',
    variantLabel: '50 ml',
    sku: 'ALERT-2',
    unitPrice: 1_000_000,
    quantity: 1,
    lineTotal: 1_000_000,
  });
  return itemId;
}

beforeAll(async () => {
  h = await startCommandHarness();
  const brandId = newId();
  productId = newId();
  variantId = newId();
  await h.db.insert(brands).values({ id: brandId, name: 'Alert Brand', status: 'active' });
  await h.db
    .insert(products)
    .values({ id: productId, brandId, gender: 'unisex', concentration: 'edp' });
  await h.db.insert(productVariants).values({
    id: variantId,
    productId,
    sku: 'ALERT-2',
    sizeMl: 50,
    price: 1_000_000,
    weightG: 300,
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('dead-letter queue → job_failed', () => {
  let worker: PgBoss;

  afterAll(async () => {
    await worker?.stop({ graceful: false });
  });

  it('alerts with the queue name, job id and attempts once a job exhausts its retries', async () => {
    worker = createBoss(h.url, { role: 'worker' });
    await worker.start();
    await worker.work('system.test-email', { pollingIntervalSeconds: 0.5 }, async () => {
      throw new Error('SMTP unreachable');
    });
    await registerDeadLetterWorker(worker, createDeadLetterHandler({ db: h.db, boss: h.boss }));
    const jobId = await h.boss.send(
      'system.test-email',
      { to: 'secret-customer@example.com', locale: 'vi' },
      { retryLimit: 0 },
    );

    const [alert] = await waitFor(async () => {
      const rows = await alerts('job_failed');
      return rows.length > 0 ? rows : undefined;
    });
    expect(alert!.data).toEqual({
      kind: 'job_failed',
      job: { name: 'system.test-email', id: jobId, attempts: 1 },
    });
    // The failed job's payload (an e-mail address) never reaches the alert.
    expect(JSON.stringify(alert!.data)).not.toContain('secret-customer');
  });

  it('throttles per queue and never alerts about a failed staff alert', async () => {
    const handler = createDeadLetterHandler({ db: h.db, boss: h.boss });
    const job = (sourceName: string) => ({
      id: newId(),
      sourceName,
      sourceId: newId(),
      sourceRetryCount: 5,
    });
    // `system.test-email` already alerted in this window (previous test).
    expect(await handler(job('system.test-email'))).toBe('throttled');
    expect(await handler(job('order.placed'))).toBe('alerted');
    expect(await handler(job('order.placed'))).toBe('throttled');
    expect(await handler(job('staff.alert'))).toBe('ignored');
    expect(await alerts('job_failed')).toHaveLength(2);
  });
});

describe('review_pending', () => {
  it('queues one alert now and one at the next hour for a burst of reviews', async () => {
    const userId = newId();
    await h.db.insert(users).values({ id: userId, name: 'Member', email: 'member@example.com' });
    const values = {
      reviewerName: 'Hương',
      rating: 5,
      longevity: null,
      sillage: null,
      title: 'Thơm lâu',
      body: 'Mùi gỗ ấm, lưu hương cả ngày làm việc.',
    };
    for (let i = 0; i < 3; i += 1) {
      await submitMemberReview(h.db, {
        userId,
        orderItemId: await deliveredLine(userId),
        locale: 'vi',
        values,
        boss: h.boss,
      });
    }
    const queued = await alerts('review_pending');
    expect(queued).toHaveLength(2);
    expect(queued[0]!.data).toEqual({ kind: 'review_pending' });
    // The second one waits for the next hourly slot; the third review is folded into it.
    const nextSlot = new Date(queued[1]!.start_after).getTime();
    expect(nextSlot).toBeGreaterThan(Date.now());
    expect(nextSlot - Date.now()).toBeLessThanOrEqual(3600_000);

    // The worker reports the count at send time, and skips once the queue is empty.
    expect(await resolveStaffAlertDetails(h.db, { kind: 'review_pending' })).toEqual({
      details: { kind: 'review_pending', pending: 3 },
    });
    await h.db.update(reviews).set({ status: 'approved' });
    expect(await resolveStaffAlertDetails(h.db, { kind: 'review_pending' })).toEqual({
      skip: 'nothing_pending',
    });
  });

  it('a duplicate in a full slot never aborts the business transaction', async () => {
    const id = await h.db.transaction(async (tx) =>
      enqueueThrottled(
        h.boss,
        tx,
        'staff.alert',
        { kind: 'review_pending' },
        { key: 'review_pending', seconds: 3600, nextSlot: true },
      ),
    );
    expect(id).toBeNull();
  });
});

describe('low_stock details', () => {
  it('reads SKU, product name and current figures; skips inactive variants', async () => {
    const resolved = await resolveStaffAlertDetails(h.db, { kind: 'low_stock', variantId });
    expect(resolved).toEqual({
      details: {
        kind: 'low_stock',
        variantId,
        sku: 'ALERT-2',
        productName: '',
        available: 0,
        threshold: 3,
      },
    });
    await h.db.update(productVariants).set({ isActive: false });
    expect(await resolveStaffAlertDetails(h.db, { kind: 'low_stock', variantId })).toEqual({
      skip: 'variant_inactive',
    });
    expect(await resolveStaffAlertDetails(h.db, { kind: 'new_order' })).toEqual({
      details: null,
    });
  });
});
