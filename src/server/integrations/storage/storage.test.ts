import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createLocalStorage,
  createMemoryStorage,
  createPrivateStorage,
  isPrivateKey,
  storageFromEnv,
} from '.';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const baseEnv = {
  NODE_ENV: 'development' as const,
  MEDIA_STORAGE: undefined,
  MEDIA_LOCAL_DIR: '.data/media',
  S3_ENDPOINT: undefined,
  S3_REGION: 'us-east-1',
  S3_BUCKET: undefined,
  S3_ACCESS_KEY_ID: undefined,
  S3_SECRET_ACCESS_KEY: undefined,
  S3_FORCE_PATH_STYLE: false,
};

describe('storage adapters', () => {
  it('local adapter writes, reads and deletes inside its root only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'media-'));
    dirs.push(dir);
    const storage = createLocalStorage(dir);
    await storage.put('media/2026/11/a.webp', Buffer.from('x'), { contentType: 'image/webp' });
    expect(await storage.get('media/2026/11/a.webp')).toEqual({
      body: Buffer.from('x'),
      contentType: 'image/webp',
    });
    await storage.delete('media/2026/11/a.webp');
    expect(await storage.get('media/2026/11/a.webp')).toBeNull();
    await expect(storage.get('../etc/passwd')).rejects.toThrow('Invalid storage key');
    await expect(storage.get('/etc/passwd')).rejects.toThrow('Invalid storage key');
  });

  it('memory adapter keeps objects for assertions', async () => {
    const storage = createMemoryStorage();
    await storage.put('media/x.webp', Buffer.from('y'), { contentType: 'image/webp' });
    expect(storage.objects.get('media/x.webp')?.contentType).toBe('image/webp');
  });

  it('chooses the adapter from the environment', () => {
    expect(storageFromEnv(baseEnv)?.kind).toBe('local');
    expect(storageFromEnv({ ...baseEnv, NODE_ENV: 'production' })).toBeNull();
    expect(
      storageFromEnv({ ...baseEnv, NODE_ENV: 'production', MEDIA_STORAGE: 'local' })?.kind,
    ).toBe('local');
    expect(
      storageFromEnv({
        ...baseEnv,
        S3_BUCKET: 'perfume-media',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_FORCE_PATH_STYLE: true,
      })?.kind,
    ).toBe('s3');
  });
});

describe('private storage', () => {
  it('only takes private/ keys and stores them uncacheable', async () => {
    const base = createMemoryStorage();
    const storage = createPrivateStorage(base);
    await storage.put('private/returns/o/p.webp', Buffer.from('x'), 'image/webp');
    expect((await storage.get('private/returns/o/p.webp'))?.body.toString()).toBe('x');
    await expect(storage.put('media/p.webp', Buffer.from('x'), 'image/webp')).rejects.toThrow();
    await expect(storage.get('media/p.webp')).rejects.toThrow();
    await expect(storage.get('private/../media/p.webp')).rejects.toThrow();
    await storage.delete('private/returns/o/p.webp');
    expect(base.objects.size).toBe(0);
    expect(isPrivateKey('private/returns/o/p.webp')).toBe(true);
    expect(isPrivateKey('media/2026/11/p.webp')).toBe(false);
  });
});
