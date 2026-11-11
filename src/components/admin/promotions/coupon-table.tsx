'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useTransition } from 'react';

import { setCouponActiveAction } from '@/actions/admin/promotions';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { AdminCouponRow, CouponState } from '@/server/modules/promotion';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { useActionFeedback } from '../form/action-feedback';
import { useOrderFormat } from '../orders/format';

const STATE_TONES: Record<CouponState, 'success' | 'gold' | 'neutral' | 'outline'> = {
  active: 'success',
  scheduled: 'gold',
  expired: 'neutral',
  inactive: 'outline',
};

export function CouponStateBadge({ state }: { state: CouponState }) {
  const t = useTranslations('admin.coupons.states');
  return <Badge variant={STATE_TONES[state]}>{t(state)}</Badge>;
}

function ActiveToggle({ coupon }: { coupon: AdminCouponRow }) {
  const t = useTranslations('admin.coupons');
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={coupon.isActive}
      disabled={pending}
      aria-label={t('toggleFor', { code: coupon.code })}
      onCheckedChange={(isActive) =>
        startTransition(async () => {
          const result = await setCouponActiveAction({ id: coupon.id, isActive });
          if (!result.ok) return feedback.fail(result);
          feedback.success(t(isActive ? 'activated' : 'deactivated', { code: coupon.code }));
        })
      }
    />
  );
}

/** Coupons list (§11.2) with usage statistics from coupon_redemptions. */
export function CouponTable({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: AdminCouponRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.coupons');
  const format = useOrderFormat();
  const columns = useMemo<DataTableColumn<AdminCouponRow>[]>(
    () => [
      {
        id: 'code',
        header: t('columns.code'),
        cell: ({ row }) => (
          <Link
            href={`/admin/promotions/coupons/${row.original.id}` as Route}
            className="font-mono font-medium underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        id: 'type',
        header: t('columns.type'),
        cell: ({ row }) => t(`types.${row.original.type}`),
      },
      {
        id: 'value',
        header: t('columns.value'),
        cell: ({ row }) => {
          const c = row.original;
          if (c.type === 'free_shipping') return '—';
          if (c.type === 'fixed')
            return <span className="tabular-nums">{format.vnd(c.value)}</span>;
          return (
            <span className="tabular-nums">
              {t('percentValue', { value: c.value })}
              {c.maxDiscount !== null && (
                <span className="text-taupe-600">
                  {' '}
                  ({t('maxDiscount', { amount: format.vnd(c.maxDiscount) })})
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'conditions',
        header: t('columns.conditions'),
        cell: ({ row }) =>
          row.original.minSubtotal !== null
            ? t('minSubtotal', { amount: format.vnd(row.original.minSubtotal) })
            : t('noConditions'),
      },
      {
        id: 'period',
        header: t('columns.period'),
        cell: ({ row }) => {
          const { startsAt, endsAt } = row.original;
          if (!startsAt && !endsAt) return t('always');
          return (
            <span className="flex flex-col tabular-nums">
              {startsAt && <span>{t('from', { date: format.dateTime(startsAt) })}</span>}
              {endsAt && <span>{t('until', { date: format.dateTime(endsAt) })}</span>}
            </span>
          );
        },
      },
      {
        id: 'usage',
        header: t('columns.usage'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {t('usage', {
              used: row.original.usage.redemptions,
              limit: row.original.usageLimit ?? t('unlimited'),
            })}
          </span>
        ),
      },
      {
        id: 'discount',
        header: t('columns.discount'),
        cell: ({ row }) => (
          <span className="tabular-nums">{format.vnd(row.original.usage.discountTotal)}</span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <span className="flex items-center gap-3">
            <ActiveToggle coupon={row.original} />
            <CouponStateBadge state={row.original.state} />
          </span>
        ),
      },
    ],
    [t, format],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.id}
      caption={t('title')}
      sortable={{ code: 'code', usage: 'usedCount', period: 'endsAt' }}
      searchLabel={t('search')}
      emptyTitle={t('empty')}
    />
  );
}
