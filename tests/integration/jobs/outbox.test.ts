import { count, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';
import { createEmailSender } from '@/server/integrations/email/send';
import { createHandlers } from '@/server/jobs/handlers';
import { createBoss, enqueue, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import { registerWorkers } from '@/server/jobs/runner';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from '@/server/lib/hmac';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

const SECRET = 'integration-internal-secret-0123456789';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let producer: PgBoss;

async function jobCount(name: string): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = ${name}`,
  );
  return result.rows[0]!.n;
}

async function auditCount(action: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.action, action));
  return row!.n;
}

async function jobState(id: string): Promise<string | undefined> {
  const result = await db.execute<{ state: string }>(
    sql`select state from ${sql.identifier(PGBOSS_SCHEMA)}.job where id = ${id}`,
  );
  return result.rows[0]?.state;
}

async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the worker');
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  producer = createBoss(testDb.url, { role: 'producer' });
  await producer.start();
  await ensureQueues(producer);
});

afterAll(async () => {
  await producer?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

describe('transactional outbox (pg-boss inside a Drizzle transaction)', () => {
  it('drops the job when the transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(auditLogs).values({ action: 'test.rollback', entityType: 'system' });
        await enqueue(producer, tx, 'system.test-email', { to: 'a@example.com', locale: 'vi' });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    expect(await auditCount('test.rollback')).toBe(0);
    expect(await jobCount('system.test-email')).toBe(0);
  });

  it('rejects invalid payloads before anything is written', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(auditLogs).values({ action: 'test.invalid', entityType: 'system' });
        // @ts-expect-error -- deliberately invalid payload
        await enqueue(producer, tx, 'system.test-email', { to: 'not-an-email', locale: 'fr' });
      }),
    ).rejects.toThrow();
    expect(await auditCount('test.invalid')).toBe(0);
  });

  it('commits the job with the business change and the worker delivers it', async () => {
    const jobId = await db.transaction(async (tx) => {
      await tx.insert(auditLogs).values({ action: 'test.commit', entityType: 'system' });
      return enqueue(producer, tx, 'system.test-email', { to: 'khach@example.com', locale: 'vi' });
    });
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await auditCount('test.commit')).toBe(1);
    expect(await jobCount('system.test-email')).toBe(1);

    const sent: Array<{ to: string; subject: string; html: string }> = [];
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const email = createEmailSender({ transport, from: 'Perfume Store <no-reply@example.com>' });
    const originalSend = email.send;
    email.send = async (message) => {
      const result = await originalSend(message);
      const { render } = await import('react-email');
      sent.push({ to: message.to, subject: message.subject, html: await render(message.template) });
      return result;
    };

    const worker = createBoss(testDb.url, { role: 'worker' });
    await worker.start();
    await registerWorkers(
      worker,
      createHandlers({
        db,
        boss: producer,
        email,
        appUrl: 'http://localhost:3000',
        internalBaseUrl: 'http://web.internal',
        internalSecret: SECRET,
      }),
    );
    try {
      const message = await waitFor(() => sent[0]);
      expect(message.to).toBe('khach@example.com');
      expect(message.subject).toBe('Email thử nghiệm từ Perfume Store');
      expect(message.html).toContain('lang="vi"');
      expect(message.html).toContain('Hệ thống email đã hoạt động');

      // pg-boss records completion right after the handler resolves.
      expect(
        await waitFor(async () =>
          (await jobState(jobId)) === 'completed' ? 'completed' : undefined,
        ),
      ).toBe('completed');
    } finally {
      await worker.stop({ graceful: false });
    }
  });
});

describe('cache.revalidate handler', () => {
  it('signs the request so /api/internal/revalidate can verify it', async () => {
    let captured: Request | undefined;
    const handlers = createHandlers({
      db,
      boss: producer,
      appUrl: 'http://localhost:3000',
      email: createEmailSender({
        transport: nodemailer.createTransport({ jsonTransport: true }),
        from: 'x@example.com',
      }),
      internalBaseUrl: 'http://web.internal:3000',
      internalSecret: SECRET,
      fetch: async (input, init) => {
        captured = new Request(input, init);
        return new Response('{"revalidated":1}', { status: 200 });
      },
    });

    await handlers['cache.revalidate']({ tags: ['product:1'], expire: 'max' });

    expect(captured?.url).toBe('http://web.internal:3000/api/internal/revalidate');
    const body = await captured!.text();
    expect(
      verify(
        SECRET,
        body,
        captured!.headers.get(TIMESTAMP_HEADER),
        captured!.headers.get(SIGNATURE_HEADER),
      ),
    ).toEqual({ ok: true });
  });

  it('throws on a non-2xx response so pg-boss retries', async () => {
    const handlers = createHandlers({
      db,
      boss: producer,
      appUrl: 'http://localhost:3000',
      email: createEmailSender({
        transport: nodemailer.createTransport({ jsonTransport: true }),
        from: 'x@example.com',
      }),
      internalBaseUrl: 'http://web.internal:3000',
      internalSecret: SECRET,
      fetch: async () => new Response('nope', { status: 401 }),
    });
    await expect(handlers['cache.revalidate']({ tags: ['x'], expire: 'max' })).rejects.toThrow(
      /401/,
    );
  });
});
