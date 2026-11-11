import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { BrandTable } from '@/components/admin/catalog/brand-table';
import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listBrands } from '@/server/modules/catalog';

const loadFilters = createLoader({
  status: parseAsStringLiteral(['draft', 'active', 'archived'] as const),
});

export default function AdminBrandsPage(props: PageProps<'/admin/catalog/brands'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BrandsContent {...props} />
    </Suspense>
  );
}

async function BrandsContent({ searchParams }: PageProps<'/admin/catalog/brands'>) {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.brands' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { status } = await loadFilters(searchParams);
  const data = await listBrands(getDb(), { ...query, status });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/admin/catalog/brands/new">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <BrandTable rows={data.rows} total={data.total} page={data.page} pageSize={data.pageSize} />
    </>
  );
}
