'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent } from 'react';

import { applyCoupon, removeCoupon } from '@/actions/cart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Locale } from '@/i18n/routing';
import { couponRejectionMessage } from '@/lib/cart-messages';
import type { CartCouponView, CartView } from '@/server/modules/cart';

import { useCartErrorMessage } from './use-cart-error';

/**
 * Promo code field (§8.3). The server validates the code against the current cart and
 * explains a refusal precisely (unknown, expired, minimum subtotal, …).
 */
export function CouponInput({
  coupon,
  onView,
}: {
  coupon: CartCouponView | null;
  onView?: (view: CartView) => void;
}) {
  const t = useTranslations('cart.coupon');
  const locale = useLocale() as Locale;
  const errorMessage = useCartErrorMessage();
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) return;
    startTransition(async () => {
      const result = await applyCoupon({ code, locale });
      if (result.ok) {
        setCode('');
        setError(null);
        onView?.(result.data);
      } else {
        setError(errorMessage(result));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeCoupon({ locale });
      if (result.ok) onView?.(result.data);
      else setError(errorMessage(result));
    });
  }

  if (coupon) {
    const rejection = coupon.rejection ? couponRejectionMessage(coupon.rejection) : null;
    return (
      <div className="flex flex-col gap-2" data-testid="coupon-applied">
        <div className="border-line-200 flex items-center justify-between gap-2 border bg-white py-1 pr-1 pl-3">
          <p className="text-small min-w-0 break-words" role="status">
            {coupon.applied
              ? coupon.freeShipping
                ? t('freeShipping', { code: coupon.code })
                : t('applied', { code: coupon.code })
              : t('notApplied', { code: coupon.code })}
          </p>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={t('remove', { code: coupon.code })}
            className="hover:bg-sand-100 inline-flex size-11 shrink-0 items-center justify-center disabled:opacity-50 [&_svg]:size-4"
          >
            <X aria-hidden />
          </button>
        </div>
        {rejection && (
          <p className="text-small text-warning">{t(rejection.key, rejection.values)}</p>
        )}
        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <Label htmlFor={inputId}>{t('label')}</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          name="code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 uppercase"
        />
        <Button type="submit" variant="secondary" loading={pending} className="shrink-0">
          {t('apply')}
        </Button>
      </div>
      <p id={errorId} className="text-small text-danger empty:hidden" role="alert">
        {error}
      </p>
    </form>
  );
}
