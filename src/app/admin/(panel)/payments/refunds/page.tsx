import { getTranslations } from 'next-intl/server';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { RefundTable } from '@/components/admin/payments/refund-table';
import { RequestRefundDialog } from '@/components/admin/payments/request-refund-dialog';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getPaymentGateways } from '@/server/integrations/payments';
import { listRefunds, REFUND_FILTERS } from '@/server/modules/payment';

const loadFilters = createLoader({
  filter: parseAsStringLiteral(REFUND_FILTERS).withDefault('open'),
});

/** Refund queue (§11.2), including IPNs received after cancellation. */
export default function AdminRefundsPage(props: PageProps<'/admin/payments/refunds'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/payments/refunds'>) {
  await requireAdminPage('payments.refund');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.payments.refunds' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { filter } = await loadFilters(searchParams);
  const data = await listRefunds(getDb(), { ...query, filter });
  const gateways = getPaymentGateways();
  const refundProviders = (['vnpay', 'payos'] as const).filter((p) => !!gateways[p]?.refund);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<RequestRefundDialog />}
      />
      <RefundTable
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        refundProviders={refundProviders}
      />
    </>
  );
}
