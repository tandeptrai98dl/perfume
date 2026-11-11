import { assertSafeKey, type StorageAdapter, type StoredObject } from './types';

/** In-memory adapter for tests. `objects` is exposed for assertions. */
export function createMemoryStorage(): StorageAdapter & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    kind: 'memory',
    objects,
    async put(key, body, options) {
      assertSafeKey(key);
      objects.set(key, { body: Buffer.from(body), contentType: options.contentType });
    },
    async get(key) {
      assertSafeKey(key);
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
