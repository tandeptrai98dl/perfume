import { useFormatter, useTranslations } from 'next-intl';

import type { CheckoutResult } from '@/server/modules/payment';

/** Order summary on the result page: lines, totals, money received and balance. */
export function ResultSummary({ result }: { result: CheckoutResult }) {
  const t = useTranslations('checkoutResult');
  const format = useFormatter();
  const vnd = (amount: number) => format.number(amount, 'vnd');

  const rows: { label: string; value: string; strong?: boolean; testId?: string }[] = [
    { label: t('summary.subtotal'), value: vnd(result.subtotal) },
    ...(result.discountTotal > 0
      ? [{ label: t('summary.discount'), value: `−${vnd(result.discountTotal)}` }]
      : []),
    {
      label: t('summary.shipping'),
      value: result.shippingFee === 0 ? t('summary.free') : vnd(result.shippingFee),
    },
    ...(result.giftWrapFee > 0
      ? [{ label: t('summary.giftWrap'), value: vnd(result.giftWrapFee) }]
      : []),
    { label: t('summary.total'), value: vnd(result.total), strong: true, testId: 'summary-total' },
    ...(result.depositRequired > 0
      ? [{ label: t('summary.deposit'), value: vnd(result.depositRequired) }]
      : []),
    ...(result.amountPaid > 0
      ? [
          { label: t('summary.paid'), value: vnd(result.amountPaid) },
          { label: t('summary.due'), value: vnd(Math.max(0, result.amountDue)) },
        ]
      : []),
  ];

  return (
    <section
      aria-labelledby="summary-heading"
      className="border-line-200 flex flex-col gap-5 border bg-white p-6"
    >
      <h2 id="summary-heading" className="text-h3">
        {t('summary.heading')}
      </h2>
      <ul className="divide-line-200 flex flex-col divide-y">
        {result.items.map((item, index) => (
          <li key={index} className="flex items-start justify-between gap-4 py-3 first:pt-0">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium break-words">{item.productName}</span>
              <span className="text-small text-taupe-600">
                {item.variantLabel} · {t('summary.quantity', { quantity: item.quantity })}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{vnd(item.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={
              row.strong
                ? 'border-line-200 flex justify-between gap-4 border-t pt-3 font-medium'
                : 'text-small flex justify-between gap-4'
            }
          >
            <dt className={row.strong ? undefined : 'text-taupe-600'}>{row.label}</dt>
            <dd className="tabular-nums" data-testid={row.testId}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="text-small border-line-200 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t pt-4">
        <dt className="text-taupe-600">{t('summary.method')}</dt>
        <dd>{t(`methods.${result.paymentMethod as 'cod'}`)}</dd>
        <dt className="text-taupe-600">{t('summary.paymentStatus')}</dt>
        <dd data-testid="summary-payment-status">{t(`paymentStatus.${result.paymentStatus}`)}</dd>
        <dt className="text-taupe-600">{t('summary.status')}</dt>
        <dd data-testid="summary-order-status">{t(`orderStatus.${result.status as 'pending'}`)}</dd>
      </dl>
    </section>
  );
}
