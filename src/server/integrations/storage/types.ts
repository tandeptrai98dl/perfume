/**
 * Object storage for media (ARCHITECTURE.md §4.2, §12). Implementations: S3-compatible
 * (production: AWS, MinIO, Vietnamese S3-compatible clouds), local filesystem (development)
 * and in-memory (tests).
 */
export type StoredObject = { body: Buffer; contentType: string };

export type PutOptions = {
  contentType: string;
  /** Media keys are content-unique, so objects are cached for a year (§14.1). */
  cacheControl?: string;
};

export interface StorageAdapter {
  readonly kind: 's3' | 'local' | 'memory';
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Keys are `a-z0-9`, `-`, `_`, `.` segments separated by `/`; never `..` or absolute. */
export function assertSafeKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(key) || key.includes('..')) {
    throw new Error('Invalid storage key');
  }
}
