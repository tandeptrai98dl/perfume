/**
 * Public API of the catalogue module. `app/` and `actions/` import only from here:
 * storefront read side, route table/sitemaps, and the admin write side.
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
  getNewestProducts,
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

// Route table + sitemaps (which catalogue URLs exist)
export {
  CATALOG_ROUTES,
  catalogEntityPath,
  catalogRouteData,
  catalogSitemapEntries,
  loadCatalogRouteEntities,
  loadCatalogRouteVersion,
  type CatalogRouteEntity,
  type CatalogRouteKind,
} from './routes';

// Admin (write side)
export {
  createProduct,
  deleteBrand,
  deleteCategory,
  deleteCollection,
  deleteFamily,
  deleteNote,
  deleteProduct,
  deleteProductLine,
  duplicateProduct,
  saveBrand,
  saveCategory,
  saveCollection,
  saveFamily,
  saveNote,
  saveProduct,
  saveProductLine,
  setCollectionProducts,
  setProductStatus,
  type CatalogContext,
  type EntityWriteResult,
} from './commands';
export * as adminSchemas from './admin-schemas';
export type {
  BrandInput,
  CategoryInput,
  CollectionInput,
  ContentLocale,
  ListQuery,
  ProductCreateInput,
  ProductSaveInput,
  ProductLineInput,
  TaxonomyInput,
  VariantInput,
} from './admin-schemas';
export {
  BRAND_SORTS,
  brandOptions,
  getBrand,
  getCategory,
  getCollection,
  getMediaItems,
  getProductForEdit,
  getTaxonomy,
  listBrands,
  listCategories,
  listCollections,
  listProductLines,
  listProducts,
  listTaxonomy,
  orderTree,
  PRODUCT_SORTS,
  productEditorOptions,
  productLineOptions,
  searchProductOptions,
  taxonomyOptions,
  translationStatus,
  type BrandDetail,
  type BrandListRow,
  type CategoryDetail,
  type CategoryRow,
  type CollectionDetail,
  type CollectionRow,
  type MediaItem,
  type ProductEditorOptions,
  type ProductForEdit,
  type ProductLineRow,
  type ProductListRow,
  type TaxonomyDetail,
  type TaxonomyKind,
  type TaxonomyRow,
  type TranslationStatus,
} from './admin-queries';
export {
  detectSlugChanges,
  storefrontPath,
  type SlugChange,
  type SlugChangeHook,
  type SlugEntityType,
} from './slug-changes';
export { PRICE_FIELDS, priceFieldViolations } from './variant-rules';
export { uploadMedia, type UploadedMedia } from './media';

// ---------- M3 reviews stream: denormalized rating, written from review moderation ----------
export { setProductRating } from './ratings';
