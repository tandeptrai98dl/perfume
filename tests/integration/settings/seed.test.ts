import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from '@/server/db/client';
import { navigationMenus, pageTranslations, pages, products, settings } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { LEGAL_PAGES } from '@/server/db/seed/legal-drafts';
import { getMenu, getPublishedPolicyBySlug } from '@/server/modules/content';
import { settingDefaults } from '@/server/modules/settings';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

/*
 * Production base seed (`SEED_DEMO=false` / NODE_ENV=production): settings defaults, policy
 * pages and the legal menu, without demo data; idempotent and never overwriting edits.
 */

let testDb: TestDatabase;
let db: Database;
let pool: { end: () => Promise<void> };

beforeAll(async () => {
  testDb = await startTestDatabase();
  ({ db, pool } = createDb(testDb.url));
});

afterAll(async () => {
  await pool?.end();
  await testDb?.stop();
});

const count = async (table: typeof pages | typeof products) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

describe('base seed (production)', () => {
  it('creates the policy pages, legal menu and default settings without demo data', async () => {
    const result = await seed(testDb.url, { demo: false });
    expect(result.legal).toEqual({
      created: LEGAL_PAGES.map((p) => p.key),
      skipped: [],
      conflicts: [],
    });
    expect(result.content.skipped).toBe(true);
    expect(await count(products)).toBe(0);
    expect(await count(pages)).toBe(LEGAL_PAGES.length);

    const rows = await db.select().from(settings);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual(settingDefaults());

    expect(await getPublishedPolicyBySlug(db, { slug: 'doi-tra', locale: 'vi' })).not.toBeNull();
    expect(await getPublishedPolicyBySlug(db, { slug: 'returns', locale: 'en' })).not.toBeNull();
    // The English cookie policy stays an unpublished draft (ADR-0021).
    expect(await getPublishedPolicyBySlug(db, { slug: 'cookie-policy', locale: 'en' })).toBeNull();

    const legalVi = await getMenu(db, { key: 'legal', locale: 'vi' });
    expect(legalVi.map((item) => item.id)).toEqual(LEGAL_PAGES.map((p) => p.key));
    expect(legalVi[0]).toMatchObject({ label: 'Chính sách đổi trả', href: '/chinh-sach/doi-tra' });
    const legalEn = await getMenu(db, { key: 'legal', locale: 'en' });
    expect(legalEn.map((item) => item.id)).not.toContain('cookies');
    expect(legalEn[0]).toMatchObject({ href: '/en/policies/returns' });
  });

  it('never overwrites edited pages, menus or settings, and re-creates a missing policy', async () => {
    const [returns] = await db.select().from(pages).where(eq(pages.key, 'returns'));
    await db
      .update(pageTranslations)
      .set({ title: 'Đổi trả (đã duyệt)' })
      .where(and(eq(pageTranslations.pageId, returns!.id), eq(pageTranslations.locale, 'vi')));
    await db
      .update(navigationMenus)
      .set({ items: [] })
      .where(and(eq(navigationMenus.key, 'legal'), eq(navigationMenus.locale, 'en')));
    await db.update(settings).set({ value: 9 }).where(eq(settings.key, 'cod.depositPercent'));
    await db.delete(pages).where(eq(pages.key, 'cookies'));

    const again = await seed(testDb.url, { demo: false });
    expect(again.legal.created).toEqual(['cookies']);
    expect(again.legal.skipped).toHaveLength(LEGAL_PAGES.length - 1);

    const [vi] = await db
      .select({ title: pageTranslations.title })
      .from(pageTranslations)
      .where(and(eq(pageTranslations.pageId, returns!.id), eq(pageTranslations.locale, 'vi')));
    expect(vi!.title).toBe('Đổi trả (đã duyệt)');
    expect(await getMenu(db, { key: 'legal', locale: 'en' })).toEqual([]);
    const [deposit] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'cod.depositPercent'));
    expect(deposit!.value).toBe(9);
  });

  it('skips a policy whose Vietnamese slug another page already uses', async () => {
    await db.delete(pages).where(eq(pages.key, 'terms'));
    const terms = LEGAL_PAGES.find((p) => p.key === 'terms')!;
    const [other] = await db
      .insert(pages)
      .values({ key: 'custom-terms', status: 'active' })
      .returning({ id: pages.id });
    await db.insert(pageTranslations).values({
      pageId: other!.id,
      locale: 'vi',
      title: 'Điều khoản riêng',
      slug: terms.vi.slug,
      isPublished: true,
    });
    const result = await seed(testDb.url, { demo: false });
    expect(result.legal.conflicts).toEqual(['terms']);
    expect(await db.select().from(pages).where(eq(pages.key, 'terms'))).toEqual([]);
  });

  it('adds the demo content on top of the base seed', async () => {
    const demo = await seed(testDb.url, { demo: true });
    expect(demo.content).toEqual({ skipped: false, pages: 4, posts: 2 });
    expect(demo.demo.skipped).toBe(false);
    expect((await getMenu(db, { key: 'footer', locale: 'vi' })).length).toBeGreaterThan(0);
    const again = await seed(testDb.url, { demo: true });
    expect(again.content.skipped).toBe(true);
  });
});
