import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { CategoryForm } from '@/components/admin/catalog/category-form';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { serverEnv } from '@/lib/env';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getCategory, listCategories } from '@/server/modules/catalog';

import { isUuid } from '../../../_lib/params';

export default function AdminCategoryPage(props: PageProps<'/admin/catalog/categories/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/catalog/categories/[id]'>) {
  await requireAdminPage('products.editContent');
  const { id } = await params;
  if (id !== 'new' && !isUuid(id)) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.categories' });
  const db = getDb();
  const [category, all] = await Promise.all([
    id === 'new' ? null : getCategory(db, id),
    listCategories(db),
  ]);
  if (id !== 'new' && !category) notFound();
  return (
    <>
      <PageHeader
        title={category?.translations.vi?.name ?? t('createTitle')}
        back={{ href: '/admin/catalog/categories', label: t('title') }}
      />
      <CategoryForm
        key={category?.updatedAt.toISOString() ?? 'new'}
        category={category}
        roots={all.filter((c) => !c.parentId).map((c) => ({ id: c.id, name: c.name }))}
        appUrl={serverEnv().APP_URL}
      />
    </>
  );
}
