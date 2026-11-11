import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { CollectionTable } from '@/components/admin/catalog/collection-table';
import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listCollections } from '@/server/modules/catalog';

export default function AdminCollectionsPage(props: PageProps<'/admin/catalog/collections'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/catalog/collections'>) {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.collections' });
  const data = await listCollections(getDb(), toListQuery(await loadTableParams(searchParams)));
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/admin/catalog/collections/new">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <CollectionTable
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}
