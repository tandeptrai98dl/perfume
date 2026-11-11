import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { CouponForm } from '@/components/admin/promotions/coupon-form';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { brandOptions, listCategories } from '@/server/modules/catalog';

export default function NewCouponPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage('coupons.manage');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.coupons' });
  const db = getDb();
  const [brands, categories] = await Promise.all([brandOptions(db), listCategories(db)]);
  return (
    <>
      <PageHeader
        title={t('new')}
        back={{ href: '/admin/promotions/coupons', label: t('title') }}
      />
      <CouponForm
        coupon={null}
        brands={brands.map(({ id, name }) => ({ id, name }))}
        categories={categories.map(({ id, name, parentId }) => ({ id, name, parentId }))}
      />
    </>
  );
}
