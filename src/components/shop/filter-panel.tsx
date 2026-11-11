'use client';

import { useTranslations } from 'next-intl';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FILTER_KEYS, PRICE_RANGES, type FilterKey } from '@/lib/listing-params';
import { cn } from '@/lib/utils';
import type { FacetOption, ListingFacets } from '@/server/modules/catalog';

import { useListingParams } from './use-listing-params';

const FACET_OF: Record<FilterKey, Exclude<keyof ListingFacets, 'inStock'>> = {
  brand: 'brands',
  gender: 'genders',
  family: 'families',
  note: 'notes',
  concentration: 'concentrations',
  type: 'types',
};

/** Facets hidden on a scoped listing (e.g. the brand filter on a brand page). */
export type HiddenFilters = Partial<Record<FilterKey, boolean>>;

/**
 * Filter controls shared by the desktop sidebar and the mobile sheet. Options come with
 * disjunctive counts from the server; selected values stay visible even at zero results.
 */
export function FilterPanel({
  facets,
  hidden = {},
  idPrefix,
  className,
}: {
  facets: ListingFacets;
  hidden?: HiddenFilters;
  idPrefix: string;
  className?: string;
}) {
  const t = useTranslations();
  const { params, setParams, isPending } = useListingParams();

  const labelFor = (key: FilterKey, option: FacetOption) => {
    if (key === 'gender') return t(`catalog.gender.${option.value as 'male'}`);
    if (key === 'concentration') return t(`catalog.concentration.${option.value as 'edp'}`);
    if (key === 'type') return t(`catalog.variantType.${option.value as 'travel'}`);
    return option.label;
  };

  const sections = FILTER_KEYS.filter((key) => !hidden[key]).map((key) => {
    const selected = params[key];
    const options = [...facets[FACET_OF[key]]];
    for (const value of selected) {
      if (!options.some((option) => option.value === value)) {
        options.push({ value, label: value, count: 0 });
      }
    }
    return { key, options, selected };
  });
  const visible = sections.filter((section) => section.options.length > 0);

  const toggle = (key: FilterKey, value: string, checked: boolean) => {
    const current = params[key];
    const next = checked ? [...current, value] : current.filter((item) => item !== value);
    void setParams({ [key]: next.length > 0 ? next : null, page: null });
  };

  const priceValue =
    PRICE_RANGES.find((range) => range.min === params.minPrice && range.max === params.maxPrice)
      ?.key ?? (params.minPrice !== null || params.maxPrice !== null ? 'custom' : 'any');

  const defaultOpen = [
    ...visible.slice(0, 3).map((section) => section.key),
    ...visible.filter((section) => section.selected.length > 0).map((section) => section.key),
    'price',
  ];

  return (
    <div className={cn('flex flex-col', className)} aria-busy={isPending || undefined}>
      <p role="status" aria-live="polite" className="text-small min-h-6 text-taupe-600">
        {isPending ? t('listing.updating') : ''}
      </p>
      <Accordion type="multiple" defaultValue={[...new Set(defaultOpen)]}>
        {visible.map(({ key, options, selected }) => (
          <AccordionItem key={key} value={key}>
            <AccordionTrigger>{t(`listing.filters.${key}`)}</AccordionTrigger>
            <AccordionContent className="text-ink-950">
              <fieldset>
                <legend className="sr-only">{t(`listing.filters.${key}`)}</legend>
                <ul className={cn('flex flex-col', key === 'note' && 'max-h-72 overflow-y-auto')}>
                  {options.map((option) => {
                    const id = `${idPrefix}-${key}-${option.value}`;
                    const checked = selected.includes(option.value);
                    return (
                      <li key={option.value} className="flex min-h-11 items-center gap-3">
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(value) => toggle(key, option.value, value === true)}
                        />
                        <Label
                          htmlFor={id}
                          className="flex flex-1 cursor-pointer justify-between gap-2 py-2 font-normal"
                        >
                          <span>{labelFor(key, option)}</span>
                          <span className="text-taupe-600 tabular-nums">{option.count}</span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </AccordionContent>
          </AccordionItem>
        ))}

        <AccordionItem value="price">
          <AccordionTrigger>{t('listing.filters.price')}</AccordionTrigger>
          <AccordionContent className="text-ink-950">
            <RadioGroup
              aria-label={t('listing.filters.price')}
              value={priceValue}
              onValueChange={(value) => {
                const range = PRICE_RANGES.find((item) => item.key === value);
                void setParams({
                  minPrice: range?.min ?? null,
                  maxPrice: range?.max ?? null,
                  page: null,
                });
              }}
              className="gap-0"
            >
              {[{ key: 'any' as const }, ...PRICE_RANGES].map((range) => {
                const id = `${idPrefix}-price-${range.key}`;
                return (
                  <div key={range.key} className="flex min-h-11 items-center gap-3">
                    <RadioGroupItem id={id} value={range.key} />
                    <Label htmlFor={id} className="flex-1 cursor-pointer py-2 font-normal">
                      {range.key === 'any'
                        ? t('listing.filters.anyPrice')
                        : t(`listing.filters.priceRange.${range.key}`)}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="availability">
          <AccordionTrigger>{t('listing.filters.availability')}</AccordionTrigger>
          <AccordionContent className="text-ink-950">
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={`${idPrefix}-in-stock`}
                checked={params.inStock}
                onCheckedChange={(value) =>
                  void setParams({ inStock: value === true ? true : null, page: null })
                }
              />
              <Label
                htmlFor={`${idPrefix}-in-stock`}
                className="flex flex-1 cursor-pointer justify-between gap-2 py-2 font-normal"
              >
                <span>{t('listing.filters.inStock')}</span>
                <span className="text-taupe-600 tabular-nums">{facets.inStock}</span>
              </Label>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
