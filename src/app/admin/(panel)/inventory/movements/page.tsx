import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { createLoader, parseAsString } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { StockMovementLog } from '@/components/admin/inventory/stock-movement-log';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listMovements } from '@/server/modules/inventory';

import { isUuid } from '../../_lib/params';

const loadFilters = createLoader({ variant: parseAsString });

export default function AdminMovementsPage(props: PageProps<'/admin/inventory/movements'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/inventory/movements'>) {
  await requireAdminPage('inventory.adjust');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.inventory.movements' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { variant } = await loadFilters(searchParams);
  const variantId = variant && isUuid(variant) ? variant : null;
  const data = await listMovements(getDb(), { ...query, variantId });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        meta={
          variantId && (
            <span className="text-small flex items-center gap-2">
              {t('forVariant', { sku: data.rows[0]?.sku ?? '' })}
              <Link href={'/admin/inventory/movements' as Route} className="underline">
                {t('showAll')}
              </Link>
            </span>
          )
        }
      />
      <StockMovementLog
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}
