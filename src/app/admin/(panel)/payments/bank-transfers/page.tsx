import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { BankTransferTable } from '@/components/admin/payments/bank-transfer-table';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listBankTransferOrders } from '@/server/modules/payment';

/** Manual bank transfer confirmation (Manager, §3.4 step 7). */
export default function AdminBankTransfersPage(props: PageProps<'/admin/payments/bank-transfers'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/payments/bank-transfers'>) {
  await requireAdminPage('payments.confirmBankTransfer');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.payments.bankTransfers' });
  const query = toListQuery(await loadTableParams(searchParams));
  const rows = await listBankTransferOrders(getDb(), { q: query.q, limit: 50 });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <p className="text-small mb-4 text-taupe-600">{t('searchHint')}</p>
      <BankTransferTable rows={rows} />
    </>
  );
}
