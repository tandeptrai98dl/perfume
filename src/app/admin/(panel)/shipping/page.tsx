import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { ShippingManager } from '@/components/admin/shipping/shipping-manager';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import {
  listProvinceOptions,
  listShippingZonesForAdmin,
  SHIPPING_PERMISSION,
} from '@/server/modules/shipping';

export default function AdminShippingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage(SHIPPING_PERMISSION);
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.shipping' });
  const db = getDb();
  const [zones, provinces] = await Promise.all([
    listShippingZonesForAdmin(db),
    listProvinceOptions(db),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ShippingManager zones={zones} provinces={provinces} />
    </>
  );
}
