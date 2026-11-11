import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { VariantOffer } from '@/server/modules/catalog';

/** In stock / Only X left / Out of stock (§10.2). Colour is never the only signal. */
export function StockIndicator({
  state,
  available,
  className,
}: {
  state: VariantOffer['stockState'];
  available: number;
  className?: string;
}) {
  const t = useTranslations('product.stock');
  const tone = {
    in_stock: 'text-success bg-success',
    low_stock: 'text-warning bg-warning',
    out_of_stock: 'text-taupe-600 bg-taupe-600',
  }[state];
  const [text, dot] = tone.split(' ');
  return (
    <p
      className={cn('text-small inline-flex items-center gap-2', text, className)}
      data-testid="stock-indicator"
    >
      <span aria-hidden className={cn('size-2 rounded-full', dot)} />
      {state === 'in_stock' && t('inStock')}
      {state === 'low_stock' && t('lowStock', { count: available })}
      {state === 'out_of_stock' && t('outOfStock')}
    </p>
  );
}
