'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { removeFromCart, updateCartItem } from '@/actions/cart';
import { Price } from '@/components/ui/price';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import type { CartActionResult, CartLineView, CartView } from '@/server/modules/cart';

import { useMiniCart } from './cart-store';
import { ProductImage } from './product-image';
import { useCartErrorMessage } from './use-cart-error';

/**
 * One cart line (§8.3): photo, brand, name, size, live price, quantity stepper (debounced
 * commit, bounded by stock and the per-line limit), remove, and flags for price changes and
 * lines that can no longer be bought as they are.
 */
export function CartLineItem({
  line,
  compact = false,
  onView,
}: {
  line: CartLineView;
  compact?: boolean;
  /** Receives the fresh cart after a change (mini-cart keeps its own copy). */
  onView?: (view: CartView) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const errorMessage = useCartErrorMessage();
  const setCount = useMiniCart((state) => state.setCount);
  const [pending, startTransition] = useTransition();

  const variantLabel = t(
    `catalog.variantLabel.${line.variantType === 'decant' ? 'full_size' : line.variantType}`,
    { size: line.sizeMl },
  );
  const name = `${line.productName} – ${variantLabel}`;

  function handle(result: CartActionResult<CartView>, requested?: number) {
    if (!result.ok) {
      toast.error(errorMessage(result));
      return;
    }
    setCount(result.data.itemCount);
    onView?.(result.data);
    const updated = result.data.lines.find((l) => l.itemId === line.itemId);
    if (updated && requested !== undefined && updated.quantity < requested) {
      toast(t('cart.line.capped', { max: updated.quantity }));
    }
  }

  function commit(quantity: number) {
    startTransition(async () => {
      handle(await updateCartItem({ itemId: line.itemId, quantity, locale }), quantity);
    });
  }

  function remove() {
    startTransition(async () => {
      handle(await removeFromCart({ itemId: line.itemId, locale }));
    });
  }

  const issues: string[] = [];
  if (line.issues.unavailable) issues.push(t('cart.line.unavailable'));
  else if (line.issues.overStock) issues.push(t('cart.line.overStock', { max: line.maxQuantity }));
  if (line.issues.priceChanged && !line.issues.unavailable)
    issues.push(t('cart.line.priceChanged', { from: format.number(line.priceWhenAdded, 'vnd') }));

  const href = line.productSlug
    ? ({ pathname: '/products/[slug]', params: { slug: line.productSlug } } as const)
    : null;
  const image = line.imageStorageKey
    ? {
        id: line.itemId,
        storageKey: line.imageStorageKey,
        url: line.imageUrl ?? '',
        width: null,
        height: null,
        blurDataUrl: null,
        alt: '',
        variantId: null,
      }
    : null;

  return (
    <li
      className={cn(
        'border-line-200 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-b py-6 sm:grid-cols-[6rem_minmax(0,1fr)]',
        compact && 'grid-cols-[4rem_minmax(0,1fr)] py-4 sm:grid-cols-[4rem_minmax(0,1fr)]',
        pending && 'opacity-70',
      )}
      aria-busy={pending || undefined}
      data-testid="cart-line"
    >
      <ProductImage image={image} alt={line.productName} sizes="96px" />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="eyebrow text-gold-700">{line.brandName}</p>
            {href ? (
              <Link href={href} className="text-body break-words hover:underline">
                {line.productName}
              </Link>
            ) : (
              <p className="text-body break-words">{line.productName}</p>
            )}
            <p className="text-small text-taupe-600">{variantLabel}</p>
          </div>
          <div className="flex flex-col items-end text-right">
            <Price amount={line.lineTotal} className="text-body" showDiscount={false} />
            {line.quantity > 1 && (
              <span className="text-small text-taupe-600 tabular-nums">
                {t('cart.line.unitPrice', { price: format.number(line.unitPrice, 'vnd') })}
              </span>
            )}
          </div>
        </div>

        {issues.length > 0 && (
          <ul className="text-small flex flex-col gap-1" data-testid="cart-line-issues">
            {issues.map((issue) => (
              <li
                key={issue}
                className={
                  line.issues.unavailable || line.issues.overStock ? 'text-danger' : 'text-warning'
                }
              >
                {issue}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {!line.issues.unavailable && (
            <QuantityStepper
              value={line.quantity}
              max={Math.max(line.maxQuantity, 1)}
              onCommit={commit}
              label={t('cart.line.quantityFor', { name })}
              disabled={pending}
            />
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={t('cart.line.removeLabel', { name })}
            className="text-small hover:text-ink-950 inline-flex min-h-11 items-center text-taupe-600 underline-offset-4 hover:underline disabled:opacity-50"
          >
            {t('cart.line.remove')}
          </button>
        </div>
      </div>
    </li>
  );
}
