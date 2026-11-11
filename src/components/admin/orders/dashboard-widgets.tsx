import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type {
  OrderStatus,
  OrderStatusCounts,
  OrderTab,
  RevenueStats,
} from '@/server/modules/order';

import { OrderStatusBadge } from './order-badges';
import { useOrderFormat } from './format';

/* Dashboard widgets (§11.2): work queues, orders by status and revenue KPI cards. */

export function OrderQueues({ queues }: { queues: Record<OrderTab, number> }) {
  const t = useTranslations('admin');
  return (
    <section aria-labelledby="dashboard-queues" className="flex flex-col gap-3">
      <h2 id="dashboard-queues" className="text-h3">
        {t('dashboard.queues')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(queues) as OrderTab[]).map((tab) => (
          <li key={tab}>
            <Link
              href={`/admin/orders?tab=${tab}` as Route}
              className="border-line-200 hover:border-ink-950 flex flex-col gap-1 border bg-white p-4"
              aria-label={`${t(`orders.tabs.${tab}`)}: ${queues[tab]}`}
            >
              <span className="text-small text-taupe-600">{t(`orders.tabs.${tab}`)}</span>
              <span className="text-h2 tabular-nums">{queues[tab]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrdersByStatus({ counts }: { counts: OrderStatusCounts }) {
  const t = useTranslations('admin.dashboard');
  const statuses = (Object.keys(counts) as OrderStatus[]).filter((status) => counts[status] > 0);
  return (
    <section
      aria-labelledby="dashboard-statuses"
      className="border-line-200 flex flex-col gap-3 border p-4"
    >
      <h2 id="dashboard-statuses" className="text-h3">
        {t('byStatus')}
      </h2>
      <ul className="flex flex-col">
        {statuses.map((status) => (
          <li
            key={status}
            className="border-line-200 flex items-center justify-between gap-3 border-t py-2 first:border-t-0"
          >
            <Link href={`/admin/orders?status=${status}` as Route} className="hover:underline">
              <OrderStatusBadge status={status} />
            </Link>
            <span className="text-small tabular-nums">{counts[status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RevenueCards({ stats }: { stats: RevenueStats }) {
  const t = useTranslations('admin.dashboard');
  const format = useOrderFormat();
  return (
    <section aria-labelledby="dashboard-revenue" className="flex flex-col gap-3">
      <h2 id="dashboard-revenue" className="text-h3">
        {t('revenue')}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {(['today', 'last7Days', 'last30Days'] as const).map((key) => (
          <div key={key} className="border-line-200 flex flex-col gap-1 border bg-white p-4">
            <dt className="text-small text-taupe-600">{t(key)}</dt>
            <dd className="text-h2 tabular-nums">{format.vnd(stats[key].revenue)}</dd>
            <dd className="text-small text-taupe-600">
              {t('orderCount', { count: stats[key].orders })} ·{' '}
              {t('aov', { amount: format.vnd(stats[key].averageOrderValue) })}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
