import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ActiveFilterChips, type FilterChip } from '@/components/shop/active-filter-chips';
import { FilterSheet } from '@/components/shop/filter-sheet';
import { FilterSidebar } from '@/components/shop/filter-sidebar';
import type { HiddenFilters } from '@/components/shop/filter-panel';
import { NoResults } from '@/components/shop/no-results';
import { ProductGrid } from '@/components/shop/product-card';
import { ResultCount } from '@/components/shop/result-count';
import { SortSelect } from '@/components/shop/sort-select';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  FILTER_KEYS,
  PRICE_RANGES,
  listingQueryString,
  loadListingParams,
  toListingFilters,
  type ListingParamOverrides,
  type ListingParams,
} from '@/lib/listing-params';
import { getListing } from '@/server/catalog-cache';
import {
  countActiveFilters,
  listingFiltersSchema,
  type ListingFacets,
  type ListingResult,
  type ListingScope,
  type ListingSort,
} from '@/server/modules/catalog';

import { alternates, NOINDEX, type PageHref } from './seo';

export type ListingHref = Extract<
  PageHref,
  | '/perfumes'
  | '/search'
  | { pathname: '/brands/[slug]' }
  | { pathname: '/categories/[slug]' }
  | { pathname: '/collections/[slug]' }
  | { pathname: '/scent-families/[slug]' }
>;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FACET_OF = {
  brand: 'brands',
  gender: 'genders',
  family: 'families',
  note: 'notes',
  concentration: 'concentrations',
  type: 'types',
} as const satisfies Record<(typeof FILTER_KEYS)[number], keyof ListingFacets>;

export async function readListingParams(searchParams: SearchParams): Promise<ListingParams> {
  return loadListingParams(await searchParams);
}

/** Canonical (no filters, own page number) and robots for a listing (§13.1). */
export function listingSeo(
  locale: Locale,
  hrefs: Partial<Record<Locale, ListingHref>>,
  params: ListingParams,
): Pick<Metadata, 'alternates' | 'robots'> {
  const page = params.page > 1 ? `?page=${params.page}` : '';
  const filters = listingFiltersSchema.parse(toListingFilters(params));
  const noindex = countActiveFilters(filters) >= 2 || Boolean(params.sort) || Boolean(params.q);
  return {
    alternates: alternates(locale, hrefs, page),
    ...(noindex ? { robots: NOINDEX } : {}),
  };
}

/**
 * Filters, sort, chips, grid and pagination for any product listing. Renders at request time
 * (search params) inside the caller's Suspense boundary; data comes from the catalogue cache.
 */
export async function ListingResults({
  locale,
  scope,
  href,
  params,
  defaultSort = 'featured',
  hidden,
  searchMode = false,
  result: preloaded,
}: {
  locale: Locale;
  scope: ListingScope;
  href: ListingHref;
  params: ListingParams;
  defaultSort?: ListingSort;
  hidden?: HiddenFilters;
  searchMode?: boolean;
  result?: ListingResult;
}) {
  const t = await getTranslations({ locale });
  const result =
    preloaded ??
    (await getListing({
      locale,
      scope,
      filters: toListingFilters(params),
      q: params.q,
      sort: params.sort ?? defaultSort,
      page: params.page,
    }));

  const basePath = getPathname({ locale, href });
  const urlWith = (overrides: ListingParamOverrides) =>
    `${basePath}${listingQueryString(params, { ...overrides, page: null })}`;

  const chips: FilterChip[] = [];
  for (const key of FILTER_KEYS) {
    for (const value of params[key]) {
      const option = result.facets[FACET_OF[key]].find((item) => item.value === value);
      let label = option?.label ?? value;
      if (key === 'gender') label = t(`catalog.gender.${value as 'male'}`);
      if (key === 'concentration') label = t(`catalog.concentration.${value as 'edp'}`);
      if (key === 'type') label = t(`catalog.variantType.${value as 'travel'}`);
      chips.push({
        key: `${key}-${value}`,
        label,
        href: urlWith({ [key]: params[key].filter((item) => item !== value) }),
      });
    }
  }
  if (params.minPrice !== null || params.maxPrice !== null) {
    const preset = PRICE_RANGES.find(
      (range) => range.min === params.minPrice && range.max === params.maxPrice,
    );
    const range = preset
      ? t(`listing.filters.priceRange.${preset.key}`)
      : `${params.minPrice ?? 0} – ${params.maxPrice ?? '∞'}`;
    chips.push({
      key: 'price',
      label: t('listing.filters.priceChip', { range }),
      href: urlWith({ minPrice: null, maxPrice: null }),
    });
  }
  if (params.inStock) {
    chips.push({
      key: 'inStock',
      label: t('listing.filters.inStockChip'),
      href: urlWith({ inStock: false }),
    });
  }
  const clearHref = `${basePath}${listingQueryString(
    { ...params, brand: [], gender: [], family: [], note: [], concentration: [], type: [] },
    { minPrice: null, maxPrice: null, inStock: false, page: null },
  )}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="border-line-200 flex flex-wrap items-center justify-between gap-4 border-y py-3">
        <div className="flex items-center gap-4">
          <FilterSheet
            facets={result.facets}
            hidden={hidden}
            total={result.total}
            activeCount={chips.length}
          />
          <ResultCount count={result.total} />
        </div>
        <SortSelect defaultSort={defaultSort} withRelevance={searchMode} />
      </div>
      <ActiveFilterChips chips={chips} clearHref={clearHref} />
      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <FilterSidebar facets={result.facets} hidden={hidden} />
        <div className="flex flex-col gap-12">
          {result.items.length > 0 ? (
            <>
              <ProductGrid products={result.items} priorityCount={4} className="lg:grid-cols-3" />
              <Pagination
                page={result.page}
                totalPages={result.totalPages}
                hrefFor={(page) => `${basePath}${listingQueryString(params, { page })}`}
              />
            </>
          ) : (
            <NoResults
              title={
                searchMode && params.q
                  ? t('search.noResults.title', { query: params.q })
                  : t('listing.noResults.title')
              }
              description={
                searchMode && params.q
                  ? t('search.noResults.description')
                  : t('listing.noResults.description')
              }
              clearHref={chips.length > 0 ? clearHref : undefined}
              clearLabel={t('listing.noResults.clearFilters')}
              browseAllLabel={t('listing.noResults.browseAll')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ListingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Skeleton className="hidden h-96 lg:block" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="aspect-[4/5] w-full" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
