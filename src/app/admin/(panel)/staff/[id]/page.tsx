import type { Route } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AuditTable } from '@/components/admin/audit/audit-table';
import { PageHeader } from '@/components/admin/page-header';
import { PageSkeleton } from '@/components/admin/page-skeleton';
import { StaffActions } from '@/components/admin/staff/staff-actions';
import { StaffStatusBadge, TwoFactorState } from '@/components/admin/staff/staff-table';
import { requireAdminPage } from '@/server/auth/guards';
import { STAFF_ROLES } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { auditPageSchema, listAuditLogs } from '@/server/modules/audit';
import { getStaffMember } from '@/server/modules/staff';

import { isUuid } from '../../_lib/params';

/** One staff account: details, Owner actions and its audit trail (§11.2 "Staff & audit"). */
export default function AdminStaffMemberPage(props: PageProps<'/admin/staff/[id]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const RECENT = 10;

async function Content({ params }: PageProps<'/admin/staff/[id]'>) {
  const { user } = await requireAdminPage('staff.manage');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const member = await getStaffMember(db, id);
  if (!member) notFound();
  const t = await getTranslations({ locale: 'vi', namespace: 'admin' });
  const format = await getFormatter({ locale: 'vi' });
  const [byMember, onMember] = await Promise.all([
    listAuditLogs(db, auditPageSchema.parse({ actorId: id }), RECENT),
    listAuditLogs(db, auditPageSchema.parse({ entityType: 'staff', entityId: id }), RECENT),
  ]);
  const self = member.id === user.id;
  const dateTime = (value: Date) =>
    format.dateTime(value, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

  return (
    <>
      <PageHeader
        title={member.name}
        meta={<StaffStatusBadge status={member.status} />}
        back={{ href: '/admin/staff', label: t('staff.back') }}
      />
      <div className="flex flex-col gap-8">
        <dl className="border-line-200 grid gap-4 border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="text-small text-taupe-600">{t('staff.fields.email')}</dt>
            <dd className="break-all">{member.email}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-small text-taupe-600">{t('staff.fields.role')}</dt>
            <dd>{t(`roles.${member.role}`)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-small text-taupe-600">{t('staff.columns.twoFactor')}</dt>
            <dd>
              <TwoFactorState enabled={member.twoFactorEnabled} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-small text-taupe-600">{t('staff.columns.lastLogin')}</dt>
            <dd className="tabular-nums">
              {member.lastLoginAt ? dateTime(member.lastLoginAt) : t('staff.never')}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-small text-taupe-600">{t('staff.joined')}</dt>
            <dd className="tabular-nums">{dateTime(member.createdAt)}</dd>
          </div>
        </dl>

        {self ? (
          <p className="text-small text-taupe-600">{t('errors.selfChange')}</p>
        ) : (
          <StaffActions
            member={{ id: member.id, name: member.name, role: member.role, status: member.status }}
            roles={STAFF_ROLES}
          />
        )}

        <section aria-labelledby="staff-changes" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="staff-changes" className="text-h3">
              {t('staff.changesToAccount')}
            </h2>
            <Link
              href={`/admin/audit-log?entityType=staff&entityId=${member.id}` as Route}
              className="text-small text-gold-700 underline-offset-4 hover:underline"
            >
              {t('staff.viewAll')}
            </Link>
          </div>
          <AuditTable rows={onMember.rows} caption={t('staff.changesToAccount')} />
        </section>

        <section aria-labelledby="staff-activity" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="staff-activity" className="text-h3">
              {t('staff.recentActivity')}
            </h2>
            <Link
              href={`/admin/audit-log?actorId=${member.id}` as Route}
              className="text-small text-gold-700 underline-offset-4 hover:underline"
            >
              {t('staff.viewAll')}
            </Link>
          </div>
          <AuditTable rows={byMember.rows} caption={t('staff.recentActivity')} />
        </section>
      </div>
    </>
  );
}
