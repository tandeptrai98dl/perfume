import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
  gt,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { RichTextDoc } from '@/lib/rich-text';
import { localeFallbacks, type LocalizedSlugs } from '@/lib/seo/locale-fallbacks';
import type { Database } from '@/server/db/client';
import {
  bannerTranslations,
  banners,
  media,
  mediaTranslations,
  navigationMenus,
  pageTranslations,
  pages,
  postProducts,
  postTags,
  postTranslations,
  posts,
  products,
  productTranslations,
  redirects,
  settings,
  tagTranslations,
  tags,
  users,
} from '@/server/db/schema';

import { homePath, journalPath, pagePath, postPath, topicPath } from './paths';
import type { RouteTableData } from './route-table';
import { menuItemsSchema } from './schemas';
import {
  INFO_PAGE_KEYS,
  isInfoPageKey,
  type Alternates,
  type BannerPlacement,
  type BannerView,
  type Locale,
  type MediaRef,
  type MenuItem,
  type PageView,
  type PostSummary,
  type PostView,
  type PublicationStatus,
  type RedirectRule,
  type RedirectStatusCode,
  type SellerInfo,
  type SitemapContentEntry,
  type TopicView,
} from './types';

/** The root client or a transaction. */
export type DbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

function mediaRef(row: {
  id: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
}): MediaRef | null {
  return row.id && row.url
    ? { id: row.id, url: row.url, width: row.width, height: row.height }
    : null;
}

const asDoc = (value: unknown) => (value ?? null) as RichTextDoc | null;

function maxDate(...dates: (Date | null | undefined)[]): Date {
  return new Date(Math.max(...dates.map((d) => (d ? d.getTime() : 0))));
}

// ---------- Pages ----------

async function pageAlternates(db: DbExecutor, pageId: string, key: string): Promise<Alternates> {
  const rows = await db
    .select({ locale: pageTranslations.locale, slug: pageTranslations.slug })
    .from(pageTranslations)
    .where(and(eq(pageTranslations.pageId, pageId), eq(pageTranslations.isPublished, true)));
  return Object.fromEntries(rows.map((r) => [r.locale, pagePath(key, r.slug, r.locale)]));
}

const pageViewColumns = {
  id: pages.id,
  key: pages.key,
  locale: pageTranslations.locale,
  title: pageTranslations.title,
  slug: pageTranslations.slug,
  content: pageTranslations.content,
  seoTitle: pageTranslations.seoTitle,
  seoDescription: pageTranslations.seoDescription,
  pageUpdatedAt: pages.updatedAt,
  updatedAt: pageTranslations.updatedAt,
};

type PageRow = {
  id: string;
  key: string;
  locale: Locale;
  title: string;
  slug: string;
  content: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  pageUpdatedAt: Date;
  updatedAt: Date;
};

async function toPageView(db: DbExecutor, row: PageRow): Promise<PageView> {
  return {
    id: row.id,
    key: row.key,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    content: asDoc(row.content),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    path: pagePath(row.key, row.slug, row.locale),
    alternates: await pageAlternates(db, row.id, row.key),
    updatedAt: maxDate(row.pageUpdatedAt, row.updatedAt),
  };
}

/** A published information page (about, authenticity, contact, faq…) in `locale`. */
export async function getPublishedPageByKey(
  db: DbExecutor,
  args: { key: string; locale: Locale },
): Promise<PageView | null> {
  const [row] = await db
    .select(pageViewColumns)
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(
      and(
        eq(pages.key, args.key),
        eq(pages.status, 'active'),
        eq(pageTranslations.locale, args.locale),
        eq(pageTranslations.isPublished, true),
      ),
    )
    .limit(1);
  return row ? toPageView(db, row) : null;
}

