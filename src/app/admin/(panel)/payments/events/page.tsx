import { getTranslations } from 'next-intl/server';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { PaymentEventTable } from '@/components/admin/payments/payment-event-table';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listPaymentEvents, PAYMENT_EVENT_FILTERS } from '@/server/modules/payment';

const loadFilters = createLoader({
  filter: parseAsStringLiteral(PAYMENT_EVENT_FILTERS).withDefault('all'),
});

/** Webhook log (§11.2): every IPN/webhook, including invalid signatures and unmatched events. */
export default function AdminPaymentEventsPage(props: PageProps<'/admin/payments/events'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/payments/events'>) {
  await requireAdminPage('payments.refund');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.payments.events' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { filter } = await loadFilters(searchParams);
  const data = await listPaymentEvents(getDb(), { ...query, filter });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        back={{ href: '/admin/payments', label: t('back') }}
      />
      <PaymentEventTable
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}
