import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { auditLogs, orderEvents, orders, settings, users } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import {
  createSandboxEinvoiceProvider,
  EinvoiceError,
  type EinvoiceDocument,
  type EinvoiceProvider,
} from '@/server/integrations/einvoice';
import { createHandlers } from '@/server/jobs/handlers';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import type { CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import {
  countFailedEinvoices,
  EINVOICE_MAX_ATTEMPTS,
  EinvoiceRetryError,
  getOrderEinvoice,
  issueOrderEinvoice,
  listFailedEinvoices,
  retryEinvoice,
} from '@/server/modules/einvoice';
import { transitionOrder, type OrderStatus } from '@/server/modules/order';

import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { insertOrder } from '../helpers/orders';

/*
 * Automatic e-invoice (D13, ARCHITECTURE §3.4 step 9, §16.2 "e-invoice job retry"): outbox
 * trigger on delivery, never issued twice (sequential, concurrent, crash between provider
 * success and commit), retry with attempt counting, final failure → staff alert, staff retry.
 */

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let staffId: string;

/** Sandbox provider with a call counter and scripted failures. */
function countingProvider(script: (EinvoiceError | null)[] = [], delayMs = 0) {
  const inner = createSandboxEinvoiceProvider({ series: 'C26TST' });
  const calls = { issue: 0, lookup: 0 };
  const provider: EinvoiceProvider = {
    ...inner,
    async issue(document: EinvoiceDocument) {
      calls.issue += 1;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const failure = script.shift();
      if (failure) throw failure;
      return inner.issue(document);
    },
    async lookup(refId: string) {
      calls.lookup += 1;
      return inner.lookup(refId);
    },
  };
  return { provider, calls, inner };
}

async function jobs(name: string) {
  const result = await db.execute<{ data: Record<string, unknown> }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name} order by created_on`,
  );
  return result.rows.map((row) => row.data);
}

async function events(orderId: string) {
  return db
    .select({
      type: orderEvents.type,
      metadata: orderEvents.metadata,
      message: orderEvents.message,
    })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), sql`${orderEvents.type} like 'einvoice_%'`))
    .orderBy(orderEvents.createdAt, orderEvents.id);
}

async function deliveredOrder(input: { total?: number; vat?: boolean; email?: string } = {}) {
  const order = await insertOrder(db, {
    status: 'shipped',
    total: input.total ?? 3_200_000,
    email: input.email,
  });
  if (input.vat) {
    await db
      .update(orders)
      .set({
        vatInvoice: {
          companyName: 'Công ty TNHH Hương Thơm',
          taxCode: '0312345678',
          email: 'ketoan@huongthom.vn',
          address: '1 Nguyễn Huệ, Phường Sài Gòn, TP Hồ Chí Minh',
        },
      })
      .where(eq(orders.id, order.id));
  }
  await db.transaction((tx) =>
    transitionOrder(tx, boss, {
      orderId: order.id,
      to: 'delivered',
      actor: { type: 'staff', id: staffId },
    }),
  );
  return order;
}

const ctx = (): CommandContext => ({
  db,
  boss,
  actor: { id: staffId, role: 'staff' },
  ip: '127.0.0.1',
});

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
  staffId = newId();
  await db
    .insert(users)
    .values({ id: staffId, name: 'staff', email: 'staff@example.com', role: 'staff' });
});

beforeEach(async () => {
  await db.execute(sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job`);
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('trigger', () => {
  it('enqueues einvoice.issue in the delivery transaction, not on a rejected return', async () => {
    const order = await deliveredOrder();
    expect(await jobs('einvoice.issue')).toEqual([{ orderId: order.id }]);

    await db.transaction(async (tx) => {
      await transitionOrder(tx, boss, {
        orderId: order.id,
        to: 'return_requested',
        actor: { type: 'customer', id: null },
      });
      await transitionOrder(tx, boss, {
        orderId: order.id,
        to: 'delivered' as OrderStatus,
        actor: { type: 'staff', id: staffId },
      });
    });
    expect(await jobs('einvoice.issue')).toHaveLength(1);

    // Rolled-back delivery: no job (outbox).
    const other = await insertOrder(db, { status: 'shipped' });
    await db
      .transaction(async (tx) => {
        await transitionOrder(tx, boss, {
          orderId: other.id,
          to: 'delivered',
          actor: { type: 'staff', id: staffId },
        });
        throw new Error('rollback');
      })
      .catch(() => undefined);
    expect(await jobs('einvoice.issue')).toHaveLength(1);
  });
});

