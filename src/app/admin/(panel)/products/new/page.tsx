import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { ProductCreateForm } from '@/components/admin/products/product-create-form';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { brandOptions, productLineOptions } from '@/server/modules/catalog';

export default function AdminNewProductPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage('products.editContent');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.products' });
  const db = getDb();
  const [brands, productLines] = await Promise.all([brandOptions(db), productLineOptions(db)]);
  return (
    <>
      <PageHeader
        title={t('createTitle')}
        description={t('createDescription')}
        back={{ href: '/admin/products', label: t('title') }}
      />
      <ProductCreateForm brands={brands} productLines={productLines} />
    </>
  );
}
