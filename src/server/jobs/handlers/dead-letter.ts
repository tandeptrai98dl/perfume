import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import { logger } from '@/server/lib/logger';

import { enqueueThrottled } from '../queue';

/**
 * Dead-letter queue consumer (M3 wave 2, §11.2 "Internal alerts"): a job that exhausted its
 * retries becomes a `job_failed` staff alert. Only the queue name, job id and attempt count
 * are reported — never the payload, which may hold e-mail addresses (ADR-0019).
 *
 * - A failed `staff.alert` is only logged: alerting about the alert channel would loop.
 * - At most one alert per failing queue every JOB_FAILED_THROTTLE_SECONDS, so an outage
 *   (SMTP down, provider unreachable) does not flood the channels; every dead-lettered job is
 *   still logged with its id.
 */

export const JOB_FAILED_THROTTLE_SECONDS = 15 * 60;

export type DeadLetteredJob = {
  id: string;
  /** Queue the job failed on (pg-boss `source_name`). */
  sourceName: string | null;
  /** Id of the original job (pg-boss `source_id`). */
  sourceId: string | null;
  /** Retries the original job used (pg-boss `source_retry_count`). */
  sourceRetryCount: number | null;
};

export function createDeadLetterHandler(deps: { db: Database; boss: PgBoss }) {
  return async (job: DeadLetteredJob): Promise<'alerted' | 'throttled' | 'ignored'> => {
    const name = job.sourceName ?? 'unknown';
    const id = job.sourceId ?? job.id;
    const attempts = (job.sourceRetryCount ?? 0) + 1;
    logger.error('job.dead_lettered', { job: name, id, attempts });
    if (name === 'staff.alert') return 'ignored';
    const queued = await deps.db.transaction((tx) =>
      enqueueThrottled(
        deps.boss,
        tx,
        'staff.alert',
        { kind: 'job_failed', job: { name: name.slice(0, 100), id, attempts } },
        { key: `job_failed:${name}`, seconds: JOB_FAILED_THROTTLE_SECONDS },
      ),
    );
    return queued ? 'alerted' : 'throttled';
  };
}
