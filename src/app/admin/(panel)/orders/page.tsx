import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { OrderTable } from '@/components/admin/orders/order-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import {
  countOrdersByStatus,
  listAdminOrders,
  ORDER_SORTS,
  ORDER_TAB_KEYS,
  parseOrderListFilters,
  tabCounts,
  type OrderTab,
} from '@/server/modules/order';
import { listProvinceOptions } from '@/server/modules/shipping';

export default function AdminOrdersPage(props: PageProps<'/admin/orders'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/orders'>) {
  const { user } = await requireAdminPage('orders.view');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.orders' });
  const raw = await searchParams;
  const table = toListQuery(await loadTableParams(searchParams));
  const filters = parseOrderListFilters(raw);
  const sort = (ORDER_SORTS as readonly string[]).includes(table.sort) ? table.sort : 'placedAt';
  const db = getDb();
  const [data, counts, provinces] = await Promise.all([
    listAdminOrders(db, { ...table, sort, ...filters }, user.role ?? 'customer'),
    countOrdersByStatus(db),
    listProvinceOptions(db),
  ]);
  const queues = tabCounts(counts);
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tabs: { key: OrderTab | null; label: string; count: number }[] = [
    { key: null, label: t('tabs.all'), count: all },
    ...ORDER_TAB_KEYS.map((key) => ({ key, label: t(`tabs.${key}`), count: queues[key] })),
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          // Manual orders arrive with the checkout stream's placeOrder (M2 wave 2).
          <>
            <Button variant="secondary" disabled aria-describedby="manual-order-soon">
              {t('newManual')}
            </Button>
            <span id="manual-order-soon" className="text-small basis-full text-taupe-600">
              {t('newManualSoon')}
            </span>
          </>
        }
      />
      <nav
        aria-label={t('tabs.label')}
        className="border-line-200 mb-6 flex flex-wrap gap-1 border-b"
      >
        {tabs.map((tab) => {
          const active = filters.tab === tab.key;
          return (
            <Link
              key={tab.key ?? 'all'}
              href={(tab.key ? `/admin/orders?tab=${tab.key}` : '/admin/orders') as Route}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'text-small -mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4',
                active
                  ? 'border-ink-950 font-medium'
                  : 'hover:text-ink-950 border-transparent text-taupe-600',
              )}
            >
              {tab.label}
              <span className="bg-sand-100 text-ink-950 px-2 py-0.5 tabular-nums">{tab.count}</span>
            </Link>
          );
        })}
      </nav>
      <OrderTable
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        provinces={provinces}
      />
    </>
  );
}
