import type { PgBoss } from 'pg-boss';

import { serverEnv } from '@/lib/env';

import { createBoss, ensureQueues } from './queue';

let starting: Promise<PgBoss> | undefined;

/**
 * Lazily started pg-boss producer for the web process (ADR-0023): small pool, no supervision
 * or cron. Server Actions pass it to `enqueue(boss, tx, …)` inside their transaction.
 */
export function getProducerBoss(): Promise<PgBoss> {
  starting ??= (async () => {
    const boss = createBoss(serverEnv().DATABASE_URL, { role: 'producer' });
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })().catch((error: unknown) => {
    starting = undefined;
    throw error;
  });
  return starting;
}
