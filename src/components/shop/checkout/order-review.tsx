'use client';

import { Gift, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { ProductImage } from '@/components/shop/product-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { useCheckoutErrorMessage } from './field-message';
import type { CheckoutQuote } from './types';

/**
 * Order summary beside the form (§10.4): lines, coupon, gift options, totals and, for COD
 * orders that need one, the deposit split. Figures always come from the server quote.
 */
export function OrderReview({
  quote,
  updating,
  coupon,
  showDeposit,
}: {
  quote: CheckoutQuote;
  updating: boolean;
  coupon: CouponControls;
  showDeposit: boolean;
}) {
  const t = useTranslations('checkout.review');
  const format = useFormatter();
  const vnd = (amount: number) => format.number(amount, 'vnd');
  const { totals, gift } = quote;
  const count = quote.lines.reduce((sum, line) => sum + line.quantity, 0);
  const appliedCode = quote.coupon?.applied ? quote.coupon.code : null;

  return (
    <section aria-labelledby="order-review-title" className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="order-review-title" className="text-h3">
          {t('title')}
        </h2>
        <Link href="/cart" className="text-small text-gold-700 underline-offset-4 hover:underline">
          {t('editCart')}
        </Link>
      </div>
      <p className="text-small text-taupe-600">{t('items', { count })}</p>

      <ul className="flex flex-col gap-4" data-testid="order-review-lines">
        {quote.lines.map((line) => (
          <li key={line.variantId} className="flex gap-3">
            <div className="w-16 shrink-0">
              <ProductImage
                image={
                  line.imageStorageKey
                    ? {
                        id: line.variantId,
                        storageKey: line.imageStorageKey,
                        url: line.imageUrl ?? '',
                        width: null,
                        height: null,
                        blurDataUrl: null,
                        alt: '',
                        variantId: null,
                      }
                    : null
                }
                alt={line.productName}
                sizes="64px"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="eyebrow text-taupe-600">{line.brandName}</p>
              <p className="truncate font-medium">{line.productName}</p>
              <p className="text-small text-taupe-600">
                {line.variantLabel} · {t('quantity', { count: line.quantity })}
              </p>
            </div>
            <p className="text-small shrink-0 text-right tabular-nums">
              {vnd(line.unitPrice * line.quantity)}
            </p>
          </li>
        ))}
      </ul>

      <CouponField controls={coupon} appliedCode={appliedCode} />

      {gift.wrap && (
        <div className="bg-sand-100 text-small flex gap-3 p-3">
          <Gift aria-hidden className="text-gold-700 mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t('giftWrap')}</p>
            {gift.message && (
              <p className="break-words">{t('giftMessage', { message: gift.message })}</p>
            )}
            {gift.hidePrices && <p className="text-taupe-600">{t('hidePrices')}</p>}
          </div>
        </div>
      )}

      <dl className="border-line-200 flex flex-col gap-2 border-t pt-4" aria-busy={updating}>
        <Row label={t('subtotal')} value={vnd(totals.subtotal)} />
        {totals.discountTotal > 0 && (
          <Row
            label={appliedCode ? t('discountWithCode', { code: appliedCode }) : t('discount')}
            value={`−${vnd(totals.discountTotal)}`}
          />
        )}
        <Row
          label={t('shipping')}
          value={
            totals.shippingFee === null
              ? t('shippingLater')
              : totals.shippingFee === 0
                ? t('shippingFree')
                : vnd(totals.shippingFee)
          }
          muted={totals.shippingFee === null}
        />
        {totals.giftWrapFee > 0 && <Row label={t('giftWrap')} value={vnd(totals.giftWrapFee)} />}
        <div className="border-line-200 mt-2 flex items-baseline justify-between gap-4 border-t pt-3">
          <dt className="font-medium">{t('total')}</dt>
          <dd className="text-h3 tabular-nums" data-testid="order-total">
            {vnd(totals.total)}
          </dd>
        </div>
        {showDeposit && totals.depositRequired > 0 && (
          <>
            <Row label={t('depositNow')} value={vnd(totals.depositRequired)} strong />
            <Row
              label={t('balanceOnDelivery')}
              value={vnd(totals.total - totals.depositRequired)}
            />
          </>
        )}
      </dl>
      {/* Screen readers hear the new total after each change (address, delivery, coupon). */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {updating ? t('updating') : t('totalAnnouncement', { total: vnd(totals.total) })}
      </p>
    </section>
  );
}

function Row({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: ReactNode;
  value: ReactNode;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="text-small flex items-baseline justify-between gap-4">
      <dt className={cn(strong ? 'font-medium' : 'text-taupe-600')}>{label}</dt>
      <dd
        className={cn(
          'text-right tabular-nums',
          muted && 'text-taupe-600',
          strong && 'font-medium',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export type CouponControls = {
  pending: boolean;
  /** Translation code of the last rejection, if any. */
  error: string | null;
  apply: (code: string) => void;
  remove: () => void;
};

function CouponField({
  controls,
  appliedCode,
}: {
  controls: CouponControls;
  appliedCode: string | null;
}) {
  const t = useTranslations('checkout.coupon');
  const message = useCheckoutErrorMessage();
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const errorId = useId();

  if (appliedCode) {
    return (
      <div className="border-line-200 flex items-center justify-between gap-3 border px-3 py-2">
        <p className="text-small" role="status">
          {t('applied', { code: appliedCode })}
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            controls.remove();
          }}
          aria-label={t('remove', { code: appliedCode })}
          className="hover:bg-sand-100 inline-flex size-11 items-center justify-center"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    );
  }

  const submit = () => {
    if (draft.trim()) controls.apply(draft.trim());
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{t('label')}</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Inside the checkout form: Enter applies the code instead of placing the order.
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!controls.error || undefined}
          aria-describedby={controls.error ? errorId : undefined}
          className="uppercase"
        />
        <Button type="button" variant="secondary" onClick={submit} loading={controls.pending}>
          {t('apply')}
        </Button>
      </div>
      {controls.error && (
        <p id={errorId} role="alert" className="text-small text-danger">
          {message(controls.error)}
        </p>
      )}
    </div>
  );
}
