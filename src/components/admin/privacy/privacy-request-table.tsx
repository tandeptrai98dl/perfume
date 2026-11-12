'use client';

import type { Route } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';

import { DataTable, type DataTableColumn } from '../data-table/data-table';
import { FilterSelect } from '../data-table/filter-select';
import { PRIVACY_STATUS_TONES, privacyStatusKey, privacyTypeKey } from './labels';

export type PrivacyRequestRowView = {
  id: string;
  type: 'export' | 'delete' | 'correct' | 'withdraw_consent';
  status: 'received' | 'in_progress' | 'completed' | 'rejected';
  email: string;
  hasAccount: boolean;
  createdAt: string;
  dueAt: string;
  completedAt: string | null;
  overdue: boolean;
};

const DATE = { dateStyle: 'medium' } as const;

/** PrivacyRequestTable (§8.4): queue with SLA due dates; overdue requests are flagged. */
export function PrivacyRequestTable(props: {
  rows: PrivacyRequestRowView[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const t = useTranslations('admin.privacyRequests');
  const format = useFormatter();
  const columns = useMemo<DataTableColumn<PrivacyRequestRowView>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('columns.createdAt'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {format.dateTime(new Date(row.original.createdAt), DATE)}
          </span>
        ),
      },
      {
        id: 'type',
        header: t('columns.type'),
        cell: ({ row }) => t(`types.${privacyTypeKey(row.original.type)}`),
      },
      {
        id: 'email',
        header: t('columns.email'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <Link
              href={`/admin/privacy-requests/${row.original.id}` as Route}
              prefetch={false}
              className="break-all underline-offset-4 hover:underline"
            >
              {row.original.email}
            </Link>
            <span className="text-taupe-600">
              {row.original.hasAccount ? t('account.member') : t('account.guest')}
            </span>
          </span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <Badge variant={PRIVACY_STATUS_TONES[row.original.status]}>
            {t(`status.${privacyStatusKey(row.original.status)}`)}
          </Badge>
        ),
      },
      {
        id: 'dueAt',
        header: t('columns.dueAt'),
        cell: ({ row }) =>
          row.original.completedAt ? (
            <span className="text-taupe-600 tabular-nums">
              {t('completedOn', {
                date: format.dateTime(new Date(row.original.completedAt), DATE),
              })}
            </span>
          ) : (
            <span className="flex items-center gap-2 tabular-nums">
              {format.dateTime(new Date(row.original.dueAt), DATE)}
              {row.original.overdue && <Badge variant="warning">{t('overdue')}</Badge>}
            </span>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('columns.actions')}</span>,
        cell: ({ row }) => (
          <Link
            href={`/admin/privacy-requests/${row.original.id}` as Route}
            prefetch={false}
            className="text-gold-700 underline-offset-4 hover:underline"
            aria-label={t('openFor', { email: row.original.email })}
          >
            {t('open')}
          </Link>
        ),
      },
    ],
    [t, format],
  );
  return (
    <DataTable
      columns={columns}
      data={props.rows}
      total={props.total}
      page={props.page}
      pageSize={props.pageSize}
      getRowId={(row) => row.id}
      caption={t('title')}
      searchLabel={t('search')}
      filters={
        <>
          <FilterSelect
            param="filter"
            label={t('filter.label')}
            allLabel={t('filter.open')}
            options={[
              { value: 'overdue', label: t('filter.overdue') },
              { value: 'completed', label: t('filter.completed') },
              { value: 'rejected', label: t('filter.rejected') },
              { value: 'all', label: t('filter.all') },
            ]}
          />
          <FilterSelect
            param="type"
            label={t('filter.type')}
            allLabel={t('filter.allTypes')}
            options={(['export', 'correct', 'delete', 'withdraw_consent'] as const).map((type) => ({
              value: type,
              label: t(`types.${privacyTypeKey(type)}`),
            }))}
          />
        </>
      }
      emptyTitle={t('empty')}
    />
  );
}
