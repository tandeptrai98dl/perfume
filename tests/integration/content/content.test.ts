import { count, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { docFromBlocks } from '@/lib/rich-text';
import { createDb, type Database } from '@/server/db/client';
import { auditLogs, redirects } from '@/server/db/schema';
import { seed } from '@/server/db/seed';
import { createBoss, ensureQueues, PGBOSS_SCHEMA } from '@/server/jobs/queue';
import {
  buildSnapshot,
  ContentError,
  createRedirect,
  decideRoute,
  getPublishedPageByKey,
  getPublishedPolicyBySlug,
  getPublishedPost,
  isBannerLive,
  listActiveBanners,
  listPublishedPostSummaries,
  listSitemapEntries,
  loadRouteTableData,
  loadRouteTableVersion,
  recordRedirectHits,
  resolveRedirect,
  saveBanner,
  savePage,
  savePost,
  type ContentDeps,
} from '@/server/modules/content';

import { startTestDatabase, type TestDatabase } from '../helpers/database';

let testDb: TestDatabase;
let db: Database;
let closePool: () => Promise<void>;
let boss: PgBoss;
let deps: ContentDeps;
const actor = { id: null, ip: '127.0.0.1' };

async function revalidateJobs(): Promise<{ tags: string[] }[]> {
  const result = await db.execute<{ data: { tags: string[] } }>(
    sql`select data from ${sql.identifier(PGBOSS_SCHEMA)}.job where name = 'cache.revalidate' order by created_on`,
  );
  return result.rows.map((r) => r.data);
}

const body = docFromBlocks([{ p: 'Nội dung' }]);

function pageInput(overrides: Record<string, unknown> = {}) {
  return {
    key: 'shipping-test',
    status: 'active',
    translations: {
      vi: { title: 'Giao hàng', slug: 'giao-hang-test', content: body, isPublished: true },
      en: { title: 'Shipping', slug: 'shipping-test', content: body, isPublished: false },
    },
    ...overrides,
  };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const created = createDb(testDb.url);
  db = created.db;
  closePool = () => created.pool.end();
  await db.execute(sql`drop schema if exists ${sql.identifier(PGBOSS_SCHEMA)} cascade`);
  boss = createBoss(testDb.url, { role: 'producer' });
  await boss.start();
  await ensureQueues(boss);
  deps = { db, boss };
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await closePool?.();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.execute(sql`delete from ${sql.identifier(PGBOSS_SCHEMA)}.job`);
});

