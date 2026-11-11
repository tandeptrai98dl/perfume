import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { OrderStatusBadge } from '@/components/admin/orders/order-badges';
import { OrderEditForm } from '@/components/admin/orders/order-edit-form';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { getOrderEditForm } from '@/server/modules/order';

import { isUuid } from '../../../_lib/params';

/** Order edit before shipment (§11.2 "Order edits"): diff + money difference before saving. */
export default function AdminOrderEditPage(props: PageProps<'/admin/orders/[id]/edit'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/orders/[id]/edit'>) {
  const { user } = await requireAdminPage('orders.editBeforeShipping');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const form = await getOrderEditForm(getDb(), id);
  if (!form) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.orders' });
  const role = user.role ?? 'customer';
  return (
    <>
      <PageHeader
        title={t('edit.title', { code: form.code })}
        description={t('edit.description')}
        back={{ href: `/admin/orders/${form.id}`, label: t('edit.back') }}
        meta={<OrderStatusBadge status={form.status} />}
      />
      {form.editable ? (
        <OrderEditForm
          key={form.version}
          form={form}
          canOverrideShipping={hasPermission(role, 'orders.cancelPaid')}
        />
      ) : (
        <div className="border-line-200 flex flex-col items-start gap-4 border bg-white p-6">
          <p role="status">{t('edit.notEditable', { status: t(`status.${form.status}`) })}</p>
          <Button asChild variant="secondary">
            <Link href={`/admin/orders/${form.id}`}>{t('edit.back')}</Link>
          </Button>
        </div>
      )}
    </>
  );
}
