import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { createLoader, parseAsStringLiteral } from 'nuqs/server';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { PaymentTable } from '@/components/admin/payments/payment-table';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getPaymentOverview, listPayments } from '@/server/modules/payment';

const loadFilters = createLoader({
  provider: parseAsStringLiteral(['vnpay', 'payos', 'bank_manual', 'cod'] as const),
  status: parseAsStringLiteral([
    'pending',
    'succeeded',
    'failed',
    'expired',
    'cancelled',
    'refunded',
  ] as const),
});

/** /admin/payments (§5.2): transactions by gateway + counters for what needs attention. */
export default function AdminPaymentsPage(props: PageProps<'/admin/payments'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/payments'>) {
  await requireAdminPage('payments.refund');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.payments' });
  const query = toListQuery(await loadTableParams(searchParams));
  const filters = await loadFilters(searchParams);
  const db = getDb();
  const [data, overview] = await Promise.all([
    listPayments(db, { ...query, provider: filters.provider, status: filters.status }),
    getPaymentOverview(db),
  ]);
  const links: { href: string; label: string; count: number }[] = [
    {
      href: '/admin/payments/refunds',
      label: t('overview.openRefunds', { count: overview.openRefunds }),
      count: overview.openRefunds,
    },
    {
      href: '/admin/payments/events?filter=unmatched',
      label: t('overview.suspicious', { count: overview.suspiciousEvents }),
      count: overview.suspiciousEvents,
    },
    {
      href: '/admin/payments/bank-transfers',
      label: t('overview.awaitingTransfer', { count: overview.awaitingBankTransfer }),
      count: overview.awaitingBankTransfer,
    },
  ];
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ul className="mb-6 flex flex-wrap gap-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href as Route}
              className={
                link.count > 0
                  ? 'text-small border-warning text-warning inline-flex min-h-11 items-center border px-4 underline-offset-4 hover:underline'
                  : 'text-small border-line-200 inline-flex min-h-11 items-center border px-4 text-taupe-600 underline-offset-4 hover:underline'
              }
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <PaymentTable rows={data.rows} total={data.total} page={data.page} pageSize={data.pageSize} />
    </>
  );
}