/** A published policy page by its slug in `locale` (`/policies/[slug]`). */
export async function getPublishedPolicyBySlug(
  db: DbExecutor,
  args: { slug: string; locale: Locale },
): Promise<PageView | null> {
  const [row] = await db
    .select(pageViewColumns)
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(
      and(
        eq(pageTranslations.slug, args.slug),
        eq(pageTranslations.locale, args.locale),
        eq(pageTranslations.isPublished, true),
        eq(pages.status, 'active'),
        notInArray(pages.key, [...INFO_PAGE_KEYS]),
      ),
    )
    .limit(1);
  return row ? toPageView(db, row) : null;
}

/** Published policy pages in `locale`, ordered by title (footer fallbacks, sitemap). */
export async function listPublishedPolicies(
  db: DbExecutor,
  locale: Locale,
): Promise<{ key: string; title: string; path: string }[]> {
  const rows = await db
    .select({ key: pages.key, title: pageTranslations.title, slug: pageTranslations.slug })
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(
      and(
        eq(pages.status, 'active'),
        eq(pageTranslations.locale, locale),
        eq(pageTranslations.isPublished, true),
        notInArray(pages.key, [...INFO_PAGE_KEYS]),
      ),
    )
    .orderBy(asc(pageTranslations.title));
  return rows.map((r) => ({ key: r.key, title: r.title, path: pagePath(r.key, r.slug, locale) }));
}

// ---------- Topics ----------

async function topicAlternates(db: DbExecutor, tagId: string): Promise<Alternates> {
  const rows = await db
    .select({ locale: tagTranslations.locale, slug: tagTranslations.slug })
    .from(tagTranslations)
    .where(and(eq(tagTranslations.tagId, tagId), eq(tagTranslations.isPublished, true)));
  return Object.fromEntries(rows.map((r) => [r.locale, topicPath(r.slug, r.locale)]));
}

