import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { CartView } from '@/server/modules/cart';

import { FreeShippingProgress } from './free-shipping-progress';

function Row({ label, value, testId }: { label: ReactNode; value: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-taupe-600">{label}</dt>
      <dd className="text-right tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Totals from `priceCart` (§3.4). Shipping is unknown before an address, so it reads
 * "Calculated at checkout"; a free-shipping coupon says so instead.
 */
export function CartSummary({
  view,
  showFreeShipping = true,
  className,
  children,
}: {
  view: CartView;
  showFreeShipping?: boolean;
  className?: string;
  /** Extra content between the totals and the checkout button (coupon, gift options). */
  children?: ReactNode;
}) {
  const t = useTranslations('cart');
  const format = useFormatter();
  const money = (amount: number) => format.number(amount, 'vnd');
  const couponCode = view.coupon?.applied ? view.coupon.code : null;

  return (
    <section
      aria-labelledby="cart-summary-title"
      className={cn('flex flex-col gap-6', className)}
      data-testid="cart-summary"
    >
      <h2 id="cart-summary-title" className="text-h3">
        {t('summary.title')}
      </h2>
      {showFreeShipping && <FreeShippingProgress progress={view.freeShipping} />}
      {children}
      <dl className="text-small flex flex-col gap-3">
        <Row label={t('summary.subtotal')} value={money(view.subtotal)} testId="cart-subtotal" />
        {view.discountTotal > 0 && couponCode && (
          <Row
            label={t('summary.discount', { code: couponCode })}
            value={`−${money(view.discountTotal)}`}
            testId="cart-discount"
          />
        )}
        {view.giftWrapFee > 0 && (
          <Row label={t('summary.giftWrap')} value={money(view.giftWrapFee)} />
        )}
        <Row
          label={t('summary.shipping')}
          value={
            view.coupon?.freeShipping
              ? t('summary.shippingFreeCoupon', { code: view.coupon.code })
              : t('summary.shippingAtCheckout')
          }
        />
        <div className="border-line-200 flex items-baseline justify-between gap-4 border-t pt-4">
          <dt className="text-body font-medium">{t('summary.total')}</dt>
          <dd className="text-h3 tabular-nums" data-testid="cart-total">
            {money(view.total)}
          </dd>
        </div>
      </dl>
      <p className="text-small -mt-3 text-taupe-600">{t('summary.totalNote')}</p>
      {view.canCheckout ? (
        <Button asChild size="lg" className="w-full">
          <Link href="/checkout">{t('checkout')}</Link>
        </Button>
      ) : (
        view.lines.length > 0 && (
          <div className="flex flex-col gap-2">
            <Button size="lg" className="w-full" disabled aria-describedby="checkout-blocked">
              {t('checkout')}
            </Button>
            <p id="checkout-blocked" className="text-small text-danger" role="status">
              {t('summary.checkoutBlocked')}
            </p>
          </div>
        )
      )}
    </section>
  );
}
