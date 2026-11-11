import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { CategoryTreeTable } from '@/components/admin/catalog/category-tree-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listCategories } from '@/server/modules/catalog';

export default function AdminCategoriesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.categories' });
  const rows = await listCategories(getDb());
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href="/admin/catalog/categories/new">
              <Plus aria-hidden />
              {t('new')}
            </Link>
          </Button>
        }
      />
      <CategoryTreeTable rows={rows} />
    </>
  );
}
