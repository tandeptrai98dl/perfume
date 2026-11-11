import type { PgBoss } from 'pg-boss';

import { errorFields, logger } from '@/server/lib/logger';

import { JOB_NAMES, JOBS, type JobName } from './definitions';
import type { JobHandlers } from './handlers';

/** Registers a pg-boss worker per job; payloads are re-validated before the handler runs. */
export async function registerWorkers(boss: PgBoss, handlers: JobHandlers): Promise<void> {
  for (const name of JOB_NAMES) {
    await boss.work(name, { batchSize: 1 }, async ([job]) => {
      if (!job) return;
      await runJob(name, job.id, job.data, handlers);
    });
  }
}

async function runJob<N extends JobName>(
  name: N,
  id: string,
  data: unknown,
  handlers: JobHandlers,
) {
  const started = Date.now();
  try {
    const payload = JOBS[name].schema.parse(data);
    await (handlers[name] as (p: typeof payload) => Promise<void>)(payload);
    logger.info('job.completed', { job: name, id, ms: Date.now() - started });
  } catch (error) {
    logger.error('job.failed', { job: name, id, ms: Date.now() - started, ...errorFields(error) });
    throw error;
  }
}
