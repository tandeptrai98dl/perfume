'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { ListingFacets } from '@/server/modules/catalog';

import { FilterPanel, type HiddenFilters } from './filter-panel';
import { useListingParams } from './use-listing-params';

/** Mobile filters (< 1024px): changes apply live; the footer shows the updated count. */
export function FilterSheet({
  facets,
  hidden,
  total,
  activeCount,
}: {
  facets: ListingFacets;
  hidden?: HiddenFilters;
  total: number;
  activeCount: number;
}) {
  const t = useTranslations('listing');
  const [open, setOpen] = useState(false);
  const { setParams, isPending } = useListingParams();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm" className="lg:hidden">
          <SlidersHorizontal aria-hidden />
          {activeCount > 0 ? t('filters.openWithCount', { count: activeCount }) : t('filters.open')}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 p-0">
        <SheetHeader className="border-line-200 border-b p-6 pr-14">
          <SheetTitle>{t('filters.title')}</SheetTitle>
          <SheetDescription>{t('resultCount', { count: total })}</SheetDescription>
        </SheetHeader>
        <FilterPanel facets={facets} hidden={hidden} idPrefix="sheet" className="flex-1 px-6" />
        <div className="border-line-200 bg-ivory-50 sticky bottom-0 flex gap-3 border-t p-4">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() =>
              void setParams({
                brand: null,
                gender: null,
                family: null,
                note: null,
                concentration: null,
                type: null,
                minPrice: null,
                maxPrice: null,
                inStock: null,
                page: null,
              })
            }
          >
            {t('filters.clearAll')}
          </Button>
          <Button className="flex-1" loading={isPending} onClick={() => setOpen(false)}>
            {t('filters.showResults', { count: total })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
