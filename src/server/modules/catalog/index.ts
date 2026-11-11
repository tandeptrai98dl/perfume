/**
 * Catalogue module public API. Stream A adds the storefront read side (queries, types,
 * schemas) above; the admin write side lives in its own block below.
 */

export { catalogTags, contentTags } from './cache-tags';

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
