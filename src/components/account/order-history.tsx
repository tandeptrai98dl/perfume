import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { CustomerOrderRow } from '@/server/modules/order';

import { OrderStatusBadge } from './order-status-badge';

/** OrderHistoryTable (§8.3): one card-like row per order, readable at 375 px and 1280 px. */
export function OrderHistory({ orders }: { orders: CustomerOrderRow[] }) {
  const t = useTranslations('account.orders');
  const tOrder = useTranslations('customerOrder');
  const format = useFormatter();
  return (
    <ul className="border-line-200 divide-line-200 divide-y border-y" data-testid="order-history">
      {orders.map((order) => (
        <li key={order.code}>
          <Link
            href={{ pathname: '/account/orders/[code]', params: { code: order.code } }}
            className="hover:bg-sand-100 grid gap-2 px-2 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6"
          >
            <span className="flex flex-col gap-1">
              <span className="font-medium tracking-wide">{order.code}</span>
              <span className="text-small text-taupe-600">
                {format.dateTime(order.placedAt, { dateStyle: 'medium' })} ·{' '}
                {t('items', { count: order.itemCount })} ·{' '}
                {tOrder(`paymentMethod.${order.paymentMethod}`)}
              </span>
            </span>
            <span>
              <OrderStatusBadge status={order.status} />
            </span>
            <span className="tabular-nums sm:text-right">{format.number(order.total, 'vnd')}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
