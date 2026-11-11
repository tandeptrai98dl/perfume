import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { fragranceNoteTranslations, inventoryItems } from '@/server/db/schema';
import { seed } from '@/server/db/seed';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;

async function search(locale: 'vi' | 'en', query: string): Promise<string[]> {
  const result = await db.execute<{ name: string }>(sql`
    select name from product_translations
    where locale = ${locale}
      and search_vector @@ plainto_tsquery('simple', immutable_unaccent(lower(${query})))
    order by name`);
  return result.rows.map((r) => r.name);
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const first = await seed(testDb.url, { demo: true });
  expect(first.units).toEqual({ provinces: 34, wards: 3321 });
  expect(first.demo.products).toBe(4);
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
});

afterAll(async () => {
  await closePool?.();
  await testDb?.stop();
});

describe('seed', () => {
  it('is idempotent', async () => {
    const second = await seed(testDb.url, { demo: true });
    expect(second.demo.skipped).toBe(true);
    const [{ count }] = (
      await db.execute<{ count: number }>(sql`select count(*)::int as count from wards`)
    ).rows as [{ count: number }];
    expect(count).toBe(3321);
  });
});

describe('product search vector', () => {
  it('matches Vietnamese scent family names without diacritics', async () => {
    expect(await search('vi', 'huong go')).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
      'Soleil Ambré PARFUM',
    ]);
  });

  it('searches the English translation for English terms', async () => {
    expect(await search('en', 'woody')).toHaveLength(3);
    expect(await search('vi', 'woody')).toHaveLength(0);
  });

  it('matches brand name plus concentration', async () => {
    expect(await search('vi', 'lumiere edp')).toEqual(['Cèdre Nocturne EDP']);
  });

  it('updates when a note translation is renamed (trigger)', async () => {
    const note = await db.query.fragranceNoteTranslations.findFirst({
      where: (t, { and, eq: equals }) => and(equals(t.locale, 'en'), equals(t.name, 'Vanilla')),
    });
    expect(note).toBeDefined();
    await db
      .update(fragranceNoteTranslations)
      .set({ name: 'Madagascar Vanilla' })
      .where(
        sql`${fragranceNoteTranslations.noteId} = ${note!.noteId} and ${fragranceNoteTranslations.locale} = 'en'`,
      );
    expect(await search('en', 'madagascar')).toEqual(['Hoa Đêm EDP', 'Soleil Ambré PARFUM']);
  });

  it('supports typo-tolerant name matching with trigrams', async () => {
    const result = await db.execute<{ name: string }>(sql`
      select name from product_translations
      where locale = 'vi' and similarity(immutable_unaccent(lower(name)), 'cedre nocturn') > 0.4`);
    expect(result.rows.map((r) => r.name).sort()).toEqual([
      'Cèdre Nocturne EDP',
      'Cèdre Nocturne EDT',
    ]);
  });
});

describe('inventory constraints', () => {
  it('rejects reserved quantity above stock on hand', async () => {
    const item = await db.query.inventoryItems.findFirst();
    expect(item).toBeDefined();
    await expect(
      db
        .update(inventoryItems)
        .set({ reserved: item!.onHand + 1 })
        .where(eq(inventoryItems.variantId, item!.variantId)),
    ).rejects.toThrow();
  });
});
