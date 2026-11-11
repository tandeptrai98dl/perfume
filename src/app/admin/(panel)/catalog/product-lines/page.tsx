import { getTranslations } from 'next-intl/server';
import { createLoader, parseAsString } from 'nuqs/server';
import { Suspense } from 'react';

import { ProductLineManager } from '@/components/admin/catalog/product-line-manager';
import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { brandOptions, listProductLines } from '@/server/modules/catalog';

import { isUuid } from '../../_lib/params';

const loadFilters = createLoader({ brand: parseAsString });

export default function AdminProductLinesPage(props: PageProps<'/admin/catalog/product-lines'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/catalog/product-lines'>) {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.productLines' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { brand } = await loadFilters(searchParams);
  const db = getDb();
  const [data, brands] = await Promise.all([
    listProductLines(db, { ...query, brandId: brand && isUuid(brand) ? brand : null }),
    brandOptions(db),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ProductLineManager
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        brands={brands}
      />
    </>
  );
}
