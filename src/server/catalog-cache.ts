import { cacheLife, cacheTag } from 'next/cache';

import {
  catalogTags,
  getBrandBySlug,
  getBrandList,
  getCategoryBySlug,
  getCollectionBySlug,
  getFamilyBySlug,
  getFeaturedBrands,
  getFeaturedProducts,
  getProductDetail,
  getProductListing,
  getRelatedProducts,
  getSearchSuggestions,
  loadCatalogRouteEntities,
  listingQuerySchema,
  productCacheEntities,
  type CatalogLocale,
  type ListingQuery,
  type ListingQueryInput,
  type ListingResult,
  type ProductSummary,
} from '@/server/modules/catalog';
import { getDb } from '@/server/db/client';

/*
 * Next-only cached wrappers around the catalogue read API (ARCHITECTURE.md §14.1).
 * `server/modules` must not import `next/cache` (the worker shares it, ADR-0023), so the
 * `'use cache'` + `cacheTag` layer lives here. Tags follow `catalogTags` exactly so admin saves
 * (`revalidateTag`) and the worker (`cache.revalidate` job) refresh these entries.
 *
 * Prices in listings are cached (refreshed by product tags); the PDP shows live price and
 * stock from `getVariantOffers`, which is never cached. Listings filtered by "in stock" use a
 * short lifetime because stock changes do not revalidate list tags.
 */

function tagProducts(items: readonly ProductSummary[]) {
  const tags = new Set<string>();
  for (const item of items) {
    tags.add(catalogTags.product(item.id));
    tags.add(catalogTags.brand(item.brand.id));
  }
  if (tags.size > 0) cacheTag(...[...tags].slice(0, 120));
}

function scopeTag(scope: ListingQuery['scope']): string | null {
  switch (scope.kind) {
    case 'brand':
      return catalogTags.brand(scope.id);
    case 'category':
      return catalogTags.category(scope.id);
    case 'collection':
      return catalogTags.collection(scope.id);
    case 'family':
      return catalogTags.family(scope.id);
    default:
      return null;
  }
}

async function cachedListing(query: ListingQuery): Promise<ListingResult> {
  'use cache';
  cacheLife(query.filters.inStock ? 'minutes' : 'hours');
  cacheTag(
    catalogTags.productList,
    catalogTags.brandList,
    catalogTags.familyList,
    catalogTags.noteList,
  );
  const tag = scopeTag(query.scope);
  if (tag) cacheTag(tag);
  const result = await getProductListing(query);
  tagProducts(result.items);
  return result;
}

/** Normalizes the input first so equivalent URLs share one cache entry. */
export function getListing(input: ListingQueryInput): Promise<ListingResult> {
  return cachedListing(listingQuerySchema.parse(input));
}

export async function getProduct(locale: CatalogLocale, slug: string) {
  'use cache';
  cacheLife('hours');
  const product = await getProductDetail({ locale, slug });
  if (!product) {
    // A product published later under this slug revalidates the list tag.
    cacheTag(catalogTags.productList);
    return null;
  }
  const entities = productCacheEntities(product);
  cacheTag(
    ...entities.productIds.map(catalogTags.product),
    catalogTags.brand(entities.brandId),
    ...entities.familyIds.map(catalogTags.family),
    ...entities.categoryIds.map(catalogTags.category),
    catalogTags.noteList,
  );
  return product;
}

export async function getRelated(locale: CatalogLocale, productId: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.productList, catalogTags.product(productId));
  const items = await getRelatedProducts(locale, productId);
  tagProducts(items);
  return items;
}

export async function getFeatured(locale: CatalogLocale, limit = 8) {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.productList);
  const items = await getFeaturedProducts(locale, limit);
  tagProducts(items);
  return items;
}

export async function getBrands(locale: CatalogLocale) {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.brandList, catalogTags.productList);
  return getBrandList(locale);
}

export async function getHomeBrands(locale: CatalogLocale) {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.brandList, catalogTags.productList);
  return getFeaturedBrands(locale);
}

export async function getBrand(locale: CatalogLocale, slug: string) {
  'use cache';
  cacheLife('hours');
  const brand = await getBrandBySlug({ locale, slug });
  cacheTag(brand ? catalogTags.brand(brand.id) : catalogTags.brandList);
  return brand;
}

export async function getCategory(locale: CatalogLocale, slug: string) {
  'use cache';
  cacheLife('hours');
  const category = await getCategoryBySlug({ locale, slug });
  cacheTag(category ? catalogTags.category(category.id) : catalogTags.categoryTree);
  return category;
}

export async function getCollection(locale: CatalogLocale, slug: string) {
  'use cache';
  cacheLife('hours');
  const collection = await getCollectionBySlug({ locale, slug });
  cacheTag(collection ? catalogTags.collection(collection.id) : catalogTags.collectionList);
  return collection;
}

export async function getFamily(locale: CatalogLocale, slug: string) {
  'use cache';
  cacheLife('hours');
  const family = await getFamilyBySlug({ locale, slug });
  cacheTag(family ? catalogTags.family(family.id) : catalogTags.familyList);
  return family;
}

export async function getSuggestions(locale: CatalogLocale, q: string) {
  'use cache';
  cacheLife('minutes');
  cacheTag(catalogTags.productList, catalogTags.brandList);
  return getSearchSuggestions({ locale, q });
}

/** All catalogue entities with per-locale slugs, for the sitemaps (§13.1). */
export async function getCatalogSitemapEntities() {
  'use cache';
  cacheLife('hours');
  cacheTag(
    catalogTags.productList,
    catalogTags.brandList,
    catalogTags.categoryTree,
    catalogTags.collectionList,
    catalogTags.familyList,
  );
  return loadCatalogRouteEntities(getDb());
}
