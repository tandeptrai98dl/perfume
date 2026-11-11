import { sql } from 'drizzle-orm';

import type { AppPathname, Locale } from '@/i18n/routing';
import { localeFallbacks, type LocalizedSlugs } from '@/lib/seo/locale-fallbacks';
import { localizedPath } from '@/lib/seo/paths';
import type { Database } from '@/server/db/client';

/**
 * Which catalogue URLs exist, for the proxy route table (real 404s for unknown slugs: with
 * Cache Components a streamed `notFound()` cannot change the status) and for the sitemaps.
 * Visibility mirrors the storefront queries in `queries.ts` (ADR-0021: English only when
 * published; products: active, not deleted, published, active brand).
 */

type Executor = Pick<Database, 'execute'>;

export type CatalogRouteKind = 'product' | 'brand' | 'category' | 'collection' | 'family';

export const CATALOG_ROUTES: Record<CatalogRouteKind, AppPathname> = {
  product: '/products/[slug]',
  brand: '/brands/[slug]',
  category: '/categories/[slug]',
  collection: '/collections/[slug]',
  family: '/scent-families/[slug]',
};

/** Where the language switcher lands when an entity has no translation in a locale. */
const LISTINGS: Record<CatalogRouteKind, AppPathname> = {
  product: '/perfumes',
  brand: '/brands',
  category: '/perfumes',
  collection: '/perfumes',
  family: '/perfumes',
};

export type CatalogRouteEntity = {
  kind: CatalogRouteKind;
  id: string;
  slugs: LocalizedSlugs;
  /** Scheduled products/collections become visible at this time (ms), else null. */
  visibleFrom: number | null;
  lastModified: Date | null;
};

type Row = {
  kind: CatalogRouteKind;
  id: string;
  locale: Locale;
  slug: string;
  published: boolean;
  visible_from: Date | string | null;
  last_modified: Date | string | null;
};

const toDate = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value);

/** Every catalogue entity with its per-locale slugs (one query). */
export async function loadCatalogRouteEntities(db: Executor): Promise<CatalogRouteEntity[]> {
  const result = await db.execute<Row>(sql`
    select 'product' as kind, p.id, pt.locale, pt.slug,
      (p.status = 'active' and p.deleted_at is null and pt.is_published
        and b.status = 'active' and b.deleted_at is null) as published,
      p.published_at as visible_from,
      greatest(p.updated_at, pt.updated_at) as last_modified
    from products p
    join product_translations pt on pt.product_id = p.id
    join brands b on b.id = p.brand_id
    union all
    select 'brand', b.id, bt.locale, bt.slug,
      (b.status = 'active' and b.deleted_at is null and bt.is_published),
      null, greatest(b.updated_at, bt.updated_at)
    from brands b join brand_translations bt on bt.brand_id = b.id
    union all
    select 'category', c.id, ct.locale, ct.slug,
      (c.deleted_at is null and ct.is_published),
      null, greatest(c.updated_at, ct.updated_at)
    from categories c join category_translations ct on ct.category_id = c.id
    union all
    select 'collection', c.id, ct.locale, ct.slug,
      (c.is_active and ct.is_published and (c.ends_at is null or c.ends_at > now())),
      c.starts_at, greatest(c.updated_at, ct.updated_at)
    from collections c join collection_translations ct on ct.collection_id = c.id
    union all
    select 'family', f.id, ft.locale, ft.slug, true,
      null, greatest(f.updated_at, ft.updated_at)
    from fragrance_families f join fragrance_family_translations ft on ft.family_id = f.id
  `);

  const byKey = new Map<string, CatalogRouteEntity>();
  for (const row of result.rows) {
    const key = `${row.kind}:${row.id}`;
    const entity = byKey.get(key) ?? {
      kind: row.kind,
      id: row.id,
      slugs: {},
      visibleFrom: toDate(row.visible_from)?.getTime() ?? null,
      lastModified: null,
    };
    entity.slugs[row.locale] = { slug: row.slug, published: row.published };
    const modified = toDate(row.last_modified);
    if (modified && (!entity.lastModified || modified > entity.lastModified)) {
      entity.lastModified = modified;
    }
    byKey.set(key, entity);
  }
  return [...byKey.values()];
}

/** Cheap change detector for the proxy route table (counts + newest update per table). */
export async function loadCatalogRouteVersion(db: Executor): Promise<string> {
  const tables = [
    'products',
    'product_translations',
    'brands',
    'brand_translations',
    'categories',
    'category_translations',
    'collections',
    'collection_translations',
    'fragrance_families',
    'fragrance_family_translations',
  ];
  const parts = tables.map((table) =>
    sql.raw(
      `(select count(*)::text || '.' || coalesce(extract(epoch from max(updated_at))::text, '0') from ${table})`,
    ),
  );
  const result = await db.execute<{ version: string }>(
    sql`select concat_ws(':', ${sql.join(parts, sql`, `)}) as version`,
  );
  return result.rows[0]?.version ?? '0';
}

export function catalogEntityPath(kind: CatalogRouteKind, slug: string, locale: Locale): string {
  return localizedPath(locale, CATALOG_ROUTES[kind], { slug });
}

/** Route-table data (existing paths + language-switch fallbacks) for catalogue entities. */
export function catalogRouteData(entities: CatalogRouteEntity[]): {
  contentPaths: { path: string; visibleFrom: number | null }[];
  localeFallbacks: { path: string; toPath: string }[];
} {
  const contentPaths: { path: string; visibleFrom: number | null }[] = [];
  const fallbacks: { path: string; toPath: string }[] = [];
  const kinds = Object.keys(CATALOG_ROUTES) as CatalogRouteKind[];
  for (const kind of kinds) {
    const ofKind = entities.filter((entity) => entity.kind === kind);
    for (const entity of ofKind) {
      for (const [locale, value] of Object.entries(entity.slugs) as [
        Locale,
        { slug: string; published: boolean },
      ][]) {
        if (value.published) {
          contentPaths.push({
            path: catalogEntityPath(kind, value.slug, locale),
            visibleFrom: entity.visibleFrom,
          });
        }
      }
    }
    fallbacks.push(
      ...localeFallbacks(
        ofKind,
        (slug, locale) => catalogEntityPath(kind, slug, locale),
        (locale) => localizedPath(locale, LISTINGS[kind]),
      ),
    );
  }
  return { contentPaths, localeFallbacks: fallbacks };
}

/** Sitemap entries: only published locales, with real lastModified (§13.1). */
export function catalogSitemapEntries(
  entities: CatalogRouteEntity[],
  kind: CatalogRouteKind,
  now: number = Date.now(),
): { alternates: Partial<Record<Locale, string>>; lastModified: Date | null }[] {
  return entities
    .filter((entity) => entity.kind === kind)
    .filter((entity) => entity.visibleFrom === null || entity.visibleFrom <= now)
    .map((entity) => {
      const alternates: Partial<Record<Locale, string>> = {};
      for (const [locale, value] of Object.entries(entity.slugs) as [
        Locale,
        { slug: string; published: boolean },
      ][]) {
        if (value.published) alternates[locale] = catalogEntityPath(kind, value.slug, locale);
      }
      return { alternates, lastModified: entity.lastModified };
    })
    .filter((entry) => Object.keys(entry.alternates).length > 0);
}
