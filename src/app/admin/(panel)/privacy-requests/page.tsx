import { getTranslations } from 'next-intl/server';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { PrivacyRequestTable } from '@/components/admin/privacy/privacy-request-table';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import {
  countOpenPrivacyRequests,
  listPrivacyRequests,
  PRIVACY_REQUEST_FILTERS,
  PRIVACY_REQUEST_TYPES,
} from '@/server/modules/customer';

const loadFilters = createLoader({
  filter: parseAsStringLiteral(PRIVACY_REQUEST_FILTERS).withDefault('open'),
  type: parseAsStringLiteral(PRIVACY_REQUEST_TYPES),
});

/**
 * Privacy requests (§11.2): queue with legal due dates (Decree 356/2025), most urgent first.
 * Owner only (`privacyRequests.handle`, §11.1).
 */
export default function AdminPrivacyRequestsPage(props: PageProps<'/admin/privacy-requests'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/privacy-requests'>) {
  await requireAdminPage('privacyRequests.handle');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.privacyRequests' });
  const query = toListQuery(await loadTableParams(searchParams));
  const { filter, type } = await loadFilters(searchParams);
  const db = getDb();
  const [data, counts] = await Promise.all([
    listPrivacyRequests(db, {
      filter,
      type,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    }),
    countOpenPrivacyRequests(db),
  ]);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description', { open: counts.open, overdue: counts.overdue })}
      />
      <PrivacyRequestTable
        rows={data.rows.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          email: row.email,
          hasAccount: row.hasAccount,
          createdAt: row.createdAt.toISOString(),
          dueAt: row.dueAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          overdue: row.overdue,
        }))}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}
