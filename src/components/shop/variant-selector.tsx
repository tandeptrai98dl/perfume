'use client';

import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useEffect, useId } from 'react';

import { Price } from '@/components/ui/price';
import { cn } from '@/lib/utils';
import type { ProductVariantDetail, VariantOffer } from '@/server/modules/catalog';

import { StockIndicator } from './stock-indicator';
import { useSetSelectedSku } from './variant-store';

export type SelectableVariant = Pick<
  ProductVariantDetail,
  'id' | 'sku' | 'sizeMl' | 'variantType' | 'isDefault'
> & {
  offer: VariantOffer;
};

/**
 * Size chips with live price and stock (§10.2). Selecting a variant updates price, image and
 * stock without a reload and writes `?v=<sku>` (shallow: no server round trip).
 */
export function VariantSelector({ variants }: { variants: SelectableVariant[] }) {
  const t = useTranslations();
  const labelId = useId();
  const setSelectedSku = useSetSelectedSku();
  const [sku, setSku] = useQueryState(
    'v',
    parseAsString.withOptions({ history: 'replace', shallow: true, scroll: false }),
  );

  const fallback = variants.find((variant) => variant.isDefault) ?? variants[0];
  const selected = variants.find((variant) => variant.sku === sku) ?? fallback;
  const selectedSku = selected?.sku ?? null;

  useEffect(() => {
    setSelectedSku(selectedSku);
  }, [selectedSku, setSelectedSku]);

  if (!selected) return <p className="text-taupe-600">{t('product.noVariants')}</p>;

  const label = (variant: SelectableVariant) =>
    t(`catalog.variantLabel.${variant.variantType}`, { size: variant.sizeMl });

  return (
    <div className="flex flex-col gap-6">
      <div aria-live="polite" className="flex flex-col gap-2" data-testid="variant-offer">
        <Price
          amount={selected.offer.price}
          compareAtAmount={selected.offer.compareAtPrice}
          className="text-h3"
        />
        <StockIndicator state={selected.offer.stockState} available={selected.offer.available} />
      </div>

      {variants.length > 0 && (
        <div className="flex flex-col gap-3">
          <p id={labelId} className="eyebrow text-taupe-600">
            {t('product.size')}
          </p>
          <RadioGroupPrimitive.Root
            aria-labelledby={labelId}
            value={selected.sku}
            onValueChange={(value) => void setSku(value)}
            className="flex flex-wrap gap-2"
          >
            {variants.map((variant) => {
              const soldOut = variant.offer.stockState === 'out_of_stock';
              return (
                <RadioGroupPrimitive.Item
                  key={variant.id}
                  value={variant.sku}
                  aria-label={
                    soldOut
                      ? t('product.unavailableOption', { label: label(variant) })
                      : label(variant)
                  }
                  className={cn(
                    'text-small inline-flex min-h-11 min-w-16 items-center justify-center border px-4',
                    'border-line-200 hover:border-ink-950 transition-colors duration-(--duration-hover)',
                    'data-[state=checked]:border-ink-950 data-[state=checked]:bg-ink-950 data-[state=checked]:text-ivory-50',
                    soldOut && 'text-taupe-600 line-through decoration-1',
                  )}
                >
                  {label(variant)}
                </RadioGroupPrimitive.Item>
              );
            })}
          </RadioGroupPrimitive.Root>
          <p className="text-small text-taupe-600">{t('product.sku', { sku: selected.sku })}</p>
        </div>
      )}
    </div>
  );
}