export async function getPublishedTopic(
  db: DbExecutor,
  args: { slug: string; locale: Locale },
): Promise<TopicView | null> {
  const [row] = await db
    .select({
      id: tagTranslations.tagId,
      name: tagTranslations.name,
      slug: tagTranslations.slug,
      description: tagTranslations.description,
    })
    .from(tagTranslations)
    .where(
      and(
        eq(tagTranslations.slug, args.slug),
        eq(tagTranslations.locale, args.locale),
        eq(tagTranslations.isPublished, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    locale: args.locale,
    path: topicPath(row.slug, args.locale),
    alternates: await topicAlternates(db, row.id),
  };
}

export async function listPublishedTopics(
  db: DbExecutor,
  locale: Locale,
): Promise<{ id: string; name: string; slug: string; path: string }[]> {
  const rows = await db
    .select({ id: tagTranslations.tagId, name: tagTranslations.name, slug: tagTranslations.slug })
    .from(tagTranslations)
    .where(and(eq(tagTranslations.locale, locale), eq(tagTranslations.isPublished, true)))
    .orderBy(asc(tagTranslations.name));
  return rows.map((r) => ({ ...r, path: topicPath(r.slug, locale) }));
}

// ---------- Posts ----------

function postVisibility(locale: Locale, now?: Date) {
  return and(
    eq(posts.status, 'active'),
    isNull(posts.deletedAt),
    isNotNull(posts.publishedAt),
    now ? lte(posts.publishedAt, now) : undefined,
    eq(postTranslations.locale, locale),
    eq(postTranslations.isPublished, true),
  );
}

const postSummaryColumns = {
  id: posts.id,
  title: postTranslations.title,
  slug: postTranslations.slug,
  excerpt: postTranslations.excerpt,
  publishedAt: posts.publishedAt,
  postUpdatedAt: posts.updatedAt,
  updatedAt: postTranslations.updatedAt,
  coverId: media.id,
  coverUrl: media.url,
  coverWidth: media.width,
  coverHeight: media.height,
};

type PostSummaryRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: Date | null;
  postUpdatedAt: Date;
  updatedAt: Date;
  coverId: string | null;
  coverUrl: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
};

function toPostSummary(row: PostSummaryRow, locale: Locale): PostSummary {
  return {
    id: row.id,
    locale,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    cover: mediaRef({
      id: row.coverId,
      url: row.coverUrl,
      width: row.coverWidth,
      height: row.coverHeight,
    }),
    publishedAt: row.publishedAt!,
    updatedAt: maxDate(row.postUpdatedAt, row.updatedAt),
    path: postPath(row.slug, locale),
  };
}

/**
 * Published post summaries in `locale`, newest first. Pass `now` to hide scheduled posts;
 * cached callers omit it and filter by `publishedAt` at request time instead.
 */
export async function listPublishedPostSummaries(
  db: DbExecutor,
  args: { locale: Locale; topicId?: string; now?: Date; limit?: number },
): Promise<PostSummary[]> {
  const base = db
    .select(postSummaryColumns)
    .from(posts)
    .innerJoin(postTranslations, eq(postTranslations.postId, posts.id))
    .leftJoin(media, eq(media.id, posts.coverMediaId));
  const filtered = args.topicId
    ? base
        .innerJoin(postTags, eq(postTags.postId, posts.id))
        .where(and(postVisibility(args.locale, args.now), eq(postTags.tagId, args.topicId)))
    : base.where(postVisibility(args.locale, args.now));
  const rows = await filtered
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(args.limit ?? 500);
  return rows.map((row) => toPostSummary(row, args.locale));
}

/** A published post by slug in `locale` (see `listPublishedPostSummaries` for `now`). */
export async function getPublishedPost(
  db: DbExecutor,
  args: { slug: string; locale: Locale; now?: Date },
): Promise<PostView | null> {
  const [row] = await db
    .select({
      ...postSummaryColumns,
      content: postTranslations.content,
      seoTitle: postTranslations.seoTitle,
      seoDescription: postTranslations.seoDescription,
      authorName: users.name,
    })
    .from(posts)
    .innerJoin(postTranslations, eq(postTranslations.postId, posts.id))
    .leftJoin(media, eq(media.id, posts.coverMediaId))
    .leftJoin(users, eq(users.id, posts.authorId))
    .where(and(postVisibility(args.locale, args.now), eq(postTranslations.slug, args.slug)))
    .limit(1);
  if (!row) return null;

  const [topicRows, productRows, alternateRows] = await Promise.all([
    db
      .select({ name: tagTranslations.name, slug: tagTranslations.slug })
      .from(postTags)
      .innerJoin(
        tagTranslations,
        and(
          eq(tagTranslations.tagId, postTags.tagId),
          eq(tagTranslations.locale, args.locale),
          eq(tagTranslations.isPublished, true),
        ),
      )
      .where(eq(postTags.postId, row.id))
      .orderBy(asc(tagTranslations.name)),
    db
      .select({ productId: postProducts.productId })
      .from(postProducts)
      .where(eq(postProducts.postId, row.id))
      .orderBy(asc(postProducts.position)),
    db
      .select({ locale: postTranslations.locale, slug: postTranslations.slug })
      .from(postTranslations)
      .where(and(eq(postTranslations.postId, row.id), eq(postTranslations.isPublished, true))),
  ]);

  return {
    ...toPostSummary(row, args.locale),
    content: asDoc(row.content),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    authorName: row.authorName,
    topics: topicRows.map((t) => ({ ...t, path: topicPath(t.slug, args.locale) })),
    productIds: productRows.map((p) => p.productId),
    alternates: Object.fromEntries(
      alternateRows.map((a) => [a.locale, postPath(a.slug, a.locale)]),
    ),
  };
}

// ---------- Banners ----------

const desktopMedia = alias(media, 'desktop_media');
const mobileMedia = alias(media, 'mobile_media');

/** Whether a banner's schedule includes `now` (null bounds are open). */
export function isBannerLive(banner: Pick<BannerView, 'startsAt' | 'endsAt'>, now: Date): boolean {
  const t = now.getTime();
  return (
    (!banner.startsAt || new Date(banner.startsAt).getTime() <= t) &&
    (!banner.endsAt || new Date(banner.endsAt).getTime() > t)
  );
}

/**
 * Active banners for a placement with a published translation in `locale`, by position.
 * Pass `now` to apply the schedule in SQL; cached callers filter with `isBannerLive`.
 */
export async function listActiveBanners(
  db: DbExecutor,
  args: { placement: BannerPlacement; locale: Locale; now?: Date },
): Promise<BannerView[]> {
  const rows = await db
    .select({
      id: banners.id,
      placement: banners.placement,
      position: banners.position,
      startsAt: banners.startsAt,
      endsAt: banners.endsAt,
      title: bannerTranslations.title,
      subtitle: bannerTranslations.subtitle,
      ctaLabel: bannerTranslations.ctaLabel,
      ctaUrl: bannerTranslations.ctaUrl,
      dId: desktopMedia.id,
      dUrl: desktopMedia.url,
      dWidth: desktopMedia.width,
      dHeight: desktopMedia.height,
      mId: mobileMedia.id,
      mUrl: mobileMedia.url,
      mWidth: mobileMedia.width,
      mHeight: mobileMedia.height,
    })
    .from(banners)
    .innerJoin(bannerTranslations, eq(bannerTranslations.bannerId, banners.id))
    .leftJoin(desktopMedia, eq(desktopMedia.id, bannerTranslations.desktopMediaId))
    .leftJoin(mobileMedia, eq(mobileMedia.id, bannerTranslations.mobileMediaId))
    .where(
      and(
        eq(banners.placement, args.placement),
        eq(banners.isActive, true),
        eq(bannerTranslations.locale, args.locale),
        eq(bannerTranslations.isPublished, true),
        args.now ? or(isNull(banners.startsAt), lte(banners.startsAt, args.now)) : undefined,
        args.now ? or(isNull(banners.endsAt), gt(banners.endsAt, args.now)) : undefined,
      ),
    )
    .orderBy(asc(banners.position), asc(banners.id));
  return rows.map((r) => ({
    id: r.id,
    placement: r.placement,
    position: r.position,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    title: r.title,
    subtitle: r.subtitle,
    ctaLabel: r.ctaLabel,
    ctaUrl: r.ctaUrl,
    desktopMedia: mediaRef({ id: r.dId, url: r.dUrl, width: r.dWidth, height: r.dHeight }),
    mobileMedia: mediaRef({ id: r.mId, url: r.mUrl, width: r.mWidth, height: r.mHeight }),
  }));
}

// ---------- Menus and settings ----------

export async function getMenu(
  db: DbExecutor,
  args: { key: string; locale: Locale },
): Promise<MenuItem[]> {
  const [row] = await db
    .select({ items: navigationMenus.items })
    .from(navigationMenus)
    .where(and(eq(navigationMenus.key, args.key), eq(navigationMenus.locale, args.locale)))
    .limit(1);
  const parsed = menuItemsSchema.safeParse(row?.items ?? []);
  return parsed.success ? parsed.data : [];
}

const SELLER_KEYS = {
  companyName: 'company.name',
  taxCode: 'company.taxCode',
  address: 'company.address',
  legalRepresentative: 'company.legalRepresentative',
  phone: 'company.phone',
  email: 'company.email',
  businessRegistration: 'company.businessRegistration',
  moitNotificationUrl: 'company.moitNotificationUrl',
  moitBadgeImageUrl: 'company.moitBadgeImageUrl',
} as const satisfies Record<keyof SellerInfo, string>;

/** Legal seller information shown in the footer and contact page (from `settings`). */
export async function getSellerInfo(db: DbExecutor): Promise<SellerInfo> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, Object.values(SELLER_KEYS)));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const read = (key: string) => {
    const value = byKey.get(key);
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const info = Object.fromEntries(
    Object.entries(SELLER_KEYS).map(([field, key]) => [field, read(key)]),
  ) as SellerInfo;
  // Links rendered as href/src: only absolute http(s) URLs or site-relative paths.
  const safeUrl = (value: string | null) =>
    value && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value)) ? value : null;
  info.moitNotificationUrl = safeUrl(info.moitNotificationUrl);
  info.moitBadgeImageUrl = safeUrl(info.moitBadgeImageUrl);
  return info;
}