describe('issuing', () => {
  it('issues once through the job handler and stores the reference', async () => {
    const order = await deliveredOrder({ vat: true });
    const { provider, calls } = countingProvider();
    const handlers = createHandlers({
      db,
      boss,
      email: { send: async () => undefined, close: () => undefined } as never,
      appUrl: 'https://shop.test',
      internalBaseUrl: 'http://web.internal',
      internalSecret: 'x'.repeat(32),
      chat: null,
      einvoice: provider,
    });

    await handlers['einvoice.issue']({ orderId: order.id });
    await handlers['einvoice.issue']({ orderId: order.id }); // duplicate / retried job

    expect(calls.issue).toBe(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.einvoiceRef).toMatch(/^C26TST-SBX\d{8}$/);
    expect(row!.einvoiceIssuedAt).toBeInstanceOf(Date);
    const timeline = await events(order.id);
    expect(timeline.map((e) => e.type)).toEqual(['einvoice_issued']);
    expect(timeline[0]!.metadata).toMatchObject({
      provider: 'sandbox',
      series: 'C26TST',
      buyer: 'company',
      vatRate: 10,
      attempt: 1,
      reused: false,
    });
    // No buyer data in the timeline.
    expect(JSON.stringify(timeline)).not.toMatch(/0312345678|Hương|example\.com/);

    const view = await getOrderEinvoice(db, order.id);
    expect(view).toMatchObject({ state: 'issued', canRetry: false, company: true });
    expect(view!.invoice).toMatchObject({ ref: row!.einvoiceRef, provider: 'sandbox' });
  });

  it('never issues twice when two jobs run at the same time', async () => {
    const order = await deliveredOrder();
    const { provider, calls } = countingProvider([], 300);
    const results = await Promise.all([
      issueOrderEinvoice({ db, boss, provider }, order.id),
      issueOrderEinvoice({ db, boss, provider }, order.id),
    ]);
    expect(calls.issue).toBe(1);
    expect(results.map((r) => r.outcome).sort()).toEqual(['issued', 'skipped']);
  });

  it('recovers an invoice the provider issued before a crash (lookup by refId)', async () => {
    const order = await deliveredOrder();
    const { provider, calls, inner } = countingProvider();
    // The provider already has it (our commit was lost).
    await inner.issue({ refId: order.id } as EinvoiceDocument);
    const result = await issueOrderEinvoice({ db, boss, provider }, order.id);
    expect(result).toMatchObject({ outcome: 'issued', reused: true });
    expect(calls.issue).toBe(0);
    expect((await events(order.id))[0]!.metadata).toMatchObject({ reused: true });
  });

  it('uses the VAT rate setting', async () => {
    await db
      .insert(settings)
      .values({ key: 'einvoice.vatRatePercent', value: 8 })
      .onConflictDoUpdate({ target: settings.key, set: { value: 8 } });
    try {
      const order = await deliveredOrder({ total: 1_080_000 });
      const { provider } = countingProvider();
      await issueOrderEinvoice({ db, boss, provider }, order.id);
      expect((await events(order.id))[0]!.metadata).toMatchObject({
        vatRate: 8,
        vatAmount: 80_000,
      });
    } finally {
      await db.delete(settings).where(eq(settings.key, 'einvoice.vatRatePercent'));
    }
  });

  it('skips orders that are not delivered', async () => {
    const order = await insertOrder(db, { status: 'shipped' });
    const { provider, calls } = countingProvider();
    expect(await issueOrderEinvoice({ db, boss, provider }, order.id)).toEqual({
      outcome: 'skipped',
      reason: 'not_eligible',
    });
    expect(calls.issue).toBe(0);
  });
});

