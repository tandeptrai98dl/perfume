import { assertSafeKey, type StorageAdapter, type StoredObject } from './types';

/**
 * Private objects (M3 wave 3: customer return photos) in the same S3-compatible bucket, under
 * the `private/` prefix. Nothing under it is ever public:
 * - the bucket policy grants anonymous read on `media/*` only (docker/compose.yml, runbook);
 * - the local-filesystem route `/api/media/…` refuses the prefix;
 * - objects are written `Cache-Control: private, no-store` and read back only by server code
 *   behind a staff permission (e.g. `/api/admin/orders/<id>/return-photos/<photoId>`).
 */
export const PRIVATE_PREFIX = 'private/';
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

export function isPrivateKey(key: string): boolean {
  return key.startsWith(PRIVATE_PREFIX);
}

function assertPrivateKey(key: string): void {
  assertSafeKey(key);
  if (!isPrivateKey(key)) throw new Error('Private storage keys start with private/');
}

export interface PrivateStorage {
  readonly kind: StorageAdapter['kind'];
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export function createPrivateStorage(base: StorageAdapter): PrivateStorage {
  return {
    kind: base.kind,
    async put(key, body, contentType) {
      assertPrivateKey(key);
      await base.put(key, body, { contentType, cacheControl: PRIVATE_CACHE_CONTROL });
    },
    async get(key) {
      assertPrivateKey(key);
      return base.get(key);
    },
    async delete(key) {
      assertPrivateKey(key);
      await base.delete(key);
    },
  };
}
