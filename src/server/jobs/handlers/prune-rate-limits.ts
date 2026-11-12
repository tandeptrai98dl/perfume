import type { Database } from '@/server/db/client';
import { logger } from '@/server/lib/logger';
import { pruneRateLimits } from '@/server/lib/rate-limit';

/** Hourly: removes rate-limit counters whose window ended more than 24 h ago. */
export function createPruneRateLimitsHandler(db: Database) {
  return async () => {
    const removed = await pruneRateLimits(db);
    if (removed > 0) logger.info('rate_limits.pruned', { removed });
  };
}
