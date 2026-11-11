'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { addToCart } from '@/actions/cart';
import { Button } from '@/components/ui/button';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import type { Locale } from '@/i18n/routing';
import type { VariantOffer } from '@/server/modules/catalog';

import { useMiniCart } from './cart-store';
import { useCartErrorMessage } from './use-cart-error';
import { useSelectedSku } from './variant-store';

export type AddToCartVariant = Pick<VariantOffer, 'variantId' | 'sku' | 'available' | 'stockState'>;

/**
 * Add to cart for the selected variant (§10.2, §10.3). Out of stock shows a disabled
 * "Out of stock" button; the quantity is bounded by stock and the per-line limit (the server
 * caps again). After adding: toast, header count and the mini-cart opens.
 */
export function AddToCart({
  variants,
  maxQuantityPerLine,
}: {
  variants: AddToCartVariant[];
  maxQuantityPerLine: number;
}) {
  const t = useTranslations('cart');
  const locale = useLocale() as Locale;
  const errorMessage = useCartErrorMessage();
  const selectedSku = useSelectedSku();
  const setOpen = useMiniCart((state) => state.setOpen);
  const setCount = useMiniCart((state) => state.setCount);
  const [quantity, setQuantity] = useState(1);
  const [pending, startTransition] = useTransition();

  const variant = variants.find((v) => v.sku === selectedSku) ?? variants[0];
  if (!variant) return null;
  const max = Math.max(1, Math.min(variant.available, maxQuantityPerLine));
  const soldOut = variant.stockState === 'out_of_stock' || variant.available <= 0;
  const amount = Math.min(quantity, max);

  if (soldOut) {
    return (
      <Button size="lg" className="w-full" disabled data-testid="add-to-cart">
        {t('outOfStock')}
      </Button>
    );
  }

  function add() {
    if (!variant) return;
    startTransition(async () => {
      const result = await addToCart({ variantId: variant.variantId, quantity: amount, locale });
      if (!result.ok) {
        toast.error(errorMessage(result));
        return;
      }
      setCount(result.data.itemCount);
      setQuantity(1);
      toast.success(
        result.data.capped && result.data.max !== null
          ? t('addedCapped', { max: result.data.max })
          : t('added'),
      );
      setOpen(true);
    });
  }

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <QuantityStepper
        value={amount}
        max={max}
        onCommit={setQuantity}
        debounceMs={0}
        label={t('quantity')}
        disabled={pending}
      />
      <Button
        size="lg"
        className="min-w-0 flex-1"
        onClick={add}
        loading={pending}
        data-testid="add-to-cart"
      >
        {t('add')}
      </Button>
    </div>
  );
}
