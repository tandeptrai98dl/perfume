import { useFormatter, useTranslations } from 'next-intl';

import { discountPercent } from '@/lib/pricing';
import { cn } from '@/lib/utils';

export type PriceProps = {
  /** Selling price in whole VND. */
  amount: number;
  /** Original price in whole VND, shown struck through when higher than `amount`. */
  compareAtAmount?: number | null;
  /** "From 2.900.000 ₫" for products with several sizes. */
  from?: boolean;
  showDiscount?: boolean;
  className?: string;
};

/** Locale-aware VND price (§8.1). Uses tabular figures so prices line up. */
export function Price({
  amount,
  compareAtAmount,
  from = false,
  showDiscount = true,
  className,
}: PriceProps) {
  const format = useFormatter();
  const t = useTranslations('ui.price');
  const percent = discountPercent(amount, compareAtAmount);
  const formatted = format.number(amount, 'vnd');

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2 tabular-nums', className)}>
      <span className="font-medium">
        {percent !== null && <span className="sr-only">{t('salePrice')} </span>}
        {from ? t('from', { price: formatted }) : formatted}
      </span>
      {percent !== null && (
        <>
          <s className="text-small text-taupe-600">
            <span className="sr-only">{t('originalPrice')} </span>
            {format.number(compareAtAmount!, 'vnd')}
          </s>
          {showDiscount && (
            <span className="text-small text-gold-700">{t('percentOff', { percent })}</span>
          )}
        </>
      )}
    </span>
  );
}