// ---------- Redirects ----------

/** DB-backed lookup (the proxy uses the cached route table instead). */
export async function resolveRedirect(
  db: DbExecutor,
  path: string,
): Promise<{ toPath: string; statusCode: RedirectStatusCode } | null> {
  const [row] = await db
    .select({ toPath: redirects.toPath, statusCode: redirects.statusCode })
    .from(redirects)
    .where(eq(redirects.fromPath, path))
    .limit(1);
  return row ? { toPath: row.toPath, statusCode: row.statusCode as RedirectStatusCode } : null;
}

// ---------- Sitemap ----------

type TranslationRow = { id: string; locale: Locale; slug: string; updatedAt: Date };

function groupEntries(
  rows: (TranslationRow & { entityUpdatedAt: Date; key?: string })[],
  path: (row: TranslationRow & { key?: string }) => string,
): SitemapContentEntry[] {
  const byId = new Map<string, SitemapContentEntry>();
  for (const row of rows) {
    const entry = byId.get(row.id) ?? { alternates: {}, lastModified: new Date(0) };
    entry.alternates[row.locale] = path(row);
    entry.lastModified = maxDate(entry.lastModified, row.updatedAt, row.entityUpdatedAt);
    byId.set(row.id, entry);
  }
  return [...byId.values()];
}

