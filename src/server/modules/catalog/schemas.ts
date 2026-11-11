import { z } from 'zod';

import {
  CONCENTRATIONS,
  GENDERS,
  LISTING_SORTS,
  SELLABLE_VARIANT_TYPES,
  type CatalogLocale,
} from './types';

/*
 * Read-side input schemas (storefront listings, search). URL parsing lives in
 * src/lib/listing-params.ts; everything reaching a query is re-validated here.
 */

export const LISTING_PAGE_SIZE = 24;
/** Deep pages are never useful and would make OFFSET scans expensive. */
export const LISTING_MAX_PAGE = 200;
const MAX_VALUES_PER_FILTER = 20;
/** Upper bound for price filters (1 billion VND); keeps parameters inside bigint. */
const MAX_PRICE = 1_000_000_000;

export const localeSchema = z.enum(['vi', 'en']) satisfies z.ZodType<CatalogLocale>;

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(160);

/** Drops invalid values instead of failing: a stale or hand-edited URL still renders. */
function lenientArray<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .default([])
    .transform((values) => {
      const valid = new Set<z.infer<T>>();
      for (const value of values) {
        const parsed = item.safeParse(value);
        if (parsed.success) valid.add(parsed.data);
      }
      return [...valid].slice(0, MAX_VALUES_PER_FILTER).sort() as z.infer<T>[];
    });
}

const priceSchema = z.number().int().min(0).max(MAX_PRICE);

export const listingScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('brand'), id: z.uuid() }),
  z.object({ kind: z.literal('category'), id: z.uuid() }),
  z.object({ kind: z.literal('collection'), id: z.uuid() }),
  z.object({ kind: z.literal('family'), id: z.uuid() }),
]);
export type ListingScope = z.infer<typeof listingScopeSchema>;

export const listingFiltersSchema = z
  .object({
    brands: lenientArray(slugSchema),
    genders: lenientArray(z.enum(GENDERS)),
    families: lenientArray(slugSchema),
    notes: lenientArray(slugSchema),
    concentrations: lenientArray(z.enum(CONCENTRATIONS)),
    types: lenientArray(z.enum(SELLABLE_VARIANT_TYPES)),
    minPrice: priceSchema.nullable().catch(null).default(null),
    maxPrice: priceSchema.nullable().catch(null).default(null),
    inStock: z.boolean().catch(false).default(false),
  })
  .transform((filters) => {
    // A reversed range is a user mistake, not an empty result.
    if (
      filters.minPrice !== null &&
      filters.maxPrice !== null &&
      filters.minPrice > filters.maxPrice
    ) {
      return { ...filters, minPrice: filters.maxPrice, maxPrice: filters.minPrice };
    }
    return filters;
  });
export type ListingFilters = z.infer<typeof listingFiltersSchema>;

export const listingQuerySchema = z.object({
  locale: localeSchema,
  scope: listingScopeSchema.default({ kind: 'all' }),
  filters: listingFiltersSchema.default(listingFiltersSchema.parse({})),
  /** Free-text search; normalized by `normalizeSearchQuery`. */
  q: z.string().max(200).catch('').default(''),
  sort: z.enum(LISTING_SORTS).catch('featured').default('featured'),
  page: z.number().int().min(1).max(LISTING_MAX_PAGE).catch(1).default(1),
  pageSize: z.number().int().min(1).max(60).default(LISTING_PAGE_SIZE),
});
export type ListingQueryInput = z.input<typeof listingQuerySchema>;
export type ListingQuery = z.infer<typeof listingQuerySchema>;

export const suggestionsQuerySchema = z.object({
  locale: localeSchema,
  q: z.string().trim().min(1).max(100),
});
export type SuggestionsQuery = z.infer<typeof suggestionsQuerySchema>;

export const productSlugQuerySchema = z.object({ locale: localeSchema, slug: slugSchema });

/** Number of active filter values; listings with two or more are `noindex` (§13.1). */
export function countActiveFilters(filters: ListingFilters): number {
  return (
    filters.brands.length +
    filters.genders.length +
    filters.families.length +
    filters.notes.length +
    filters.concentrations.length +
    filters.types.length +
    (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0) +
    (filters.inStock ? 1 : 0)
  );
}
