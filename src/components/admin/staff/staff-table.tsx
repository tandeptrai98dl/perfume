import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { StaffMember, StaffStatus } from '@/server/modules/staff';

import { useOrderFormat } from '../orders/format';

export function StaffStatusBadge({ status }: { status: StaffStatus }) {
  const t = useTranslations('admin.staff.statuses');
  const variant = status === 'active' ? 'success' : status === 'invited' ? 'gold' : 'warning';
  return <Badge variant={variant}>{t(status)}</Badge>;
}

export function TwoFactorState({ enabled }: { enabled: boolean }) {
  const t = useTranslations('admin.staff');
  return enabled ? (
    <span className="text-success inline-flex items-center gap-1">
      <ShieldCheck aria-hidden className="size-4" />
      {t('twoFactorOn')}
    </span>
  ) : (
    <span className="text-warning inline-flex items-center gap-1">
      <ShieldOff aria-hidden className="size-4" />
      {t('twoFactorOff')}
    </span>
  );
}

/** Staff list (§11.2): the whole team fits on one page, so no pagination. */
export function StaffTable({
  rows,
  currentUserId,
}: {
  rows: StaffMember[];
  currentUserId: string;
}) {
  const t = useTranslations('admin');
  const format = useOrderFormat();
  return (
    <div className="border-line-200 overflow-x-auto border">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t('staff.title')}</caption>
        <thead className="bg-sand-100">
          <tr>
            {(['name', 'role', 'status', 'twoFactor', 'lastLogin'] as const).map((column) => (
              <th
                key={column}
                scope="col"
                className="text-small px-3 py-2 font-medium whitespace-nowrap"
              >
                {t(`staff.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-line-200 border-t">
              <th scope="row" className="text-small px-3 py-2 text-left font-normal">
                <Link
                  href={`/admin/staff/${row.id}` as Route}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
                {row.id === currentUserId && (
                  <Badge variant="outline" className="ml-2">
                    {t('staff.you')}
                  </Badge>
                )}
                <span className="block text-taupe-600">{row.email}</span>
              </th>
              <td className="text-small px-3 py-2">{t(`roles.${row.role}`)}</td>
              <td className="text-small px-3 py-2">
                <StaffStatusBadge status={row.status} />
              </td>
              <td className="text-small px-3 py-2">
                <TwoFactorState enabled={row.twoFactorEnabled} />
              </td>
              <td className="text-small px-3 py-2 tabular-nums">
                {row.lastLoginAt ? format.dateTime(row.lastLoginAt) : t('staff.never')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState title={t('staff.empty')} />}
    </div>
  );
}