/** Published content URLs per locale with real last-modified dates (sitemaps). */
export async function listSitemapEntries(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<{
  pages: SitemapContentEntry[];
  posts: SitemapContentEntry[];
  topics: SitemapContentEntry[];
}> {
  const [pageRows, postRows, topicRows] = await Promise.all([
    db
      .select({
        id: pages.id,
        key: pages.key,
        locale: pageTranslations.locale,
        slug: pageTranslations.slug,
        updatedAt: pageTranslations.updatedAt,
        entityUpdatedAt: pages.updatedAt,
      })
      .from(pages)
      .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
      .where(and(eq(pages.status, 'active'), eq(pageTranslations.isPublished, true)))
      .orderBy(asc(pages.key)),
    db
      .select({
        id: posts.id,
        locale: postTranslations.locale,
        slug: postTranslations.slug,
        updatedAt: postTranslations.updatedAt,
        entityUpdatedAt: posts.updatedAt,
      })
      .from(posts)
      .innerJoin(postTranslations, eq(postTranslations.postId, posts.id))
      .where(
        and(
          eq(posts.status, 'active'),
          isNull(posts.deletedAt),
          lte(posts.publishedAt, now),
          eq(postTranslations.isPublished, true),
        ),
      )
      .orderBy(desc(posts.publishedAt)),
    db
      .select({
        id: tagTranslations.tagId,
        locale: tagTranslations.locale,
        slug: tagTranslations.slug,
        updatedAt: tagTranslations.updatedAt,
        entityUpdatedAt: tags.updatedAt,
      })
      .from(tagTranslations)
      .innerJoin(tags, eq(tags.id, tagTranslations.tagId))
      .where(eq(tagTranslations.isPublished, true))
      .orderBy(asc(tagTranslations.slug)),
  ]);
  return {
    pages: groupEntries(pageRows, (r) => pagePath(r.key!, r.slug, r.locale)),
    posts: groupEntries(postRows, (r) => postPath(r.slug, r.locale)),
    topics: groupEntries(topicRows, (r) => topicPath(r.slug, r.locale)),
  };
}

// ---------- Route table (proxy) ----------

/** Cheap fingerprint of everything the route table depends on. */
export async function loadRouteTableVersion(db: DbExecutor): Promise<string> {
  const part = (table: string) =>
    sql.raw(
      `(select count(*)::text || '.' || coalesce(extract(epoch from max(updated_at))::text, '0') from ${table})`,
    );
  const result = await db.execute<{ version: string }>(
    sql`select concat_ws(':', ${part('redirects')}, ${part('pages')}, ${part('page_translations')}, ${part('posts')}, ${part('post_translations')}, ${part('tag_translations')}) as version`,
  );
  return result.rows[0]?.version ?? '0';
}

type LocalizedEntity = { slugs: LocalizedSlugs };

function collect<T extends { id: string; locale: Locale; slug: string; published: boolean }>(
  rows: T[],
): Map<string, LocalizedEntity & { first: T }> {
  const byId = new Map<string, LocalizedEntity & { first: T }>();
  for (const row of rows) {
    const entity = byId.get(row.id) ?? { slugs: {}, first: row };
    entity.slugs[row.locale] = { slug: row.slug, published: row.published };
    byId.set(row.id, entity);
  }
  return byId;
}

/** Redirects, published content URLs and locale-switch fallbacks for the proxy. */
export async function loadRouteTableData(db: DbExecutor): Promise<RouteTableData> {
  const [redirectRows, pageRows, postRows, topicRows] = await Promise.all([
    db
      .select({
        fromPath: redirects.fromPath,
        toPath: redirects.toPath,
        statusCode: redirects.statusCode,
      })
      .from(redirects),
    db
      .select({
        id: pages.id,
        key: pages.key,
        active: sql<boolean>`${pages.status} = 'active'`,
        locale: pageTranslations.locale,
        slug: pageTranslations.slug,
        published: pageTranslations.isPublished,
      })
      .from(pages)
      .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id)),
    db
      .select({
        id: posts.id,
        publishedAt: posts.publishedAt,
        locale: postTranslations.locale,
        slug: postTranslations.slug,
        published: postTranslations.isPublished,
      })
      .from(posts)
      .innerJoin(postTranslations, eq(postTranslations.postId, posts.id))
      .where(
        and(eq(posts.status, 'active'), isNull(posts.deletedAt), isNotNull(posts.publishedAt)),
      ),
    db
      .select({
        id: tagTranslations.tagId,
        locale: tagTranslations.locale,
        slug: tagTranslations.slug,
        published: tagTranslations.isPublished,
      })
      .from(tagTranslations),
  ]);

  const contentPaths: RouteTableData['contentPaths'] = [];
  const activePages = pageRows.filter((r) => r.active);
  for (const r of activePages) {
    if (r.published)
      contentPaths.push({ path: pagePath(r.key, r.slug, r.locale), visibleFrom: null });
  }
  for (const r of postRows) {
    if (r.published)
      contentPaths.push({
        path: postPath(r.slug, r.locale),
        visibleFrom: r.publishedAt!.getTime(),
      });
  }
  for (const r of topicRows) {
    if (r.published) contentPaths.push({ path: topicPath(r.slug, r.locale), visibleFrom: null });
  }

  const policies = [...collect(activePages.filter((r) => !isInfoPageKey(r.key))).values()];
  const fallbacks = [
    ...localeFallbacks(policies, (slug, locale) => pagePath('policy', slug, locale), homePath),
    ...localeFallbacks([...collect(postRows).values()], postPath, journalPath),
    ...localeFallbacks([...collect(topicRows).values()], topicPath, journalPath),
  ];

  return {
    redirects: redirectRows.map((r) => ({
      fromPath: r.fromPath,
      toPath: r.toPath,
      statusCode: r.statusCode as RedirectStatusCode,
    })),
    contentPaths,
    localeFallbacks: fallbacks,
  };
}

