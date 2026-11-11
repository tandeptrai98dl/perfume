import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { ProductEditor } from '@/components/admin/products/product-editor';
import { serverEnv } from '@/lib/env';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getProductForEdit, productEditorOptions } from '@/server/modules/catalog';

import { isUuid } from '../../_lib/params';

export default function AdminProductPage(props: PageProps<'/admin/products/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/products/[id]'>) {
  await requireAdminPage('products.editContent');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.products' });
  const db = getDb();
  const [data, options] = await Promise.all([getProductForEdit(db, id), productEditorOptions(db)]);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title={data.translations.vi?.name ?? id}
        description={data.product.concentration.toUpperCase()}
        back={{ href: '/admin/products', label: t('title') }}
      />
      {/* Remount after every save so the form holds the server's ids and timestamps. */}
      <ProductEditor
        key={data.product.updatedAt.toISOString()}
        data={data}
        options={options}
        appUrl={serverEnv().APP_URL}
      />
    </>
  );
}
