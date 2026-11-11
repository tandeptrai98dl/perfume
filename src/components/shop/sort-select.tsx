'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SORT_VALUES } from '@/lib/listing-params';
import type { ListingSort } from '@/server/modules/catalog';

import { useListingParams } from './use-listing-params';

/** Sort order in `?sort=` (the default sort is left out of the URL). */
export function SortSelect({
  defaultSort,
  withRelevance = false,
}: {
  defaultSort: ListingSort;
  withRelevance?: boolean;
}) {
  const t = useTranslations('listing.sort');
  const labelId = useId();
  const { params, setParams } = useListingParams();
  const options = SORT_VALUES.filter((value) => withRelevance || value !== 'relevance');
  const value = params.sort && options.includes(params.sort) ? params.sort : defaultSort;

  return (
    <div className="flex items-center gap-3">
      <span id={labelId} className="text-small whitespace-nowrap text-taupe-600">
        {t('label')}
      </span>
      <Select
        value={value}
        onValueChange={(next) =>
          void setParams({ sort: next === defaultSort ? null : (next as ListingSort), page: null })
        }
      >
        <SelectTrigger aria-labelledby={labelId} className="min-w-48" data-testid="sort-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
