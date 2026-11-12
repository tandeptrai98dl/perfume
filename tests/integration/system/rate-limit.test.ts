import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';
import {
  consumeRateLimit,
  MAX_WINDOW_MS,
  pruneRateLimits,
  rateLimitKey,
} from '@/server/lib/rate-limit';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

beforeAll(async () => {
  testDb = await startTestDatabase();
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
});

afterAll(async () => {
  await closePool();
  await testDb.stop();
});

beforeEach(async () => {
  await db.execute(sql`truncate ${rateLimits}`);
});

const rule = { limit: 3, windowMs: 60_000 };

describe('consumeRateLimit (rate_limits table)', () => {
  it('allows `limit` attempts per window, then reports the wait', async () => {
    const start = new Date('2026-11-12T10:00:00Z');
    for (const remaining of [2, 1, 0]) {
      const result = await consumeRateLimit(db, {
        scope: 'test',
        subject: '203.0.113.1',
        rule,
        now: start,
      });
      expect(result).toEqual({ ok: true, remaining, retryAfterMs: 0 });
    }
    const later = new Date(start.getTime() + 20_000);
    const blocked = await consumeRateLimit(db, {
      scope: 'test',
      subject: '203.0.113.1',
      rule,
      now: later,
    });
    expect(blocked).toEqual({ ok: false, remaining: 0, retryAfterMs: 40_000 });

    // Another subject or scope has its own counter.
    expect(
      (await consumeRateLimit(db, { scope: 'test', subject: '203.0.113.2', rule, now: later })).ok,
    ).toBe(true);
    expect(
      (await consumeRateLimit(db, { scope: 'other', subject: '203.0.113.1', rule, now: later })).ok,
    ).toBe(true);
  });

  it('starts a new window once the old one has passed', async () => {
    const start = new Date('2026-11-12T10:00:00Z');
    const input = { scope: 'test', subject: 'k', rule: { limit: 1, windowMs: 1_000 } };
    expect((await consumeRateLimit(db, { ...input, now: start })).ok).toBe(true);
    expect(
      (await consumeRateLimit(db, { ...input, now: new Date(start.getTime() + 999) })).ok,
    ).toBe(false);
    const next = new Date(start.getTime() + 1_000);
    expect(await consumeRateLimit(db, { ...input, now: next })).toEqual({
      ok: true,
      remaining: 0,
      retryAfterMs: 0,
    });
    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, rateLimitKey('test', 'k')));
    expect(row?.count).toBe(1);
    expect(row?.windowStart.toISOString()).toBe(next.toISOString());
  });

  it('is atomic: 20 concurrent attempts against a limit of 5 let exactly 5 through', async () => {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(db, {
          scope: 'placeOrder',
          subject: '198.51.100.20',
          now,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, rateLimitKey('placeOrder', '198.51.100.20')));
    expect(row?.count).toBe(20);
  });

  it('never stores the raw subject', async () => {
    await consumeRateLimit(db, { scope: 'orderLookup', subject: '192.0.2.77' });
    const rows = await db.select({ key: rateLimits.key }).from(rateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).not.toContain('192.0.2.77');
  });

  it('prunes counters older than the longest window', async () => {
    const now = new Date('2026-11-12T10:00:00Z');
    await consumeRateLimit(db, {
      scope: 'test',
      subject: 'old',
      rule,
      now: new Date(now.getTime() - MAX_WINDOW_MS - 1),
    });
    await consumeRateLimit(db, { scope: 'test', subject: 'fresh', rule, now });
    expect(await pruneRateLimits(db, now)).toBe(1);
    const rows = await db.select({ key: rateLimits.key }).from(rateLimits);
    expect(rows.map((row) => row.key)).toEqual([rateLimitKey('test', 'fresh')]);
  });
});
