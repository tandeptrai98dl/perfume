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
  getNewestProducts,
  getProductDetail,
  getProductListing,
  getRelatedProducts,
  getProductSummariesByIds,
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
import { bestSellerWindowStart, listBestSellingProductIds } from '@/server/modules/order';

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
  const salesRank = query.sort === 'best_selling' ? await getBestSellerRanking() : [];
  const result = await getProductListing(query, undefined, { salesRank });
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

// ---------- M3 wave 2: home discovery rails (§2 Discovery, §8.3) ----------

/**
 * Product ids ranked by units sold over the last 90 days (order module). Shared by the home
 * rail and the "best selling" sort; refreshed hourly, and when an order starts or stops
 * counting (`refreshBestSellersOnChange`: throttled `catalogTags.bestSellers` expiry).
 */
async function getBestSellerRanking(): Promise<string[]> {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.bestSellers);
  return listBestSellingProductIds(getDb(), { since: bestSellerWindowStart(new Date()) });
}

export async function getNewArrivals(locale: CatalogLocale, limit = 8) {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.productList);
  const items = await getNewestProducts(locale, limit);
  tagProducts(items);
  return items;
}

/**
 * Best sellers visible in `locale` (English only for published translations, ADR-0021).
 * With fewer than `limit` ranked products the rail is topped up with featured products, and
 * falls back to them entirely before the first sale.
 */
export async function getBestSellers(locale: CatalogLocale, limit = 8) {
  'use cache';
  cacheLife('hours');
  cacheTag(catalogTags.productList, catalogTags.bestSellers);
  const ranked = await getBestSellerRanking();
  // Some ranked products may be hidden in this locale: ask for a few more than needed.
  const sold = await getProductSummariesByIds(locale, ranked.slice(0, limit * 3));
  const items = sold.slice(0, limit);
  if (items.length < limit) {
    const seen = new Set(items.map((item) => item.id));
    for (const product of await getFeaturedProducts(locale, limit * 2)) {
      if (items.length >= limit) break;
      if (!seen.has(product.id)) items.push(product);
    }
  }
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
