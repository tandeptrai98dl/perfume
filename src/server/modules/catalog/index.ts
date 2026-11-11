/**
 * Public API of the catalogue module. `app/` and `actions/` import only from here.
 */

// ---------- Read side: storefront (stream A) ----------
export { catalogTags, contentTags } from './cache-tags';
export {
  getBrandBySlug,
  getBrandList,
  getCategoryBySlug,
  getCollectionBySlug,
  getFamilyBySlug,
  getFeaturedBrands,
  getFeaturedProducts,
  getProductDetail,
  getProductListing,
  getProductSummariesByIds,
  getRelatedProducts,
  getSearchSuggestions,
  getVariantOffers,
  productCacheEntities,
} from './queries';
export {
  countActiveFilters,
  LISTING_MAX_PAGE,
  LISTING_PAGE_SIZE,
  listingFiltersSchema,
  listingQuerySchema,
  suggestionsQuerySchema,
  type ListingFilters,
  type ListingQuery,
  type ListingQueryInput,
  type ListingScope,
} from './schemas';
export { normalizeSearchQuery, toPrefixTsQuery, type NormalizedSearch } from './search-terms';
export * from './types';
// ---------- End read side ----------
