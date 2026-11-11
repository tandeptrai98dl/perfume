/**
 * Read-side catalogue types (storefront). Prices are integer VND. Every shape is plain JSON
 * (strings, numbers, booleans, arrays) so results can be stored by `'use cache'`.
 */

export type CatalogLocale = 'vi' | 'en';

export const GENDERS = ['male', 'female', 'unisex'] as const;
export type Gender = (typeof GENDERS)[number];

export const CONCENTRATIONS = ['edc', 'edt', 'edp', 'parfum', 'extrait', 'other'] as const;
export type Concentration = (typeof CONCENTRATIONS)[number];

/** Variant types the storefront may show. `decant` is never exposed in MVP (ADR-0015). */
export const SELLABLE_VARIANT_TYPES = ['full_size', 'travel', 'tester', 'gift_set'] as const;
export type SellableVariantType = (typeof SELLABLE_VARIANT_TYPES)[number];

export const NOTE_LAYERS = ['top', 'middle', 'base'] as const;
export type NoteLayer = (typeof NOTE_LAYERS)[number];

export const LISTING_SORTS = [
  'featured',
  'newest',
  'price_asc',
  'price_desc',
  'best_selling',
  'relevance',
] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

/** Image reference; build the URL with `mediaUrl(storageKey)` (src/lib/media-url.ts). */
export type MediaImage = {
  id: string;
  storageKey: string;
  url: string;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  /** Alt text in the requested locale (empty string when missing). */
  alt: string;
  /** Set when the image belongs to one variant (variant-specific photo). */
  variantId: string | null;
};

export type BrandRef = { id: string; name: string; slug: string };

/** One product in a grid (ProductCard). */
export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  brand: BrandRef;
  concentration: Concentration;
  gender: Gender;
  /** Lowest price among the variants that match the active filters (all variants without). */
  fromPrice: number;
  /** compare-at price of that cheapest variant, when on sale. */
  fromCompareAtPrice: number | null;
  /** True when sellable variants have different prices ("From …"). */
  hasPriceRange: boolean;
  variantCount: number;
  images: MediaImage[];
  ratingAvg: number;
  ratingCount: number;
};

export type FacetOption = { value: string; label: string; count: number };

export type ListingFacets = {
  brands: FacetOption[];
  genders: FacetOption[];
  families: FacetOption[];
  notes: FacetOption[];
  concentrations: FacetOption[];
  types: FacetOption[];
  inStock: number;
};

export type ListingResult = {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: ListingFacets;
  /** Normalized search terms that were applied (empty when not a search). */
  searchTerms: string[];
  /** True when full-text found nothing and typo-tolerant matching was used instead. */
  fuzzy: boolean;
};

export type ProductVariantDetail = {
  id: string;
  sku: string;
  barcode: string | null;
  sizeMl: number;
  variantType: SellableVariantType;
  /** Price at the time the page was cached; the PDP renders live prices from `getVariantOffers`. */
  price: number;
  compareAtPrice: number | null;
  isDefault: boolean;
};

export type ProductNoteRef = { id: string; name: string; slug: string };

export type ProductFamilyRef = { id: string; name: string; slug: string; isPrimary: boolean };

export type ProductLineSibling = {
  id: string;
  slug: string;
  name: string;
  concentration: Concentration;
  isCurrent: boolean;
};

export type CategoryRef = { id: string; name: string; slug: string };

/** Tiptap JSON document (rendered by components/shop/rich-text.tsx). */
export type RichTextDoc = { type: string; content?: unknown[]; [key: string]: unknown };

export type ProductDetail = {
  id: string;
  locale: CatalogLocale;
  slug: string;
  name: string;
  subtitle: string | null;
  description: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  brand: BrandRef & {
    country: string | null;
    story: RichTextDoc | null;
  };
  productLine: { id: string; name: string } | null;
  siblings: ProductLineSibling[];
  concentration: Concentration;
  gender: Gender;
  releaseYear: number | null;
  perfumer: string | null;
  longevity: number | null;
  sillage: number | null;
  seasons: string[];
  occasions: string[];
  ratingAvg: number;
  ratingCount: number;
  compliance: {
    countryOfOrigin: string | null;
    cosmeticNotificationNo: string | null;
    responsibleImporter: string | null;
    ingredients: string | null;
    warnings: string | null;
  };
  variants: ProductVariantDetail[];
  images: MediaImage[];
  notes: Record<NoteLayer, ProductNoteRef[]>;
  families: ProductFamilyRef[];
  categories: CategoryRef[];
  /** Slug of the same product in each locale where it is visible (hreflang, switcher). */
  localeSlugs: Partial<Record<CatalogLocale, string>>;
  updatedAt: string;
};

/** Live price + availability of one variant (never cached). */
export type VariantOffer = {
  variantId: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  available: number;
  stockState: 'in_stock' | 'low_stock' | 'out_of_stock';
};

export type BrandListItem = BrandRef & {
  country: string | null;
  isFeatured: boolean;
  productCount: number;
  logo: MediaImage | null;
};

export type BrandPage = BrandRef & {
  country: string | null;
  story: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  logo: MediaImage | null;
  localeSlugs: Partial<Record<CatalogLocale, string>>;
};

/** Category, collection or scent family landing page header. */
export type TaxonomyPage = {
  id: string;
  kind: 'category' | 'collection' | 'family';
  name: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  localeSlugs: Partial<Record<CatalogLocale, string>>;
};

export type SearchSuggestions = {
  products: Pick<
    ProductSummary,
    'id' | 'slug' | 'name' | 'brand' | 'concentration' | 'fromPrice' | 'hasPriceRange' | 'images'
  >[];
  brands: BrandRef[];
};
