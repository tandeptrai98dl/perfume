import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { BrandForm } from '@/components/admin/catalog/brand-form';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { StatusBadge } from '@/components/admin/status-badge';
import { serverEnv } from '@/lib/env';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getBrand } from '@/server/modules/catalog';

import { isUuid } from '../../../_lib/params';

/** `/admin/catalog/brands/new` creates; a UUID edits. */
export default function AdminBrandPage(props: PageProps<'/admin/catalog/brands/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/catalog/brands/[id]'>) {
  await requireAdminPage('products.editContent');
  const { id } = await params;
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  if (id !== 'new' && !isUuid(id)) notFound();
  const brand = id === 'new' ? null : await getBrand(getDb(), id);
  if (id !== 'new' && !brand) notFound();
  return (
    <>
      <PageHeader
        title={brand?.name ?? t('brands.createTitle')}
        meta={brand && <StatusBadge status={brand.status} />}
        back={{ href: '/admin/catalog/brands', label: t('brands.title') }}
      />
      <BrandForm
        key={brand?.updatedAt.toISOString() ?? 'new'}
        brand={brand}
        appUrl={serverEnv().APP_URL}
      />
    </>
  );
}
