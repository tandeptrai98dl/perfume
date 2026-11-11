'use client';

import { useTranslations } from 'next-intl';

import type { ListingFacets } from '@/server/modules/catalog';

import { FilterPanel, type HiddenFilters } from './filter-panel';

/** Desktop filters (≥ 1024px). */
export function FilterSidebar({
  facets,
  hidden,
}: {
  facets: ListingFacets;
  hidden?: HiddenFilters;
}) {
  const t = useTranslations('listing.filters');
  return (
    <aside aria-labelledby="filters-heading" className="hidden lg:block">
      <h2 id="filters-heading" className="eyebrow text-taupe-600">
        {t('title')}
      </h2>
      <FilterPanel facets={facets} hidden={hidden} idPrefix="sidebar" />
    </aside>
  );
}
