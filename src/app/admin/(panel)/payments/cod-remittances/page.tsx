import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { CodRemittanceForm } from '@/components/admin/payments/cod-remittance-form';
import { CodRemittanceTable } from '@/components/admin/payments/cod-remittance-table';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { listCodRemittanceCandidates, listCodRemittances } from '@/server/modules/payment';

/** COD reconciliation (§3.4 step 6, §11.2). */
export default function AdminCodRemittancesPage(
  props: PageProps<'/admin/payments/cod-remittances'>,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

/** Today in Vietnam time as YYYY-MM-DD (default dates of a new remittance). */
function vietnamToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

async function Content({ searchParams }: PageProps<'/admin/payments/cod-remittances'>) {
  await requireAdminPage('payments.reconcileCod');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.payments.cod' });
  const query = toListQuery(await loadTableParams(searchParams));
  const db = getDb();
  const [candidates, remittances] = await Promise.all([
    listCodRemittanceCandidates(db),
    listCodRemittances(db, query),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-col gap-10">
        <CodRemittanceForm
          key={candidates.map((c) => c.orderId).join(',')}
          candidates={candidates}
          today={vietnamToday()}
        />
        <section className="flex flex-col gap-4">
          <h2 className="text-h3">{t('listTitle')}</h2>
          <CodRemittanceTable
            rows={remittances.rows}
            total={remittances.total}
            page={remittances.page}
            pageSize={remittances.pageSize}
          />
        </section>
      </div>
    </>
  );
}
