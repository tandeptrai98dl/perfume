import type { ServerEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env';

import { createLocalStorage } from './local';
import { createPrivateStorage, type PrivateStorage } from './private';
import { createS3Storage } from './s3';
import type { StorageAdapter } from './types';

export { createLocalStorage } from './local';
export { createMemoryStorage } from './memory';
export { createS3Storage, type S3StorageConfig } from './s3';
export { assertSafeKey, IMMUTABLE_CACHE_CONTROL, type StorageAdapter } from './types';
export {
  createPrivateStorage,
  isPrivateKey,
  PRIVATE_CACHE_CONTROL,
  PRIVATE_PREFIX,
  type PrivateStorage,
} from './private';

type StorageEnv = Pick<
  ServerEnv,
  | 'NODE_ENV'
  | 'MEDIA_STORAGE'
  | 'MEDIA_LOCAL_DIR'
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'S3_FORCE_PATH_STYLE'
>;

/**
 * `s3` when S3_BUCKET is set (or MEDIA_STORAGE=s3); otherwise the local filesystem outside
 * production. Production without S3 has no storage unless MEDIA_STORAGE=local is explicit.
 */
export function storageFromEnv(env: StorageEnv): StorageAdapter | null {
  const kind =
    env.MEDIA_STORAGE ?? (env.S3_BUCKET ? 's3' : env.NODE_ENV === 'production' ? null : 'local');
  if (kind === 's3') {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
    return createS3Storage({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  if (kind === 'local') return createLocalStorage(env.MEDIA_LOCAL_DIR);
  return null;
}

let cached: StorageAdapter | null | undefined;

/** Process-wide adapter from the environment; `null` when media storage is not configured. */
export function getStorage(): StorageAdapter | null {
  if (cached === undefined) cached = storageFromEnv(serverEnv());
  return cached;
}

/** Private objects (`private/…`) through the same adapter; `null` when storage is not configured. */
export function getPrivateStorage(): PrivateStorage | null {
  const storage = getStorage();
  return storage ? createPrivateStorage(storage) : null;
}
