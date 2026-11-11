import { routing, type Locale } from '@/i18n/routing';
import type { Tx } from '@/server/lib/command-context';

/**
 * Slug changes on published pages must keep their old URL alive with a 301
 * (ARCHITECTURE.md §6.3, §13.1). The catalogue does not own the `redirects` table, so commands
 * report changes and call an optional hook inside the same transaction; the content module
 * plugs its redirect writer in there.
 */

export type SlugEntityType = 'product' | 'brand' | 'category' | 'collection' | 'family';

export type SlugChange = {
  entityType: SlugEntityType;
  entityId: string;
  locale: Locale;
  fromSlug: string;
  toSlug: string;
  /** Storefront paths including the locale prefix, e.g. `/san-pham/a` or `/en/products/a`. */
  fromPath: string;
  toPath: string;
};

/** Runs inside the command's transaction; throwing rolls the whole change back. */
export type SlugChangeHook = (tx: Tx, changes: SlugChange[]) => Promise<void>;

const PATTERNS = {
  product: '/products/[slug]',
  brand: '/brands/[slug]',
  category: '/categories/[slug]',
  collection: '/collections/[slug]',
  family: '/scent-families/[slug]',
} as const satisfies Record<SlugEntityType, keyof typeof routing.pathnames>;

export function storefrontPath(entityType: SlugEntityType, locale: Locale, slug: string): string {
  const localized = routing.pathnames[PATTERNS[entityType]][locale].replace('[slug]', slug);
  return locale === routing.defaultLocale ? localized : `/${locale}${localized}`;
}

type SlugState = { slug: string; isPublished?: boolean } | null | undefined;

/**
 * A change counts when the old translation was live (published, or the entity type has no
 * publish flag) and the new translation keeps existing under a different slug.
 */
export function detectSlugChanges(
  entityType: SlugEntityType,
  entityId: string,
  before: Partial<Record<Locale, SlugState>>,
  after: Partial<Record<Locale, SlugState>>,
): SlugChange[] {
  const changes: SlugChange[] = [];
  for (const locale of routing.locales) {
    const previous = before[locale];
    const next = after[locale];
    if (!previous || !next || previous.slug === next.slug) continue;
    if (previous.isPublished === false) continue;
    changes.push({
      entityType,
      entityId,
      locale,
      fromSlug: previous.slug,
      toSlug: next.slug,
      fromPath: storefrontPath(entityType, locale, previous.slug),
      toPath: storefrontPath(entityType, locale, next.slug),
    });
  }
  return changes;
}
