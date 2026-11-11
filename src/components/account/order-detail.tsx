import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { OrderView } from '@/server/modules/order';
import { cn } from '@/lib/utils';

import { OrderStatusBadge, PaymentStatusBadge } from './order-status-badge';

export type OrderDetailShipment = OrderView['shipments'][number] & { trackingUrl: string | null };

/**
 * OrderDetail + OrderStatusTimeline (§8.3): the same read view for the account area and the
 * guest lookup. Data comes from the page (no fetching here); actions are passed as `actions`.
 */
export function OrderDetail({
  order,
  shipments,
  actions,
}: {
  order: OrderView;
  shipments: OrderDetailShipment[];
  actions?: ReactNode;
}) {
  const t = useTranslations('customerOrder');
  const format = useFormatter();
  const money = (amount: number) => format.number(amount, 'vnd');
  const dateTime = (value: Date) =>
    format.dateTime(value, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.paymentStatus} />
        <p className="text-small text-taupe-600">
          {t('view.placedOn', { date: format.dateTime(order.placedAt, { dateStyle: 'long' }) })}
        </p>
        {actions && <div className="w-full sm:ml-auto sm:w-auto">{actions}</div>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-10">
          <section aria-labelledby="order-items" className="flex flex-col gap-4">
            <h2 id="order-items" className="text-h3">
              {t('view.items')}
            </h2>
            <ul className="border-line-200 divide-line-200 divide-y border-y">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-small text-taupe-600">
                      {item.variantLabel} · {t('view.quantity', { quantity: item.quantity })}
                    </p>
                  </div>
                  <p className="whitespace-nowrap tabular-nums">{money(item.lineTotal)}</p>
                </li>
              ))}
            </ul>
            <dl className="flex flex-col gap-2">
              <SummaryRow label={t('view.subtotal')} value={money(order.subtotal)} />
              {order.discountTotal > 0 && (
                <SummaryRow
                  label={
                    order.couponCode
                      ? t('view.coupon', { code: order.couponCode })
                      : t('view.discount')
                  }
                  value={`−${money(order.discountTotal)}`}
                />
              )}
              <SummaryRow
                label={t('view.shipping')}
                value={order.shippingFee > 0 ? money(order.shippingFee) : t('view.freeShipping')}
              />
              {order.giftWrapFee > 0 && (
                <SummaryRow label={t('view.giftWrap')} value={money(order.giftWrapFee)} />
              )}
              <SummaryRow label={t('view.total')} value={money(order.total)} strong />
            </dl>
          </section>

          <section aria-labelledby="order-timeline" className="flex flex-col gap-4">
            <h2 id="order-timeline" className="text-h3">
              {t('view.timeline')}
            </h2>
            <ol className="border-line-200 flex flex-col gap-4 border-l pl-6">
              {order.timeline.map((entry, index) => {
                const current = index === order.timeline.length - 1;
                return (
                  <li
                    key={`${entry.status}-${index}`}
                    aria-current={current ? 'step' : undefined}
                    className="relative"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-1.5 -left-[1.82rem] size-3 rounded-full border',
                        current ? 'border-ink-950 bg-ink-950' : 'bg-ivory-50 border-taupe-600',
                      )}
                    />
                    <p className={cn(current && 'font-medium')}>{t(`status.${entry.status}`)}</p>
                    <p className="text-small text-taupe-600">
                      <time dateTime={entry.at.toISOString()}>{dateTime(entry.at)}</time>
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="flex flex-col gap-8">
          <section aria-labelledby="order-payment" className="bg-sand-100 flex flex-col gap-3 p-6">
            <h2 id="order-payment" className="text-h3">
              {t('view.payment')}
            </h2>
            <dl className="flex flex-col gap-2">
              <SummaryRow
                label={t('view.paymentMethod')}
                value={t(`paymentMethod.${order.paymentMethod}`)}
                text
              />
              <SummaryRow
                label={t('view.paymentStatus')}
                value={t(`paymentStatus.${order.paymentStatus}`)}
                text
              />
              {order.depositRequired > 0 && (
                <SummaryRow label={t('view.deposit')} value={money(order.depositRequired)} />
              )}
              <SummaryRow label={t('view.amountPaid')} value={money(order.amountPaid)} />
              {order.amountRefunded > 0 && (
                <SummaryRow label={t('view.amountRefunded')} value={money(order.amountRefunded)} />
              )}
              <SummaryRow label={t('view.amountDue')} value={money(order.amountDue)} strong />
            </dl>
          </section>

          {order.shippingAddress && (
            <section aria-labelledby="order-address" className="flex flex-col gap-2">
              <h2 id="order-address" className="text-h3">
                {t('view.shippingAddress')}
              </h2>
              <address className="text-ink-700 not-italic">
                {order.shippingAddress.fullName}
                <br />
                {order.shippingAddress.phone}
                <br />
                {order.shippingAddress.street}
                <br />
                {order.shippingAddress.wardName}, {order.shippingAddress.provinceName}
              </address>
            </section>
          )}

          <section aria-labelledby="order-tracking" className="flex flex-col gap-2">
            <h2 id="order-tracking" className="text-h3">
              {t('view.tracking')}
            </h2>
            {shipments.length === 0 ? (
              <p className="text-small text-taupe-600">{t('view.noTracking')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {shipments.map((shipment) => (
                  <li key={shipment.trackingCode} className="flex flex-col gap-1">
                    <p className="font-medium">
                      {t(`carrier.${shipment.carrier}`)} ·{' '}
                      {t(`shipmentStatus.${shipment.status as 'pending'}`)}
                    </p>
                    <p className="text-small">
                      {t('view.trackingCode', { code: shipment.trackingCode })}
                    </p>
                    {shipment.trackingUrl && (
                      <a
                        href={shipment.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-small text-gold-700 hover:underline"
                      >
                        {t('view.trackParcel')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(order.giftMessage || order.customerNote) && (
            <section className="flex flex-col gap-3">
              {order.giftMessage && (
                <div>
                  <h2 className="eyebrow text-taupe-600">{t('view.giftMessage')}</h2>
                  <p className="mt-1 whitespace-pre-line">{order.giftMessage}</p>
                </div>
              )}
              {order.customerNote && (
                <div>
                  <h2 className="eyebrow text-taupe-600">{t('view.note')}</h2>
                  <p className="mt-1 whitespace-pre-line">{order.customerNote}</p>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Label/value row; amounts never wrap, text values (method, status) may. */
function SummaryRow({
  label,
  value,
  strong = false,
  text = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  text?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', strong && 'font-medium')}>
      <dt className={cn('shrink-0', !strong && 'text-taupe-600')}>{label}</dt>
      <dd className={cn('text-right', text ? 'min-w-0' : 'whitespace-nowrap tabular-nums')}>
        {value}
      </dd>
    </div>
  );
}
