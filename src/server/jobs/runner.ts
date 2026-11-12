import type { PgBoss } from 'pg-boss';

import { errorFields, logger } from '@/server/lib/logger';

import { DEAD_LETTER_QUEUE, JOB_NAMES, JOBS, type JobName } from './definitions';
import type { JobHandlers } from './handlers';
import type { DeadLetteredJob } from './handlers/dead-letter';

export type JobErrorReporter = (error: unknown, context: { job: JobName; id: string }) => void;

/** Registers a pg-boss worker per job; payloads are re-validated before the handler runs. */
export async function registerWorkers(
  boss: PgBoss,
  handlers: JobHandlers,
  onError?: JobErrorReporter,
): Promise<void> {
  for (const name of JOB_NAMES) {
    await boss.work(name, { batchSize: 1 }, async ([job]) => {
      if (!job) return;
      await runJob(name, job.id, job.data, handlers, onError);
    });
  }
}

async function runJob<N extends JobName>(
  name: N,
  id: string,
  data: unknown,
  handlers: JobHandlers,
  onError?: JobErrorReporter,
) {
  const started = Date.now();
  try {
    const payload = JOBS[name].schema.parse(data);
    await (handlers[name] as (p: typeof payload) => Promise<void>)(payload);
    logger.info('job.completed', { job: name, id, ms: Date.now() - started });
  } catch (error) {
    logger.error('job.failed', { job: name, id, ms: Date.now() - started, ...errorFields(error) });
    // pg-boss retries with backoff; the reporter (Sentry in the worker) sees every failure.
    onError?.(error, { job: name, id });
    throw error;
  }
}

/**
 * Consumes the dead-letter queue (M3 wave 2): each job that exhausted its retries is handed to
 * `handler` with its provenance (`sourceName`, `sourceId`, `sourceRetryCount`).
 */
export async function registerDeadLetterWorker(
  boss: PgBoss,
  handler: (job: DeadLetteredJob) => Promise<unknown>,
  onError?: (error: unknown, context: { job: string; id: string }) => void,
): Promise<void> {
  await boss.work(DEAD_LETTER_QUEUE, { batchSize: 1, includeMetadata: true }, async ([job]) => {
    if (!job) return;
    try {
      await handler({
        id: job.id,
        sourceName: job.sourceName ?? null,
        sourceId: job.sourceId ?? null,
        sourceRetryCount: job.sourceRetryCount ?? null,
      });
    } catch (error) {
      logger.error('job.dead_letter_failed', { id: job.id, ...errorFields(error) });
      onError?.(error, { job: DEAD_LETTER_QUEUE, id: job.id });
      throw error;
    }
  });
}
