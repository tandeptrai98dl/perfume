import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { OrderStatusBadge, PaymentStatusBadge } from '@/components/admin/orders/order-badges';
import { EinvoiceStatus } from '@/components/admin/orders/einvoice-status';
import { NotificationLog } from '@/components/admin/orders/notification-log';
import { OrderDetailView } from '@/components/admin/orders/order-detail';
import { OpenReturnDialog } from '@/components/admin/orders/open-return-dialog';
import { ReturnPanel } from '@/components/admin/orders/return-panel';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { getOrderEinvoice } from '@/server/modules/einvoice';
import { listNotificationLogs } from '@/server/modules/notification';
import { canEditOrder, getAdminOrderDetail } from '@/server/modules/order';
import { getAdminReturn, getStaffReturnOptions } from '@/server/modules/returns';

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
  const db = getDb();
  const canProcess = hasPermission(role, 'orders.process');
  const [order, einvoice, notifications, returnView, returnOptions] = await Promise.all([
    getAdminOrderDetail(db, id, role),
    getOrderEinvoice(db, id),
    listNotificationLogs(db, { refType: 'order', refId: id }),
    getAdminReturn(db, id),
    // Staff-opened returns (on the customer's behalf): `orders.process` only.
    canProcess ? getStaffReturnOptions(db, id) : null,
  ]);
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
        canEdit={hasPermission(role, 'orders.editBeforeShipping') && canEditOrder(order.status)}
        einvoice={
          einvoice && (
            <EinvoiceStatus
              einvoice={einvoice}
              orderCode={order.code}
              canProcess={hasPermission(role, 'orders.process')}
              canAdjust={hasPermission(role, 'payments.refund')}
            />
          )
        }
        returns={
          (returnView || returnOptions?.canOpen) && (
            <div className="flex flex-col gap-6">
              {returnView && (
                <ReturnPanel
                  view={returnView}
                  orderCode={order.code}
                  canManage={hasPermission(role, 'payments.refund')}
                  canProcess={canProcess}
                />
              )}
              {returnOptions?.canOpen && (
                <OpenReturnDialog
                  orderId={order.id}
                  orderCode={order.code}
                  options={returnOptions}
                  canOverride={hasPermission(role, 'payments.refund')}
                />
              )}
            </div>
          )
        }
        notifications={<NotificationLog rows={notifications} />}
        customerHref={
          hasPermission(role, 'customers.view')
            ? order.userId
              ? `/admin/customers/${order.userId}`
              : order.contact.phone
                ? `/admin/customers/g-${order.id}`
                : null
            : null
        }
      />
    </>
  );
}
