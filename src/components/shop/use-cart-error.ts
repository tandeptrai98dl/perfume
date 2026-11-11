'use client';

import { useTranslations } from 'next-intl';

import { couponRejectionMessage } from '@/lib/cart-messages';
import type { CartActionResult } from '@/server/modules/cart';

type Failure = Extract<CartActionResult<unknown>, { ok: false }>;

/** Localized message for a failed cart action (toasts and inline errors). */
export function useCartErrorMessage(): (failure: Failure) => string {
  const t = useTranslations('cart');
  return (failure) => {
    if (failure.error === 'coupon' && failure.coupon) {
      const { key, values } = couponRejectionMessage(failure.coupon);
      return t(`coupon.${key}`, values);
    }
    if (failure.error === 'coupon') return t('coupon.errors.not_found');
    if (failure.error === 'limit_reached')
      return t('errors.limit_reached', { max: failure.max ?? 0 });
    return t(`errors.${failure.error}`);
  };
}
