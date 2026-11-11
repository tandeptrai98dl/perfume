import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { createLoader, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { ProductTable } from '@/components/admin/products/product-table';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { brandOptions, listProducts } from '@/server/modules/catalog';

import { isUuid } from '../_lib/params';

const loadFilters = createLoader({
  status: parseAsStringLiteral(['draft', 'active', 'archived'] as const),
  brand: parseAsString,
});

export default function AdminProductsPage(props: PageProps<'/admin/products'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/products'>) {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.products' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { status, brand } = await loadFilters(searchParams);
  const db = getDb();
  const [data, brands] = await Promise.all([
    listProducts(db, { ...query, status, brandId: brand && isUuid(brand) ? brand : null }),
    brandOptions(db),
  ]);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/admin/products/new">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <ProductTable
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        brands={brands}
      />
    </>
  );
}
