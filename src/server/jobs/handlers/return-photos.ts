import { getPrivateStorage, type PrivateStorage } from '@/server/integrations/storage';
import { logger } from '@/server/lib/logger';

import type { HandlerDeps } from '.';
import type { JobPayload } from '../definitions';

/**
 * `returns.delete-photos` (M3 wave 3): private return photos unlinked by the privacy
 * anonymisation. Throws when an object cannot be deleted so pg-boss retries the job.
 */
export function createReturnPhotoHandlers(deps: HandlerDeps) {
  return {
    'returns.delete-photos': async (payload: JobPayload<'returns.delete-photos'>) => {
      const storage: PrivateStorage | null =
        deps.privateStorage === undefined ? getPrivateStorage() : deps.privateStorage;
      if (!storage) {
        logger.warn('returns.photos_storage_missing', { count: payload.keys.length });
        throw new Error('Private storage is not configured');
      }
      for (const key of payload.keys) await storage.delete(key);
      logger.info('returns.photos_deleted', { count: payload.keys.length });
    },
  };
}
