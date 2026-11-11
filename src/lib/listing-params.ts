import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
} from 'nuqs/server';

import type { ListingFilters, ListingSort } from '@/server/modules/catalog';

/*
 * URL state of product listings (§10.1): shared by the server page (parsing searchParams)
 * and the client filter controls (nuqs). Values are re-validated by the catalogue schemas.
 */

export const SORT_VALUES = [
  'featured',
  'newest',
  'price_asc',
  'price_desc',
  'best_selling',
  'relevance',
] as const satisfies readonly ListingSort[];

const csv = parseAsArrayOf(parseAsString, ',');

export const listingParsers = {
  brand: csv.withDefault([]),
  gender: csv.withDefault([]),
  family: csv.withDefault([]),
  note: csv.withDefault([]),
  concentration: csv.withDefault([]),
  type: csv.withDefault([]),
  minPrice: parseAsInteger,
  maxPrice: parseAsInteger,
  inStock: parseAsBoolean.withDefault(false),
  sort: parseAsStringLiteral(SORT_VALUES),
  page: parseAsInteger.withDefault(1),
  q: parseAsString.withDefault(''),
};

export type ListingParams = inferParserType<typeof listingParsers>;

/** Multi-value filter keys, in display order. */
export const FILTER_KEYS = ['brand', 'gender', 'family', 'note', 'concentration', 'type'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const loadListingParams = createLoader(listingParsers);
export const serializeListingParams = createSerializer(listingParsers);

/** Price presets for the price filter (whole VND). */
export const PRICE_RANGES = [
  { key: 'under2m', min: null, max: 2_000_000 },
  { key: 'from2to4m', min: 2_000_000, max: 4_000_000 },
  { key: 'from4to6m', min: 4_000_000, max: 6_000_000 },
  { key: 'over6m', min: 6_000_000, max: null },
] as const;

export function toListingFilters(params: ListingParams): ListingFilters {
  return {
    brands: params.brand,
    genders: params.gender as ListingFilters['genders'],
    families: params.family,
    notes: params.note,
    concentrations: params.concentration as ListingFilters['concentrations'],
    types: params.type as ListingFilters['types'],
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    inStock: params.inStock,
  };
}

/** Query string for a page of the same listing (filters and sort kept). */
export type ListingParamOverrides = { [K in keyof ListingParams]?: ListingParams[K] | null };

export function listingQueryString(params: ListingParams, overrides: ListingParamOverrides = {}) {
  const merged = { ...params, ...overrides };
  return serializeListingParams({
    ...merged,
    page: merged.page && merged.page > 1 ? merged.page : null,
    q: merged.q || null,
    inStock: merged.inStock || null,
  });
}
