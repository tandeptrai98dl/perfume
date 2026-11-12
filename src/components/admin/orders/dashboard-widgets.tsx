import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type { OrderTab } from '@/server/modules/order';

/*
 * Dashboard work queues (§11.2). The KPI widgets (revenue, orders by status, best sellers)
 * live in components/admin/dashboard (M3 reporting).
 */

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
