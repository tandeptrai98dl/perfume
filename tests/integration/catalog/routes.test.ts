import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { seed } from '@/server/db/seed';
import {
  catalogRouteData,
  loadCatalogRouteEntities,
  loadCatalogRouteVersion,
} from '@/server/modules/catalog';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seed(testDb.url, { demo: true });
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('catalogue route table', () => {
  it('knows every demo product in Vietnamese and hides untranslated English pages', async () => {
    const entities = await loadCatalogRouteEntities(db);
    const products = entities.filter((e) => e.kind === 'product');
    expect(products).toHaveLength(4);

    const { contentPaths, localeFallbacks } = catalogRouteData(entities);
    const paths = contentPaths.map((p) => p.path);
    expect(paths.filter((p) => p.startsWith('/san-pham/'))).toHaveLength(4);
    // "Hoa Đêm EDP" has no published English translation (ADR-0021).
    expect(paths.filter((p) => p.startsWith('/en/products/'))).toHaveLength(3);
    expect(localeFallbacks.some((f) => f.toPath === '/en/perfumes')).toBe(true);
    expect(paths.some((p) => p.startsWith('/thuong-hieu/'))).toBe(true);
  });

  it('changes version when catalogue data changes', async () => {
    const before = await loadCatalogRouteVersion(db);
    await db.execute(
      // touch one product so updated_at moves
      (await import('drizzle-orm'))
        .sql`update products set updated_at = now() + interval '1 second' where id = (select id from products limit 1)`,
    );
    expect(await loadCatalogRouteVersion(db)).not.toBe(before);
  });
});
