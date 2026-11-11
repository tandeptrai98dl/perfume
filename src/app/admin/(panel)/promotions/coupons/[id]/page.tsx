import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { CouponForm } from '@/components/admin/promotions/coupon-form';
import { CouponStats } from '@/components/admin/promotions/coupon-stats';
import { CouponStateBadge } from '@/components/admin/promotions/coupon-table';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { brandOptions, listCategories } from '@/server/modules/catalog';
import { getCouponForEdit } from '@/server/modules/promotion';

import { isUuid } from '../../../_lib/params';

export default function CouponPage(props: PageProps<'/admin/promotions/coupons/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/promotions/coupons/[id]'>) {
  await requireAdminPage('coupons.manage');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const [coupon, brands, categories] = await Promise.all([
    getCouponForEdit(db, id),
    brandOptions(db),
    listCategories(db),
  ]);
  if (!coupon) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.coupons' });
  return (
    <>
      <PageHeader
        title={<span className="font-mono">{coupon.code}</span>}
        meta={<CouponStateBadge state={coupon.state} />}
        back={{ href: '/admin/promotions/coupons', label: t('title') }}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <CouponForm
          coupon={coupon}
          brands={brands.map(({ id: brandId, name }) => ({ id: brandId, name }))}
          categories={categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }))}
        />
        <div>
          <CouponStats coupon={coupon} />
        </div>
      </div>
    </>
  );
}
