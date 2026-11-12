import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { ReturnQueueTable } from '@/components/admin/orders/return-queue-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listReturnQueue } from '@/server/modules/returns';

/** Return requests waiting for staff (ADR-0017, §11.2 work queue), oldest first. */
export default function ReturnQueuePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage('orders.view');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const rows = await listReturnQueue(getDb());
  return (
    <>
      <PageHeader
        title={t('returns.title')}
        description={t('returns.description')}
        back={{ href: '/admin/orders', label: t('orders.title') }}
      />
      {rows.length === 0 ? (
        <p className="text-small text-taupe-600">
          {t('returns.empty')}{' '}
          <Link href={'/admin/orders' as Route} className="underline">
            {t('orders.title')}
          </Link>
        </p>
      ) : (
        <ReturnQueueTable rows={rows} />
      )}
    </>
  );
}
