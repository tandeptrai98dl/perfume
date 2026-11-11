import type { PgBoss } from 'pg-boss';

import { serverEnv } from '@/lib/env';
import { errorFields, logger } from '@/server/lib/logger';

import { createBoss, ensureQueues } from './queue';

/**
 * Lazily started pg-boss producer for the web app (Server Actions enqueue outbox jobs with
 * `enqueue(await getProducer(), tx, …)`). One small pool per process (ADR-0023).
 */

let producer: Promise<PgBoss> | undefined;

export function getProducer(): Promise<PgBoss> {
  producer ??= (async () => {
    const boss = createBoss(serverEnv().DATABASE_URL, { role: 'producer' });
    boss.on('error', (error: unknown) => logger.error('pgboss.producer.error', errorFields(error)));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })().catch((error: unknown) => {
    producer = undefined;
    throw error;
  });
  return producer;
}

/** Alias used by the catalogue admin actions (stream B). */
export const getProducerBoss = getProducer;
