import { getTranslations } from 'next-intl/server';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { LowStockList } from '@/components/admin/inventory/low-stock-list';
import { StockTable } from '@/components/admin/inventory/stock-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listLowStock, listStock } from '@/server/modules/inventory';

const loadFilters = createLoader({ stock: parseAsStringLiteral(['low'] as const) });

export default function AdminInventoryPage(props: PageProps<'/admin/inventory'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/inventory'>) {
  await requireAdminPage('inventory.adjust');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.inventory' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { stock } = await loadFilters(searchParams);
  const db = getDb();
  const [data, low] = await Promise.all([
    listStock(db, { ...query, lowOnly: stock === 'low' }),
    listLowStock(db, 10),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-col gap-8">
        <LowStockList rows={low} />
        <StockTable rows={data.rows} total={data.total} page={data.page} pageSize={data.pageSize} />
      </div>
    </>
  );
}
