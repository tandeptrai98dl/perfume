import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type SendOptions } from 'pg-boss';

import type { Database } from '@/server/db/client';

import {
  CRON_JOBS,
  DEAD_LETTER_QUEUE,
  JOB_NAMES,
  JOBS,
  type JobInput,
  type JobName,
} from './definitions';

/**
 * pg-boss setup shared by the web app (producer) and the worker (consumer).
 * No `server-only` here: the worker imports this module (CLAUDE.md).
 */

export const PGBOSS_SCHEMA = 'pgboss';

/** A Drizzle transaction or the root client; both expose `execute`. */
type Executor = Pick<Database, 'execute'>;

export function createBoss(
  connectionString: string,
  options: { role: 'producer' | 'worker' } = { role: 'worker' },
): PgBoss {
  const producer = options.role === 'producer';
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: producer ? 'perfume-web' : 'perfume-worker',
    max: producer ? 3 : 10,
    // Only the worker maintains queues (supervision) and runs cron schedules.
    supervise: !producer,
    schedule: !producer,
  });
}

/** Idempotently creates every queue with its retry policy and the dead-letter queue. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  if (!(await boss.getQueue(DEAD_LETTER_QUEUE))) {
    await boss.createQueue(DEAD_LETTER_QUEUE, { retentionSeconds: 60 * 60 * 24 * 30 });
  }
  for (const name of JOB_NAMES) {
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, { ...JOBS[name].queue, deadLetter: DEAD_LETTER_QUEUE });
    }
  }
}

/**
 * Transactional outbox: enqueue `name` inside the caller's Drizzle transaction, so the job
 * exists if and only if the business change commits.
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   await orderRepo.insert(tx, order);
 *   await enqueue(boss, tx, 'order.confirmation-email', { orderId: order.id });
 * });
 * ```
 */
export async function enqueue<N extends JobName>(
  boss: PgBoss,
  tx: Executor,
  name: N,
  data: JobInput<N>,
  options: Omit<SendOptions, 'db'> = {},
): Promise<string> {
  const payload = JOBS[name].schema.parse(data);
  const id = await boss.send(name, payload, { ...options, db: fromDrizzle(tx, sql) });
  if (!id) throw new Error(`pg-boss did not create a job for ${name}`);
  return id;
}

/**
 * Throttled outbox enqueue (M3 alerts): at most one `name` job per `key` per `seconds` slot
 * (pg-boss singleton slots, `ON CONFLICT DO NOTHING`, so a duplicate never aborts the caller's
 * transaction). With `nextSlot`, a duplicate in the current slot is queued once at the start of
 * the next slot instead of being dropped, so the last event of a burst is still reported.
 * Returns the job id, or null when the slot (and the next one) already holds a job.
 */
export async function enqueueThrottled<N extends JobName>(
  boss: PgBoss,
  tx: Executor,
  name: N,
  data: JobInput<N>,
  throttle: { key: string; seconds: number; nextSlot?: boolean },
): Promise<string | null> {
  const payload = JOBS[name].schema.parse(data);
  return boss.send(name, payload, {
    db: fromDrizzle(tx, sql),
    singletonKey: throttle.key,
    singletonSeconds: throttle.seconds,
    singletonNextSlot: throttle.nextSlot ?? false,
  });
}

/** Registers the recurring jobs (worker only; pg-boss runs one schedule per name cluster-wide). */
export async function scheduleCronJobs(boss: PgBoss): Promise<void> {
  for (const [name, cron] of Object.entries(CRON_JOBS)) {
    if (cron) await boss.schedule(name, cron, {}, { tz: 'UTC' });
  }
}
