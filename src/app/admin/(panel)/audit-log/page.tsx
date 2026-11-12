import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { AuditFilters } from '@/components/admin/audit/audit-filters';
import { AuditTable } from '@/components/admin/audit/audit-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { Button } from '@/components/ui/button';
import { requireAdminPage } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import {
  AUDIT_EXPORT_LIMIT,
  auditPageSchema,
  listAuditEntityTypes,
  listAuditLogs,
  type AuditFilter,
} from '@/server/modules/audit';
import { listStaffOptions } from '@/server/modules/staff';

/** Audit log viewer (§5.2 /admin/audit-log, §11.2): Owner and Manager (`auditLog.view`). */
export default function AdminAuditLogPage(props: PageProps<'/admin/audit-log'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const FILTER_KEYS = ['actorId', 'entityType', 'entityId', 'action', 'from', 'to'] as const;

function query(filter: AuditFilter, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function Content({ searchParams }: PageProps<'/admin/audit-log'>) {
  const { user } = await requireAdminPage('auditLog.view');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.audit' });
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const parsed = auditPageSchema.safeParse(raw);
  // Invalid filters (hand-edited URL) fall back to the unfiltered newest page.
  const pageQuery = parsed.success ? parsed.data : auditPageSchema.parse({});
  const filter: AuditFilter = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, pageQuery[key] ?? null]),
  ) as AuditFilter;

  const db = getDb();
  const [page, actors, entityTypes] = await Promise.all([
    listAuditLogs(db, pageQuery),
    listStaffOptions(db),
    listAuditEntityTypes(db),
  ]);
  const canExport = hasPermission(user.role ?? 'customer', 'customers.export');

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canExport && (
            <Button asChild variant="secondary">
              <a href={`/api/admin/audit-log/export${query(filter)}`} download>
                <Download aria-hidden />
                {t('export')}
              </a>
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <AuditFilters filter={filter} actors={actors} entityTypes={entityTypes} />
        {canExport && (
          <p className="text-small text-taupe-600">
            {t('exportHint', { limit: AUDIT_EXPORT_LIMIT })}
          </p>
        )}
        <AuditTable rows={page.rows} caption={t('title')} />
        <nav aria-label={t('pagination')} className="flex flex-wrap items-center justify-end gap-2">
          {pageQuery.cursor && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/admin/audit-log${query(filter)}` as Route}>{t('newest')}</Link>
            </Button>
          )}
          {page.newerCursor ? (
            <Button asChild variant="secondary" size="sm">
              <Link
                href={
                  `/admin/audit-log${query(filter, { cursor: page.newerCursor, dir: 'newer' })}` as Route
                }
                rel="prev"
              >
                <ChevronLeft aria-hidden />
                {t('newer')}
              </Link>
            </Button>
          ) : null}
          {page.olderCursor ? (
            <Button asChild variant="secondary" size="sm">
              <Link
                href={`/admin/audit-log${query(filter, { cursor: page.olderCursor })}` as Route}
                rel="next"
              >
                {t('older')}
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </nav>
      </div>
    </>
  );
}
