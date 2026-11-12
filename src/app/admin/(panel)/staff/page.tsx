import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { InviteStaffDialog } from '@/components/admin/staff/invite-staff-dialog';
import { StaffTable } from '@/components/admin/staff/staff-table';
import { Button } from '@/components/ui/button';
import { fieldBase, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { requireAdminPage } from '@/server/auth/guards';
import { STAFF_ROLES } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import {
  INVITE_TTL_HOURS,
  listStaff,
  STAFF_STATUSES,
  staffListSchema,
} from '@/server/modules/staff';

/** Staff management (§5.2 /admin/staff, §11.2): Owner only (`staff.manage`). */
export default function AdminStaffPage(props: PageProps<'/admin/staff'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<'/admin/staff'>) {
  const { user } = await requireAdminPage('staff.manage');
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.staff' });
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const parsed = staffListSchema.safeParse({
    q: first(params.q) ?? '',
    status: first(params.status) || null,
  });
  const query = parsed.success ? parsed.data : staffListSchema.parse({});
  const rows = await listStaff(getDb(), query);
  const label = 'text-small flex flex-col gap-2 font-medium';
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<InviteStaffDialog roles={STAFF_ROLES} inviteHours={INVITE_TTL_HOURS} />}
      />
      <div className="flex flex-col gap-4">
        <form method="get" action="/admin/staff" className="flex flex-wrap items-end gap-3">
          <label className={cn(label, 'w-full max-w-sm')}>
            {t('search')}
            <Input
              type="search"
              name="q"
              defaultValue={query.q}
              autoComplete="off"
              maxLength={100}
            />
          </label>
          <label className={cn(label, 'w-48')}>
            {t('statusFilter')}
            <select
              name="status"
              defaultValue={query.status ?? ''}
              className={cn(fieldBase, 'min-h-11 py-2')}
            >
              <option value="">{t('allStatuses')}</option>
              {STAFF_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`statuses.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            {t('filter')}
          </Button>
          {(query.q || query.status) && (
            <Link
              href={'/admin/staff' as Route}
              className="text-small text-gold-700 underline-offset-4 hover:underline"
            >
              {t('resetFilters')}
            </Link>
          )}
          <p className="text-small ml-auto text-taupe-600" aria-live="polite">
            {t('count', { count: rows.length })}
          </p>
        </form>
        <StaffTable rows={rows} currentUserId={user.id} />
      </div>
    </>
  );
}
