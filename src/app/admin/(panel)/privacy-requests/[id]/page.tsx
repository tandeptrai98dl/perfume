import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { PrivacyRequestDetailView } from '@/components/admin/privacy/privacy-request-detail';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getPrivacyRequestDetail } from '@/server/modules/customer';

import { isUuid } from '../../_lib/params';

/** One privacy request: subject summary, actions by type and status, audit history. */
export default function AdminPrivacyRequestPage(props: PageProps<'/admin/privacy-requests/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/privacy-requests/[id]'>) {
  await requireAdminPage('privacyRequests.handle');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const request = await getPrivacyRequestDetail(getDb(), id);
  if (!request) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.privacyRequests' });
  return (
    <>
      <PageHeader
        title={t('detail.title')}
        description={request.email}
        back={{ href: '/admin/privacy-requests', label: t('title') }}
      />
      <PrivacyRequestDetailView
        key={`${request.status}-${request.updatedAt.toISOString()}`}
        request={{
          id: request.id,
          type: request.type,
          status: request.status,
          email: request.email,
          note: request.note,
          createdAt: request.createdAt.toISOString(),
          dueAt: request.dueAt.toISOString(),
          completedAt: request.completedAt?.toISOString() ?? null,
          overdue: request.overdue,
          account: request.account,
          openOrders: request.openOrders,
          history: request.history.map((entry) => ({
            action: entry.action,
            actorName: entry.actorName,
            createdAt: entry.createdAt.toISOString(),
          })),
        }}
      />
    </>
  );
}
