import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { OrderStatusBadge, PaymentStatusBadge } from '@/components/admin/orders/order-badges';
import { OrderDetailView } from '@/components/admin/orders/order-detail';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { getAdminOrderDetail } from '@/server/modules/order';

import { isUuid } from '../../_lib/params';

export default function AdminOrderPage(props: PageProps<'/admin/orders/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/orders/[id]'>) {
  const { user } = await requireAdminPage('orders.view');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const role = user.role ?? 'customer';
  const order = await getAdminOrderDetail(getDb(), id, role);
  if (!order) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.orders' });
  const placed = new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(order.placedAt);
  return (
    <>
      <PageHeader
        title={<span className="font-mono">{order.code}</span>}
        description={`${t('detail.placedAt', { date: placed })} · ${t(`detail.source.${order.source}`)} · ${t(`paymentMethod.${order.paymentMethod}`)}`}
        back={{ href: '/admin/orders', label: t('title') }}
        meta={
          <>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
          </>
        }
      />
      {/* Remount after every change so client state starts from the new version. */}
      <OrderDetailView
        key={order.version}
        order={order}
        canCancelPaid={hasPermission(role, 'orders.cancelPaid')}
      />
    </>
  );
}