// ---------- Admin reads ----------

export type TranslationStatus = { title: string; slug: string; isPublished: boolean } | null;

function byLocale<T extends { locale: Locale }>(rows: T[]): Partial<Record<Locale, T>> {
  return Object.fromEntries(rows.map((r) => [r.locale, r]));
}

export async function listPagesForAdmin(db: DbExecutor) {
  const rows = await db
    .select({
      id: pages.id,
      key: pages.key,
      status: pages.status,
      updatedAt: pages.updatedAt,
      locale: pageTranslations.locale,
      title: pageTranslations.title,
      slug: pageTranslations.slug,
      isPublished: pageTranslations.isPublished,
    })
    .from(pages)
    .leftJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .orderBy(asc(pages.key));
  const out = new Map<
    string,
    {
      id: string;
      key: string;
      status: PublicationStatus;
      updatedAt: Date;
      vi: TranslationStatus;
      en: TranslationStatus;
    }
  >();
  for (const r of rows) {
    const item = out.get(r.id) ?? {
      id: r.id,
      key: r.key,
      status: r.status,
      updatedAt: r.updatedAt,
      vi: null,
      en: null,
    };
    if (r.locale) item[r.locale] = { title: r.title!, slug: r.slug!, isPublished: r.isPublished! };
    out.set(r.id, item);
  }
  return [...out.values()];
}

