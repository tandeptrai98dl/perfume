import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { media, products } from './catalog';
import { localeEnum, primaryId, publicationStatusEnum, timestamps } from './_shared';

/*
 * Content (ARCHITECTURE.md §6.2): journal posts and topics, static pages, banners, menus and
 * redirects. Owned by `server/modules/content`. Rich text is Tiptap JSON (`content jsonb`),
 * sanitized with an allowlist when rendered (§12). Translations follow the catalogue rules:
 * keyed by (entity_id, locale), unique (locale, slug), English visible only when
 * is_published = true (ADR-0011, ADR-0021).
 */

// ---------- Journal ----------

export const posts = pgTable(
  'posts',
  {
    id: primaryId(),
    authorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    coverMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
    status: publicationStatusEnum().notNull().default('draft'),
    /** Visible from this time when `status = 'active'` (allows scheduling). */
    publishedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index().on(t.status, t.publishedAt)],
);

export const postTranslations = pgTable(
  'post_translations',
  {
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    title: text().notNull(),
    slug: text().notNull(),
    excerpt: text(),
    content: jsonb(),
    seoTitle: text(),
    seoDescription: text(),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.locale] }), unique().on(t.locale, t.slug)],
);

/** Journal topics (`/journal/topics/[slug]`). */
export const tags = pgTable('tags', {
  id: primaryId(),
  ...timestamps(),
});

export const tagTranslations = pgTable(
  'tag_translations',
  {
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tagId, t.locale] }), unique().on(t.locale, t.slug)],
);

export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index().on(t.tagId)],
);

/** Products mentioned in a post (internal links, §13.1). */
export const postProducts = pgTable(
  'post_products',
  {
    postId: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.productId] }), index().on(t.productId)],
);

// ---------- Static pages ----------

/**
 * Information and policy pages addressed by a stable `key` (about, authenticity, contact, faq,
 * terms, privacy, returns, shipping, payment, cookies, …).
 */
export const pages = pgTable('pages', {
  id: primaryId(),
  key: text().notNull().unique(),
  status: publicationStatusEnum().notNull().default('draft'),
  ...timestamps(),
});

export const pageTranslations = pgTable(
  'page_translations',
  {
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    title: text().notNull(),
    slug: text().notNull(),
    content: jsonb(),
    seoTitle: text(),
    seoDescription: text(),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.locale] }), unique().on(t.locale, t.slug)],
);

// ---------- Banners ----------

export const bannerPlacementEnum = pgEnum('banner_placement', [
  'home_hero',
  'home_promo',
  'category_top',
  'announcement',
]);

export const banners = pgTable(
  'banners',
  {
    id: primaryId(),
    placement: bannerPlacementEnum().notNull(),
    /** Optional schedule; null means "no bound". */
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    position: integer().notNull().default(0),
    isActive: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index().on(t.placement, t.isActive, t.position),
    check(
      'banners_schedule_check',
      sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);

export const bannerTranslations = pgTable(
  'banner_translations',
  {
    bannerId: uuid()
      .notNull()
      .references(() => banners.id, { onDelete: 'cascade' }),
    locale: localeEnum().notNull(),
    title: text().notNull(),
    subtitle: text(),
    ctaLabel: text(),
    /** Site-relative path (`/nuoc-hoa`) or absolute https URL. */
    ctaUrl: text(),
    desktopMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
    mobileMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
    isPublished: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.bannerId, t.locale] })],
);

// ---------- Navigation ----------

/** Header/footer menus per locale; `items` is validated by the content module (Zod). */
export const navigationMenus = pgTable(
  'navigation_menus',
  {
    id: primaryId(),
    key: text().notNull(),
    locale: localeEnum().notNull(),
    items: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps(),
  },
  (t) => [unique().on(t.key, t.locale)],
);

// ---------- Redirects ----------

/**
 * Public-path redirects applied by `src/proxy.ts` (slug changes keep rankings, §13.1).
 * Paths are absolute public pathnames (`/san-pham/x`, `/en/products/x`); `to_path` may also be
 * an absolute https URL. Chains are collapsed when written (content module).
 */
export const redirects = pgTable(
  'redirects',
  {
    id: primaryId(),
    fromPath: text().notNull().unique(),
    toPath: text().notNull(),
    statusCode: smallint().notNull().default(301),
    hitCount: integer().notNull().default(0),
    lastHitAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index().on(t.toPath),
    check('redirects_status_code_check', sql`${t.statusCode} IN (301, 302, 307, 308)`),
    check('redirects_no_self_check', sql`${t.fromPath} <> ${t.toPath}`),
  ],
);