describe('retry and failure', () => {
  it('retries transient errors, then fails after the last attempt and alerts staff once', async () => {
    const order = await deliveredOrder();
    const script = Array.from(
      { length: EINVOICE_MAX_ATTEMPTS },
      () => new EinvoiceError('timeout', true),
    );
    const { provider, calls } = countingProvider(script);
    const handlers = createHandlers({
      db,
      boss,
      email: { send: async () => undefined, close: () => undefined } as never,
      appUrl: 'https://shop.test',
      internalBaseUrl: 'http://web.internal',
      internalSecret: 'x'.repeat(32),
      chat: null,
      einvoice: provider,
    });

    for (let attempt = 1; attempt < EINVOICE_MAX_ATTEMPTS; attempt += 1) {
      // pg-boss sees a failure and retries with backoff.
      await expect(handlers['einvoice.issue']({ orderId: order.id })).rejects.toBeInstanceOf(
        EinvoiceRetryError,
      );
      expect((await getOrderEinvoice(db, order.id))!.state).toBe('retrying');
    }
    // Last attempt: recorded as failed, job completes (no endless retries).
    await handlers['einvoice.issue']({ orderId: order.id });

    expect(calls.issue).toBe(EINVOICE_MAX_ATTEMPTS);
    const timeline = await events(order.id);
    expect(timeline.map((e) => e.type)).toEqual([
      ...Array.from({ length: EINVOICE_MAX_ATTEMPTS - 1 }, () => 'einvoice_attempt_failed'),
      'einvoice_failed',
    ]);
    expect(timeline.at(-1)!.metadata).toMatchObject({
      reason: 'timeout',
      attempt: EINVOICE_MAX_ATTEMPTS,
    });
    const alerts = await jobs('staff.alert');
    expect(alerts).toEqual([
      expect.objectContaining({ kind: 'einvoice_failed', orderId: order.id }),
    ]);
    const view = await getOrderEinvoice(db, order.id);
    expect(view).toMatchObject({
      state: 'failed',
      attempts: EINVOICE_MAX_ATTEMPTS,
      canRetry: true,
    });
    expect((await listFailedEinvoices(db)).map((r) => r.orderId)).toContain(order.id);

    // Staff retry: attempts restart, a new job is queued, then it succeeds.
    const before = await countFailedEinvoices(db);
    await retryEinvoice(ctx(), { orderId: order.id });
    expect(await jobs('einvoice.issue')).toContainEqual({ orderId: order.id });
    expect((await getOrderEinvoice(db, order.id))!.state).toBe('pending');
    expect(await countFailedEinvoices(db)).toBe(before - 1);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, order.id), eq(auditLogs.action, 'order.einvoice_retry')));
    expect(audit).toBeTruthy();

    const result = await issueOrderEinvoice({ db, boss, provider }, order.id);
    expect(result).toMatchObject({ outcome: 'issued' });
    expect((await events(order.id)).at(-1)!.metadata).toMatchObject({ attempt: 1 });

    // Issued: retry refused.
    await expect(retryEinvoice(ctx(), { orderId: order.id })).rejects.toMatchObject({
      code: 'invalid',
      fieldErrors: [{ path: 'einvoice', code: 'notRetryable' }],
    });
  });

  it('fails at once on a permanent error (e.g. invalid tax code)', async () => {
    const order = await deliveredOrder({ vat: true });
    const { provider, calls } = countingProvider([new EinvoiceError('misa:InvalidTaxCode', false)]);
    const result = await issueOrderEinvoice({ db, boss, provider }, order.id);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'misa:InvalidTaxCode', attempt: 1 });
    expect(calls.issue).toBe(1);
    expect(await jobs('staff.alert')).toHaveLength(1);
  });

  it('fails with not_configured when production has no provider', async () => {
    const order = await deliveredOrder();
    const result = await issueOrderEinvoice({ db, boss, provider: null }, order.id);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'not_configured' });
    const [alert] = await jobs('staff.alert');
    expect(String(alert!.message)).toContain('not_configured');
  });

  it('refuses a retry while an attempt is scheduled or before delivery', async () => {
    const shipped = await insertOrder(db, { status: 'shipped' });
    await expect(retryEinvoice(ctx(), { orderId: shipped.id })).rejects.toMatchObject({
      code: 'invalid',
    });
    const order = await deliveredOrder();
    const { provider } = countingProvider([new EinvoiceError('timeout', true)]);
    await issueOrderEinvoice({ db, boss, provider }, order.id);
    await expect(retryEinvoice(ctx(), { orderId: order.id })).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});
