import { routing, type Locale } from '@/i18n/routing';

/** Storefront pages that have a slug (ARCHITECTURE.md §5.1). */
export type SlugEntityType = 'product' | 'brand' | 'category' | 'collection' | 'family';

const PATTERNS = {
  product: '/products/[slug]',
  brand: '/brands/[slug]',
  category: '/categories/[slug]',
  collection: '/collections/[slug]',
  family: '/scent-families/[slug]',
} as const satisfies Record<SlugEntityType, keyof typeof routing.pathnames>;

/** Localized storefront path with the locale prefix: `/san-pham/a`, `/en/products/a`. */
export function storefrontPath(entityType: SlugEntityType, locale: Locale, slug: string): string {
  const localized = routing.pathnames[PATTERNS[entityType]][locale].replace('[slug]', slug);
  return locale === routing.defaultLocale ? localized : `/${locale}${localized}`;
}