export async function getPageForAdmin(db: DbExecutor, id: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  if (!page) return null;
  const translations = await db
    .select()
    .from(pageTranslations)
    .where(eq(pageTranslations.pageId, id));
  return { ...page, translations: byLocale(translations) };
}

export async function listPostsForAdmin(
  db: DbExecutor,
  args: { q?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = args.pageSize ?? 20;
  const page = Math.max(1, args.page ?? 1);
  const where = and(
    isNull(posts.deletedAt),
    args.q
      ? sql`exists (select 1 from ${postTranslations} pt where pt.post_id = ${posts.id} and pt.title ilike ${`%${args.q}%`})`
      : undefined,
  );
  const [{ total }] = (await db.select({ total: count() }).from(posts).where(where)) as [
    { total: number },
  ];
  const ids = await db
    .select({
      id: posts.id,
      status: posts.status,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const translations = ids.length
    ? await db
        .select({
          postId: postTranslations.postId,
          locale: postTranslations.locale,
          title: postTranslations.title,
          slug: postTranslations.slug,
          isPublished: postTranslations.isPublished,
        })
        .from(postTranslations)
        .where(
          inArray(
            postTranslations.postId,
            ids.map((r) => r.id),
          ),
        )
    : [];
  return {
    total,
    page,
    pageSize,
    rows: ids.map((row) => {
      const t = byLocale(translations.filter((tr) => tr.postId === row.id));
      const pick = (locale: Locale): TranslationStatus =>
        t[locale]
          ? { title: t[locale]!.title, slug: t[locale]!.slug, isPublished: t[locale]!.isPublished }
          : null;
      return { ...row, vi: pick('vi'), en: pick('en') };
    }),
  };
}

export async function getPostForAdmin(db: DbExecutor, id: string) {
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
    .limit(1);
  if (!post) return null;
  const [translations, topicRows, productRows] = await Promise.all([
    db.select().from(postTranslations).where(eq(postTranslations.postId, id)),
    db.select({ tagId: postTags.tagId }).from(postTags).where(eq(postTags.postId, id)),
    db
      .select({ productId: postProducts.productId })
      .from(postProducts)
      .where(eq(postProducts.postId, id))
      .orderBy(asc(postProducts.position)),
  ]);
  return {
    ...post,
    translations: byLocale(translations),
    topicIds: topicRows.map((r) => r.tagId),
    productIds: productRows.map((r) => r.productId),
  };
}

export async function listTopicsForAdmin(db: DbExecutor) {
  const rows = await db
    .select({
      id: tags.id,
      locale: tagTranslations.locale,
      name: tagTranslations.name,
      slug: tagTranslations.slug,
      isPublished: tagTranslations.isPublished,
    })
    .from(tags)
    .leftJoin(tagTranslations, eq(tagTranslations.tagId, tags.id))
    .orderBy(asc(tags.createdAt));
  const out = new Map<string, { id: string; vi: TranslationStatus; en: TranslationStatus }>();
  for (const r of rows) {
    const item = out.get(r.id) ?? { id: r.id, vi: null, en: null };
    if (r.locale) item[r.locale] = { title: r.name!, slug: r.slug!, isPublished: r.isPublished! };
    out.set(r.id, item);
  }
  return [...out.values()];
}

export async function getTopicForAdmin(db: DbExecutor, id: string) {
  const [tag] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!tag) return null;
  const translations = await db.select().from(tagTranslations).where(eq(tagTranslations.tagId, id));
  return { ...tag, translations: byLocale(translations) };
}

export async function listBannersForAdmin(db: DbExecutor) {
  const rows = await db
    .select({
      id: banners.id,
      placement: banners.placement,
      position: banners.position,
      isActive: banners.isActive,
      startsAt: banners.startsAt,
      endsAt: banners.endsAt,
      locale: bannerTranslations.locale,
      title: bannerTranslations.title,
      isPublished: bannerTranslations.isPublished,
    })
    .from(banners)
    .leftJoin(bannerTranslations, eq(bannerTranslations.bannerId, banners.id))
    .orderBy(asc(banners.placement), asc(banners.position));
  const out = new Map<
    string,
    {
      id: string;
      placement: BannerPlacement;
      position: number;
      isActive: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
      vi: TranslationStatus;
      en: TranslationStatus;
    }
  >();
  for (const r of rows) {
    const item = out.get(r.id) ?? {
      id: r.id,
      placement: r.placement,
      position: r.position,
      isActive: r.isActive,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      vi: null,
      en: null,
    };
    if (r.locale) item[r.locale] = { title: r.title!, slug: '', isPublished: r.isPublished! };
    out.set(r.id, item);
  }
  return [...out.values()];
}

export async function getBannerForAdmin(db: DbExecutor, id: string) {
  const [banner] = await db.select().from(banners).where(eq(banners.id, id)).limit(1);
  if (!banner) return null;
  const translations = await db
    .select()
    .from(bannerTranslations)
    .where(eq(bannerTranslations.bannerId, id));
  return { ...banner, translations: byLocale(translations) };
}

export async function getMenuForAdmin(db: DbExecutor, key: string) {
  const [vi, en] = await Promise.all([
    getMenu(db, { key, locale: 'vi' }),
    getMenu(db, { key, locale: 'en' }),
  ]);
  return { key, items: { vi, en } };
}

export async function listRedirectsForAdmin(
  db: DbExecutor,
  args: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{
  total: number;
  page: number;
  pageSize: number;
  rows: (RedirectRule & { hitCount: number; lastHitAt: Date | null; createdAt: Date })[];
}> {
  const pageSize = args.pageSize ?? 50;
  const page = Math.max(1, args.page ?? 1);
  const where = args.q
    ? or(ilike(redirects.fromPath, `%${args.q}%`), ilike(redirects.toPath, `%${args.q}%`))
    : undefined;
  const [{ total }] = (await db.select({ total: count() }).from(redirects).where(where)) as [
    { total: number },
  ];
  const rows = await db
    .select()
    .from(redirects)
    .where(where)
    .orderBy(desc(redirects.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({ ...r, statusCode: r.statusCode as RedirectStatusCode })),
  };
}

/** Recent media for pickers (banner images, post covers). Read-only view of catalogue media. */
export async function listMediaOptions(db: DbExecutor, limit = 100) {
  return db
    .select({
      id: media.id,
      url: media.url,
      width: media.width,
      height: media.height,
      alt: mediaTranslations.alt,
    })
    .from(media)
    .leftJoin(
      mediaTranslations,
      and(eq(mediaTranslations.mediaId, media.id), eq(mediaTranslations.locale, 'vi')),
    )
    .where(sql`${media.mime} like 'image/%'`)
    .orderBy(desc(media.createdAt))
    .limit(limit);
}

/** Products that a post can link to (Vietnamese names). Read-only view of the catalogue. */
export async function listProductOptions(db: DbExecutor) {
  return db
    .select({ id: products.id, name: productTranslations.name })
    .from(products)
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'vi')),
    )
    .where(isNull(products.deletedAt))
    .orderBy(asc(productTranslations.name));
}
