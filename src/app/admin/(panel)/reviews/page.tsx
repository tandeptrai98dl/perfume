import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { loadTableParams, toListQuery } from '@/components/admin/data-table/search-params';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { ReviewModerationTable } from '@/components/admin/reviews/review-moderation-table';
import { cn } from '@/lib/utils';
import { requireAdminPage } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import {
  countReviewsByStatus,
  listReviewsForModeration,
  MODERATION_SORTS,
  moderationFilterSchema,
  REVIEW_STATUSES,
  type ReviewStatus,
} from '@/server/modules/review';

export default function AdminReviewsPage(props: PageProps<'/admin/reviews'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

/** Review moderation (§5.2, §11.2): pending queue first, then approved / rejected / all. */
async function Content({ searchParams }: PageProps<'/admin/reviews'>) {
  await requireAdminPage('reviews.moderate');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.reviews' });
  const raw = await searchParams;
  const table = toListQuery(await loadTableParams(searchParams));
  const rawStatus = Array.isArray(raw.status) ? raw.status[0] : raw.status;
  // No ?status= means the pending queue; ?status=all lists everything.
  const status: ReviewStatus | null =
    rawStatus === 'all'
      ? null
      : (moderationFilterSchema.parse({ status: rawStatus ?? 'pending' }).status ?? 'pending');
  const sort = (MODERATION_SORTS as readonly string[]).includes(table.sort) ? table.sort : '';
  const db = getDb();
  const [data, counts] = await Promise.all([
    listReviewsForModeration(db, { ...table, sort, status }),
    countReviewsByStatus(db),
  ]);
  const all = counts.pending + counts.approved + counts.rejected;
  const tabs: { key: ReviewStatus | 'all'; count: number }[] = [
    ...REVIEW_STATUSES.map((key) => ({ key, count: counts[key] })),
    { key: 'all', count: all },
  ];
  const activeKey = status ?? 'all';

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <nav
        aria-label={t('tabs.label')}
        className="border-line-200 mb-6 flex flex-wrap gap-1 border-b"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <Link
              key={tab.key}
              href={
                (tab.key === 'pending'
                  ? '/admin/reviews'
                  : `/admin/reviews?status=${tab.key}`) as Route
              }
              aria-current={active ? 'page' : undefined}
              className={cn(
                'text-small -mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-4',
                active
                  ? 'border-ink-950 font-medium'
                  : 'hover:text-ink-950 border-transparent text-taupe-600',
              )}
            >
              {t(`tabs.${tab.key}`)}
              <span className="bg-sand-100 text-ink-950 px-2 py-0.5 tabular-nums">{tab.count}</span>
            </Link>
          );
        })}
      </nav>
      <ReviewModerationTable
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
      />
    </>
  );
}
