import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { CouponTable } from '@/components/admin/promotions/coupon-table';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { COUPON_SORTS, listCoupons } from '@/server/modules/promotion';

export default function AdminCouponsPage(props: PageProps<'/admin/promotions/coupons'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/promotions/coupons'>) {
  await requireAdminPage('coupons.manage');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.coupons' });
  const query = toListQuery(await loadTableParams(searchParams));
  const sort = (COUPON_SORTS as readonly string[]).includes(query.sort) ? query.sort : 'createdAt';
  const data = await listCoupons(getDb(), { ...query, sort });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link href={'/admin/promotions/coupons/new' as Route}>{t('new')}</Link>
          </Button>
        }
      />
      <CouponTable rows={data.rows} total={data.total} page={data.page} pageSize={data.pageSize} />
    </>
  );
}
