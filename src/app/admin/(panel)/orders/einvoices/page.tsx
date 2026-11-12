import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { FailedEinvoiceTable } from '@/components/admin/orders/failed-einvoice-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { listFailedEinvoices } from '@/server/modules/einvoice';

/** Failed e-invoices (D13, §11.2 "e-invoices failed"): orders to retry or invoice manually. */
export default function FailedEinvoicesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { user } = await requireAdminPage('orders.view');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const rows = await listFailedEinvoices(getDb());
  return (
    <>
      <PageHeader
        title={t('einvoices.title')}
        description={t('einvoices.description')}
        back={{ href: '/admin/orders', label: t('orders.title') }}
      />
      {rows.length === 0 ? (
        <p className="text-small text-taupe-600">
          {t('einvoices.empty')}{' '}
          <Link href={'/admin/orders' as Route} className="underline">
            {t('orders.title')}
          </Link>
        </p>
      ) : (
        <FailedEinvoiceTable
          rows={rows}
          canProcess={hasPermission(user.role ?? '', 'orders.process')}
        />
      )}
    </>
  );
}
