import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';

import { assertSafeKey, type StorageAdapter, type StoredObject } from './types';

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/** Filesystem adapter for development without MinIO. Never used in production by default. */
export function createLocalStorage(rootDir: string): StorageAdapter {
  const root = resolve(rootDir);

  function pathFor(key: string): string {
    assertSafeKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid storage key');
    return path;
  }

  return {
    kind: 'local',
    async put(key, body) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key): Promise<StoredObject | null> {
      try {
        const body = await readFile(pathFor(key));
        return {
          body,
          contentType: CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream',
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