describe('migrations', () => {
  it('apply cleanly on an empty database, including 0003_content', async () => {
    const applied = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    // 0000–0003 plus later migrations; every one must apply on an empty database.
    expect(applied.rows[0]!.n).toBeGreaterThanOrEqual(4);
    const tables = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in
        ('posts','post_translations','tags','tag_translations','post_tags','post_products',
         'pages','page_translations','banners','banner_translations','navigation_menus','redirects')`);
    expect(tables.rows).toHaveLength(12);
  });

  it('enforces the redirect and banner schedule constraints', async () => {
    await expect(
      db.execute(
        sql`insert into redirects (id, from_path, to_path) values (gen_random_uuid(), '/x', '/x')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into banners (id, placement, starts_at, ends_at) values (gen_random_uuid(), 'home_hero', now(), now() - interval '1 day')`,
      ),
    ).rejects.toThrow();
  });
});

describe('demo seed', () => {
  it('seeds bilingual content once and keeps the English cookie draft hidden', async () => {
    const first = await seed(testDb.url, { demo: true });
    expect(first.content).toEqual({ skipped: false, pages: 4, posts: 2 });
    expect(first.legal.created).toHaveLength(6);
    const again = await seed(testDb.url, { demo: true });
    expect(again.content.skipped).toBe(true);

    expect(
      await getPublishedPolicyBySlug(db, { slug: 'chinh-sach-cookie', locale: 'vi' }),
    ).not.toBeNull();
    expect(await getPublishedPolicyBySlug(db, { slug: 'cookie-policy', locale: 'en' })).toBeNull();
    const about = await getPublishedPageByKey(db, { key: 'about', locale: 'en' });
    expect(about?.path).toBe('/en/about');
    expect(about?.alternates).toEqual({ vi: '/gioi-thieu', en: '/en/about' });
    expect(await resolveRedirect(db, '/tap-chi/cach-chon-nong-do-nuoc-hoa')).toEqual({
      toPath: '/tap-chi/edt-hay-edp',
      statusCode: 301,
    });
  });
});

describe('content visibility', () => {
  it('shows English only when published and hides draft pages', async () => {
    await savePage(deps, actor, pageInput());
    expect(
      await getPublishedPolicyBySlug(db, { slug: 'giao-hang-test', locale: 'vi' }),
    ).toMatchObject({
      title: 'Giao hàng',
      path: '/chinh-sach/giao-hang-test',
      alternates: { vi: '/chinh-sach/giao-hang-test' },
    });
    expect(await getPublishedPolicyBySlug(db, { slug: 'shipping-test', locale: 'en' })).toBeNull();

    await savePage(
      deps,
      actor,
      pageInput({
        key: 'draft-test',
        status: 'draft',
        translations: {
          vi: { title: 'Nháp', slug: 'nhap-test', isPublished: true },
        },
      }),
    );
    expect(await getPublishedPolicyBySlug(db, { slug: 'nhap-test', locale: 'vi' })).toBeNull();
  });

  it('requires a published Vietnamese translation before publishing', async () => {
    await expect(
      savePage(
        deps,
        actor,
        pageInput({
          key: 'no-vi-test',
          translations: {
            vi: { title: 'A', slug: 'a-no-vi', isPublished: false },
            en: { title: 'A', slug: 'a-no-vi-en', isPublished: true },
          },
        }),
      ),
    ).rejects.toThrow(/vi_required/);
  });

  it('hides scheduled posts until their publication time', async () => {
    const future = new Date(Date.now() + 86_400_000);
    await savePost(deps, actor, {
      status: 'active',
      publishedAt: future,
      translations: {
        vi: { title: 'Sắp ra mắt', slug: 'sap-ra-mat', content: body, isPublished: true },
      },
    });
    const now = new Date();
    const visible = await listPublishedPostSummaries(db, { locale: 'vi', now });
    expect(visible.map((p) => p.slug)).not.toContain('sap-ra-mat');
    expect(await getPublishedPost(db, { slug: 'sap-ra-mat', locale: 'vi', now })).toBeNull();
    expect(
      (await listSitemapEntries(db, now)).posts.flatMap((e) => Object.values(e.alternates)),
    ).not.toContain('/tap-chi/sap-ra-mat');

    const table = buildSnapshot('t', await loadRouteTableData(db));
    expect(decideRoute(table, '/tap-chi/sap-ra-mat', true)).toEqual({ kind: 'notFound' });
    expect(decideRoute(table, '/tap-chi/sap-ra-mat', true, future.getTime() + 1)).toEqual({
      kind: 'next',
    });
  });

  it('applies banner schedules', async () => {
    const past = new Date(Date.now() - 3_600_000);
    await saveBanner(deps, actor, {
      placement: 'home_promo',
      isActive: true,
      startsAt: past,
      endsAt: new Date(Date.now() - 60_000),
      translations: { vi: { title: 'Đã hết hạn', isPublished: true } },
    });
    await saveBanner(deps, actor, {
      placement: 'home_promo',
      isActive: true,
      startsAt: past,
      translations: {
        vi: { title: 'Đang chạy', ctaLabel: 'Xem', ctaUrl: '/nuoc-hoa', isPublished: true },
        en: { title: 'Running', isPublished: false },
      },
    });
    const now = new Date();
    expect(
      (await listActiveBanners(db, { placement: 'home_promo', locale: 'vi', now })).map(
        (b) => b.title,
      ),
    ).toEqual(['Đang chạy']);
    const all = await listActiveBanners(db, { placement: 'home_promo', locale: 'vi' });
    expect(all.filter((b) => isBannerLive(b, now)).map((b) => b.title)).toEqual(['Đang chạy']);
    expect(await listActiveBanners(db, { placement: 'home_promo', locale: 'en', now })).toEqual([]);
  });
});

describe('slug changes', () => {
  it('insert a redirect for published slugs and collapse renames', async () => {
    const { id } = await savePost(deps, actor, {
      status: 'active',
      translations: {
        vi: { title: 'Mùi gỗ', slug: 'mui-go', content: body, isPublished: true },
        en: { title: 'Woody', slug: 'woody', content: body, isPublished: true },
      },
    });
    const rename = (vi: string, en: string) =>
      savePost(deps, actor, {
        id,
        status: 'active',
        translations: {
          vi: { title: 'Mùi gỗ', slug: vi, content: body, isPublished: true },
          en: { title: 'Woody', slug: en, content: body, isPublished: true },
        },
      });

    await rename('mui-go-am', 'woody');
    expect(await resolveRedirect(db, '/tap-chi/mui-go')).toEqual({
      toPath: '/tap-chi/mui-go-am',
      statusCode: 301,
    });
    expect(await resolveRedirect(db, '/en/journal/woody')).toBeNull();

    await rename('mui-go-moi', 'woody-notes');
    expect(await resolveRedirect(db, '/tap-chi/mui-go')).toMatchObject({
      toPath: '/tap-chi/mui-go-moi',
    });
    expect(await resolveRedirect(db, '/tap-chi/mui-go-am')).toMatchObject({
      toPath: '/tap-chi/mui-go-moi',
    });
    expect(await resolveRedirect(db, '/en/journal/woody')).toMatchObject({
      toPath: '/en/journal/woody-notes',
    });

    // Renaming back makes the old URL live again: no loop, no redirect from a live URL.
    await rename('mui-go', 'woody-notes');
    expect(await resolveRedirect(db, '/tap-chi/mui-go')).toBeNull();
    expect(await resolveRedirect(db, '/tap-chi/mui-go-moi')).toMatchObject({
      toPath: '/tap-chi/mui-go',
    });
    expect(await resolveRedirect(db, '/tap-chi/mui-go-am')).toMatchObject({
      toPath: '/tap-chi/mui-go',
    });

    const jobs = await revalidateJobs();
    expect(jobs.at(-1)!.tags).toEqual(
      expect.arrayContaining(['content:posts', `post:${id}`, 'content:redirects']),
    );
  });

  it('does not redirect slugs that were never live', async () => {
    const { id } = await savePost(deps, actor, {
      status: 'draft',
      translations: { vi: { title: 'Nháp', slug: 'nhap-1', isPublished: false } },
    });
    await savePost(deps, actor, {
      id,
      status: 'draft',
      translations: { vi: { title: 'Nháp', slug: 'nhap-2', isPublished: false } },
    });
    expect(await resolveRedirect(db, '/tap-chi/nhap-1')).toBeNull();
  });

  it('rejects a slug taken in the same locale with a typed error', async () => {
    await expect(savePage(deps, actor, pageInput({ key: 'dup-test' }))).rejects.toEqual(
      new ContentError('slug_taken', 'slug'),
    );
  });
});

describe('createRedirect in a transaction', () => {
  it('collapses chains against existing rows', async () => {
    await db.transaction(async (tx) => {
      await createRedirect(tx, { fromPath: '/b-chain', toPath: '/c-chain' });
      await createRedirect(tx, { fromPath: '/a-chain', toPath: '/b-chain' });
      await createRedirect(tx, { fromPath: '/c-chain', toPath: '/d-chain/' });
    });
    for (const from of ['/a-chain', '/b-chain', '/c-chain']) {
      expect(await resolveRedirect(db, from)).toMatchObject({ toPath: '/d-chain' });
    }
  });

  it('does not bump the route table version when counting hits', async () => {
    const before = await loadRouteTableVersion(db);
    await recordRedirectHits(db, new Map([['/a-chain', 3]]));
    expect(await loadRouteTableVersion(db)).toBe(before);
    const [row] = await db.select().from(redirects).where(eq(redirects.fromPath, '/a-chain'));
    expect(row!.hitCount).toBe(3);
    expect(row!.lastHitAt).toBeInstanceOf(Date);
  });
});

describe('transactional outbox', () => {
  it('enqueues cache.revalidate and the audit entry with the change', async () => {
    const before = (await db.select({ n: count() }).from(auditLogs))[0]!.n;
    const { id, tags } = await savePage(
      deps,
      actor,
      pageInput({
        key: 'outbox-test',
        translations: { vi: { title: 'Outbox', slug: 'outbox-test', isPublished: true } },
      }),
    );
    expect(tags).toEqual(expect.arrayContaining(['content:pages', `page:${id}`]));
    const jobs = await revalidateJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.tags).toEqual(tags);
    expect((await db.select({ n: count() }).from(auditLogs))[0]!.n).toBe(before + 1);
  });

  it('writes neither job nor audit entry when the command fails', async () => {
    const before = (await db.select({ n: count() }).from(auditLogs))[0]!.n;
    await expect(
      savePage(
        deps,
        actor,
        pageInput({
          key: 'outbox-fail',
          translations: { vi: { title: 'Trùng', slug: 'outbox-test', isPublished: true } },
        }),
      ),
    ).rejects.toBeInstanceOf(ContentError);
    expect(await revalidateJobs()).toHaveLength(0);
    expect((await db.select({ n: count() }).from(auditLogs))[0]!.n).toBe(before);
  });
});

describe('route table', () => {
  it('lists live content URLs and locale-switch fallbacks', async () => {
    const data = await loadRouteTableData(db);
    const table = buildSnapshot('t', data);
    expect(decideRoute(table, '/en/about', true)).toEqual({ kind: 'next' });
    expect(decideRoute(table, '/en/policies/cookie-policy', true)).toEqual({ kind: 'notFound' });
    // The language switcher keeps the Vietnamese slug: send it to the English post…
    expect(decideRoute(table, '/en/journal/edt-hay-edp', true)).toEqual({
      kind: 'redirect',
      location: '/en/journal/edt-or-edp',
      status: 307,
    });
    // …or to the English journal when the post has no English version.
    expect(decideRoute(table, '/en/journal/tang-nuoc-hoa-cho-nguoi-moi', true)).toEqual({
      kind: 'redirect',
      location: '/en/journal',
      status: 307,
    });
    expect(decideRoute(table, '/en/policies/chinh-sach-cookie', true)).toEqual({
      kind: 'redirect',
      location: '/en',
      status: 307,
    });
  });
});
