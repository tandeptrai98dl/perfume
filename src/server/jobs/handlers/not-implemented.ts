import { logger } from '@/server/lib/logger';

import type { JobName } from '../definitions';

/**
 * Placeholder used while an M2 stream builds the real handler: acknowledges the job and logs a
 * warning so queues do not fill with retries. Every use is replaced before M2 is merged.
 */
export function notImplemented(job: JobName) {
  return async () => {
    logger.warn('job.not_implemented', { job });
  };
}
